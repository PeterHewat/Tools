import { createEditor } from "@tools/editor";
import {
  bindToolHelp,
  byId,
  copyText,
  readDraft,
  registerServiceWorker,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { claimTimes } from "./lib/token.js";
import { inspectJwt } from "./lib/inspect.js";
import {
  ALGORITHMS,
  defaultExample,
  encodeJwt,
  generateExample,
  isAlgorithm,
  secretBytes,
  verifyInput,
} from "./lib/signing.js";
import type { KeyFormat } from "./lib/signing.js";

bindToolHelp("jwt");
registerServiceWorker();
const draft = readDraft("jwt", 1);
const algorithm = byId<HTMLSelectElement>("algorithm");
for (const family of ["HS", "RS", "PS", "ES", "Ed"]) {
  const group = document.createElement("optgroup");
  group.label = (
    { HS: "HMAC", RS: "RSA", PS: "RSA-PSS", ES: "ECDSA", Ed: "Ed25519" } as Record<string, string>
  )[family];
  for (const name of ALGORITHMS.filter((name) => name.startsWith(family)))
    group.append(new Option(name, name));
  algorithm.add(group);
}
const keyFormat = byId<HTMLSelectElement>("key-format");
let mode = draft.value.mode === "encode" ? "encode" : "decode";
let revision = 0,
  initialized = false,
  timer: ReturnType<typeof setTimeout> | undefined;
const token = createEditor(byId("token"), {
  label: "JSON Web Token",
  lineWrapping: true,
  onChange: (user) => {
    if (user && initialized) update();
  },
});
const header = createEditor(byId("header-editor"), {
  label: "Decoded JWT header",
  language: "json",
  colours: "syntax",
  lineWrapping: true,
  onChange: (user) => {
    if (user && initialized) update();
  },
});
const payload = createEditor(byId("payload-editor"), {
  label: "Decoded JWT payload",
  language: "json",
  colours: "syntax",
  lineWrapping: true,
  onChange: (user) => {
    if (user && initialized) update();
  },
});
const key = byId<HTMLTextAreaElement>("key");
function badge(id: string, text: string, state = ""): void {
  byId(id).textContent = text;
  byId(id).dataset.state = state;
}
function save(): void {
  if (
    !writeDraft("jwt", 1, {
      token: token.text,
      header: header.text,
      payload: payload.text,
      key: key.value,
      format: keyFormat.value,
      algorithm: algorithm.value,
      mode,
      publicKey: byId<HTMLTextAreaElement>("public-key").value,
    })
  )
    showMessage(
      byId("decode-status"),
      "Draft could not be remembered (storage unavailable or over 2 MB).",
      true
    );
}
function colours(): void {
  const dots = [token.text.indexOf("."), token.text.indexOf(".", token.text.indexOf(".") + 1)];
  const segments =
    dots[0] < 0
      ? [[0, token.text.length, "jwt-header"]]
      : [
          [0, dots[0], "jwt-header"],
          [dots[0] + 1, dots[1] < 0 ? token.text.length : dots[1], "jwt-payload"],
          ...(dots[1] < 0 ? [] : [[dots[1] + 1, token.text.length, "jwt-signature"]]),
        ];
  token.setHighlights(
    segments
      .map(([from, to, className]) => ({
        from: from as number,
        to: to as number,
        class: className as string,
      }))
      .filter((mark) => mark.to > mark.from)
  );
}
function setMode(next: string): void {
  mode = next;
  token.setReadOnly(mode === "encode");
  header.setReadOnly(mode === "decode");
  payload.setReadOnly(mode === "decode");
  byId("decode-mode").setAttribute("aria-pressed", String(mode === "decode"));
  byId("encode-mode").setAttribute("aria-pressed", String(mode === "encode"));
  byId("mode-description").textContent =
    mode === "decode"
      ? "Edit the token to decode and verify. Switch to Encode to edit its JSON."
      : "Edit header, payload and signing key. The encoded token follows automatically.";
}
function renderClaims(object?: Record<string, unknown>): void {
  const claims = byId("claims");
  claims.replaceChildren();
  for (const time of object ? claimTimes(object) : []) {
    const row = document.createElement("div");
    row.textContent = time.claim + " · " + time.date + " · " + time.description;
    if (time.problem) row.style.color = "var(--warn)";
    claims.append(row);
  }
}
function keyBadge(): void {
  if (algorithm.value.startsWith("HS")) {
    try {
      const bytes = secretBytes(key.value, keyFormat.value as KeyFormat),
        required = Number(algorithm.value.slice(2)) / 8;
      badge(
        "key-state",
        bytes.length >= required
          ? "Valid secret"
          : bytes.length
            ? "Secret too short · minimum " + required + " bytes"
            : "Enter a secret",
        bytes.length >= required ? "ok" : bytes.length ? "error" : ""
      );
    } catch (error) {
      badge("key-state", "Invalid secret", "error");
      showMessage(byId("key-status"), (error as Error).message, true);
    }
  } else badge("key-state", key.value.trim() ? "Key not checked" : "Enter a key");
}
async function run(version: number): Promise<void> {
  const selected = algorithm.value;
  if (!isAlgorithm(selected)) return;
  try {
    if (mode === "encode") {
      const encoded = await encodeJwt(
        header.text,
        payload.text,
        key.value,
        keyFormat.value as KeyFormat,
        selected
      );
      if (version !== revision) return;
      token.setText(encoded, "sync");
      colours();
      badge("token-state", "Valid JWT", "ok");
      badge("signature-state", "Signature generated", "ok");
      byId<HTMLButtonElement>("token-copy").disabled = false;
      if (!selected.startsWith("HS")) badge("key-state", "Valid private key", "ok");
      renderClaims(inspectJwt(encoded).payload.object);
      save();
      return;
    }
    const decoded = inspectJwt(token.text);
    if (!decoded.valid || !decoded.signature || !key.value.trim()) return;
    if (decoded.header.object?.alg !== selected)
      throw new Error("Selected algorithm does not match the token header.");
    if (decoded.header.object?.crit !== undefined || decoded.header.object?.b64 !== undefined)
      throw new Error("crit and b64 header extensions cannot be verified here.");
    const matches = await verifyInput(
      decoded.input,
      decoded.signature,
      key.value,
      keyFormat.value as KeyFormat,
      selected
    );
    if (version !== revision) return;
    badge(
      "signature-state",
      matches ? "Signature Verified" : "Signature mismatch",
      matches ? "ok" : "error"
    );
    if (!selected.startsWith("HS")) badge("key-state", "Valid key", "ok");
    showMessage(
      byId("key-status"),
      "Signature verification is separate from time, issuer, audience and authorization checks."
    );
  } catch (error) {
    if (version !== revision) return;
    badge("signature-state", mode === "encode" ? "Cannot encode" : "Not verified", "error");
    showMessage(byId("verify-status"), (error as Error).message, true);
    if (mode === "encode") {
      token.setText("", "sync");
      colours();
      badge("token-state", "Invalid JWT", "error");
    }
  }
}
function update(): void {
  if (draft.error) return;
  const version = ++revision;
  clearTimeout(timer);
  colours();
  showMessage(byId("verify-status"), "");
  showMessage(byId("key-status"), "");
  badge("signature-state", "Signature not verified");
  keyBadge();
  if (mode === "decode") {
    byId<HTMLButtonElement>("token-copy").disabled = !token.text;
    const decoded = inspectJwt(token.text);
    header.setText(decoded.header.text, "sync");
    payload.setText(decoded.payload.text, "sync");
    badge(
      "token-state",
      token.text.trim() ? (decoded.valid ? "Valid JWT" : "Invalid JWT") : "Enter a JWT",
      decoded.valid ? "ok" : token.text.trim() ? "error" : ""
    );
    showMessage(
      byId("header-status"),
      decoded.header.error ?? "Header decoded.",
      Boolean(decoded.header.error)
    );
    showMessage(
      byId("payload-status"),
      decoded.payload.error ?? "Payload decoded.",
      Boolean(decoded.payload.error)
    );
    showMessage(byId("decode-status"), decoded.error ?? "", Boolean(decoded.error));
    renderClaims(decoded.payload.object);
  } else {
    badge("token-state", "Encoding…");
    byId<HTMLButtonElement>("token-copy").disabled = true;
    showMessage(byId("header-status"), "Editable JSON header.");
    showMessage(byId("payload-status"), "Editable JSON claims.");
  }
  save();
  timer = setTimeout(() => {
    void run(version);
  }, 120);
}
for (const control of [key, algorithm, keyFormat]) control.addEventListener("input", update);
for (const name of ["decode", "encode"])
  byId(name + "-mode").addEventListener("click", () => {
    setMode(name);
    update();
  });
for (const [id, getText] of [
  ["token", () => token.text],
  ["header", () => header.text],
  ["payload", () => payload.text],
  ["key", () => key.value],
] as const) {
  byId(id + "-copy").addEventListener("click", async () => {
    if (!(await copyText(getText(), byId(id + "-copy"))))
      showMessage(byId("decode-status"), "Clipboard unavailable. Select and copy the text.", true);
  });
}
byId("token-clear").addEventListener("click", () => {
  setMode("decode");
  token.setText("");
  update();
  token.focus();
});
byId("key-clear").addEventListener("click", () => {
  key.value = "";
  update();
  key.focus();
});
const generate = byId<HTMLButtonElement>("generate");
async function loadExample(initial = false): Promise<void> {
  const version = ++revision;
  clearTimeout(timer);
  generate.disabled = true;
  try {
    const example = initial
      ? await defaultExample()
      : await generateExample(algorithm.value as (typeof ALGORITHMS)[number]);
    if (version !== revision) return;
    token.setText(example.token, "new");
    header.setText(example.header, "new");
    payload.setText(example.payload, "new");
    key.value = example.key;
    keyFormat.value = example.format;
    byId<HTMLTextAreaElement>("public-key").value = example.publicKey;
    byId("public-key-field").hidden = !example.publicKey;
    setMode("decode");
    update();
  } catch (error) {
    if (version === revision) showMessage(byId("verify-status"), (error as Error).message, true);
  } finally {
    generate.disabled = false;
  }
}
generate.addEventListener("click", () => {
  void loadExample();
});
byId("use-public-key").addEventListener("click", () => {
  key.value = byId<HTMLTextAreaElement>("public-key").value;
  keyFormat.value = "pem";
  setMode("decode");
  update();
});
if (!draft.error && draft.found) {
  for (const [name, editor] of [
    ["token", token],
    ["header", header],
    ["payload", payload],
  ] as const)
    if (typeof draft.value[name] === "string") editor.setText(draft.value[name] as string, "new");
  if (typeof draft.value.key === "string") key.value = draft.value.key;
  if (isAlgorithm(draft.value.algorithm)) algorithm.value = draft.value.algorithm;
  if ([...keyFormat.options].some((option) => option.value === draft.value.format))
    keyFormat.value = draft.value.format as string;
  if (typeof draft.value.publicKey === "string")
    byId<HTMLTextAreaElement>("public-key").value = draft.value.publicKey;
  byId("public-key-field").hidden = !byId<HTMLTextAreaElement>("public-key").value;
}
initialized = true;
setMode(mode);
if (draft.error) showMessage(byId("decode-status"), draft.error, true);
else if (draft.found) update();
else {
  void loadExample(true);
}
