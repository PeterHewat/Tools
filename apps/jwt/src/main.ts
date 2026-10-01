import { createEditor } from "@tools/editor";
import type { Editor } from "@tools/editor";
import {
  bindToolHelp,
  byId,
  copyText,
  readDraft,
  registerServiceWorker,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { claimTimes, memberNotes } from "./lib/token.js";
import { inspectJwt } from "./lib/inspect.js";
import type { Inspection, InspectedPart } from "./lib/inspect.js";
import {
  ALGORITHMS,
  JsonError,
  checkKey,
  convertSecret,
  defaultExample,
  encodeJwt,
  generateKey,
  isAlgorithm,
  isPrivateKey,
  pairFormat,
  secretBytes,
  signInput,
  signingInput,
  strictObject,
  verifyInput,
  withAlg,
} from "./lib/signing.js";
import type { GeneratedKey, KeyFormat, SigningAlgorithm } from "./lib/signing.js";

bindToolHelp("jwt");
registerServiceWorker();

/** Version 2: no Decode / Encode mode, the algorithm comes from the header, keys split by kind. */
const DRAFT = 2;
const draft = readDraft("jwt", DRAFT);

const algorithm = byId<HTMLSelectElement>("algorithm");
for (const [prefix, label] of Object.entries({
  HS: "HMAC",
  RS: "RSA",
  PS: "RSA-PSS",
  ES: "ECDSA",
  Ed: "Ed25519",
})) {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const name of ALGORITHMS.filter((name) => name.startsWith(prefix)))
    group.append(new Option(name, name));
  algorithm.add(group);
}
/** Shows an alg the tool cannot sign or verify ("none", a typo) rather than hiding it. */
const otherAlg = new Option("", "");
otherAlg.disabled = true;
algorithm.add(otherAlg);

const secret = byId<HTMLTextAreaElement>("secret");
const secretFormat = byId<HTMLSelectElement>("secret-format");
const publicKey = byId<HTMLTextAreaElement>("public-key");
const privateKey = byId<HTMLTextAreaElement>("private-key");
/** Keys this page made are disposable: choosing another algorithm may replace them. */
const generated = { secret: false, pair: false };
/** The encoding the secret is written in, so changing it can rewrite the secret. */
let secretEncoding: KeyFormat = "text";
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const token = createEditor(byId("token"), {
  label: "JSON Web Token",
  placeholder: "Paste a token: header.payload.signature",
  lineWrapping: true,
  onChange: (user) => {
    if (user) fromToken();
  },
});
const jsonEditor = (id: string, label: string): Editor =>
  createEditor(byId(id), {
    label,
    language: "json",
    colours: "syntax",
    lineWrapping: true,
    onChange: (user) => {
      if (user) fromJson();
    },
  });
const header = jsonEditor("header-editor", "Decoded JWT header");
const payload = jsonEditor("payload-editor", "Decoded JWT payload");

type State = "ok" | "error" | "warn" | "";
function state(id: string, text: string, kind: State = ""): void {
  const element = byId(id);
  element.textContent = text;
  element.dataset.state = kind;
  element.hidden = !text;
}
const note = (id: string, text: string, error = false): void => showMessage(byId(id), text, error);

const isHmac = (alg: SigningAlgorithm | undefined): boolean => !alg || alg.startsWith("HS");
const selected = (): SigningAlgorithm | undefined =>
  isAlgorithm(algorithm.value) ? algorithm.value : undefined;

/** The algorithm follows the header; the key fields follow the algorithm. */
function showAlg(alg: unknown): void {
  if (isAlgorithm(alg)) {
    algorithm.value = alg;
    otherAlg.hidden = true;
  } else {
    otherAlg.textContent = typeof alg === "string" ? alg || "(empty)" : "—";
    otherAlg.hidden = false;
    algorithm.value = "";
  }
  const hmac = isHmac(selected());
  byId("secret-fields").hidden = !hmac;
  byId("pair-fields").hidden = hmac;
}

/** The key that signs with an algorithm, and the one that verifies (a private key does both). */
function signingKey(alg: SigningAlgorithm): { value: string; format: KeyFormat } {
  if (isHmac(alg)) return { value: secret.value, format: secretFormat.value as KeyFormat };
  return { value: privateKey.value, format: pairFormat(privateKey.value) };
}
function verifyingKey(alg: SigningAlgorithm): { value: string; format: KeyFormat } {
  if (isHmac(alg)) return { value: secret.value, format: secretFormat.value as KeyFormat };
  const value = publicKey.value.trim() ? publicKey.value : privateKey.value;
  return { value, format: pairFormat(value) };
}
/** A secret of spaces is still a secret; a key pair needs more than whitespace. */
const blank = (alg: SigningAlgorithm, value: string): boolean =>
  isHmac(alg) ? value === "" : !value.trim();
function useKey(key: GeneratedKey, alg: SigningAlgorithm): void {
  if (isHmac(alg)) {
    secret.value = key.key;
    secretFormat.value = secretEncoding = key.format;
    generated.secret = true;
  } else {
    privateKey.value = key.key;
    publicKey.value = key.publicKey;
    generated.pair = true;
  }
}

// ---------- Showing what the token holds ----------

function decorateToken(inspection: Inspection): void {
  const text = token.text,
    lead = text.length - text.trimStart().length;
  const classes = ["jwt-header", "jwt-payload", "jwt-signature"];
  token.setHighlights(
    inspection.segments
      .slice(0, 3)
      .map((segment, i) => ({
        from: lead + segment.from,
        to: lead + segment.to,
        class: classes[i],
      }))
      .filter((mark) => mark.to > mark.from)
  );
  const broken = [inspection.header, inspection.payload].findIndex((part) => part.error);
  const segment = inspection.segments[broken];
  token.setError(
    text.trim() && segment && segment.to > segment.from
      ? {
          from: lead + segment.from,
          to: lead + segment.to,
          message: [inspection.header, inspection.payload][broken].error!,
        }
      : null
  );
  if (!text.trim()) {
    state("token-state", "");
    state("time-state", "");
    note("token-status", "Paste a token, or type a payload to start a new one.");
    return;
  }
  state(
    "token-state",
    inspection.valid ? "Valid JWT" : "Invalid JWT",
    inspection.valid ? "ok" : "error"
  );
  const problem = inspection.header.error
    ? "Header: " + inspection.header.error
    : inspection.payload.error
      ? "Payload: " + inspection.payload.error
      : (inspection.error ?? "");
  note("token-status", problem, Boolean(problem));
  const times = inspection.payload.object ? claimTimes(inspection.payload.object) : [];
  const exp = times.find((time) => time.claim === "exp"),
    nbf = times.find((time) => time.claim === "nbf");
  if (nbf?.problem) state("time-state", nbf.description, "warn");
  else if (exp) state("time-state", exp.description, exp.problem ? "warn" : "");
  else state("time-state", "");
}

function partNote(id: string, editor: Editor, part: InspectedPart): void {
  note(id, part.error ?? "", Boolean(part.error));
  editor.setError(
    part.error && part.offset !== undefined && editor.text
      ? { from: Math.min(part.offset, editor.text.length - 1), message: part.error }
      : null
  );
}
/** Reads an editor as a strict JSON object, flagging what is wrong with it. */
function readJson(editor: Editor): InspectedPart {
  try {
    const result = strictObject(editor.text);
    return { text: editor.text, object: result.object, raw: result.raw };
  } catch (error) {
    return {
      text: editor.text,
      error: (error as Error).message,
      ...(error instanceof JsonError && error.offset !== undefined ? { offset: error.offset } : {}),
    };
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
/** Says beside each known member what it means, with time claims as local dates. */
function annotate(): void {
  const format = (seconds: number) => dateFormat.format(new Date(seconds * 1000));
  for (const [editor, part] of [
    [header, "header"],
    [payload, "payload"],
  ] as const)
    editor.setNotes(
      memberNotes(editor.text, part, format).map((member) => ({
        at: member.at,
        text: member.text,
        ...(member.problem ? { class: "cm-note-warn" } : {}),
      }))
    );
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
/** Under the secret: valid, too short to sign, or unreadable in its encoding. */
function checkSecret(): void {
  const alg = selected();
  if (!alg || !isHmac(alg) || secret.value === "") return state("secret-check", "");
  try {
    const length = secretBytes(secret.value, secretFormat.value as KeyFormat).length,
      needed = Number(alg.slice(2)) / 8;
    if (length >= needed) state("secret-check", "Valid secret", "ok");
    else
      state(
        "secret-check",
        `Too short to sign ${alg}: ${length} of ${needed} bytes. It can still verify.`,
        "warn"
      );
  } catch (error) {
    state("secret-check", "Invalid secret: " + lowerFirst((error as Error).message), "error");
  }
}
/** Under each half of a key pair: whether it fits the algorithm for what that field does. */
async function checkPair(
  alg: SigningAlgorithm | undefined
): Promise<[id: string, text: string, kind: State][]> {
  const checks: [string, string, State][] = [];
  for (const [id, field, usage] of [
    ["public-check", publicKey, "verify"],
    ["private-check", privateKey, "sign"],
  ] as const) {
    const value = field.value;
    if (!alg || isHmac(alg) || !value.trim()) {
      checks.push([id, "", ""]);
      continue;
    }
    try {
      await checkKey(value, pairFormat(value), alg, usage);
      checks.push([id, isPrivateKey(value) ? "Valid private key" : "Valid public key", "ok"]);
    } catch (error) {
      const message = (error as Error).message;
      checks.push(
        usage === "sign" && message === "Signing needs a private key."
          ? [id, "This is a public key: signing needs the private one", "error"]
          : [
              id,
              `Invalid ${usage === "sign" ? "private" : "public"} key: ${lowerFirst(message)}`,
              "error",
            ]
      );
    }
  }
  return checks;
}

// ---------- Following edits ----------

/** The token was edited: the header and payload follow it, then the signature is checked. */
function fromToken(): void {
  const inspection = inspectJwt(token.text);
  header.setText(inspection.header.text, "sync");
  payload.setText(inspection.payload.text, "sync");
  partNote("header-status", header, inspection.header);
  partNote("payload-status", payload, inspection.payload);
  if (inspection.header.object) showAlg(inspection.header.object.alg);
  decorateToken(inspection);
  annotate();
  settle(false);
}
/** The header or payload was edited: the token is rebuilt from them and signed again. */
function fromJson(): void {
  // A payload typed with no header starts a new token, with the selected algorithm.
  if (!header.text.trim() && payload.text.trim())
    header.setText(JSON.stringify({ alg: selected() ?? "HS256", typ: "JWT" }, null, 2), "sync");
  const head = readJson(header),
    body = readJson(payload);
  partNote("header-status", header, head);
  partNote("payload-status", payload, body);
  if (head.object) showAlg(head.object.alg);
  annotate();
  settle(true);
}

/** After the edits stop: signs again when asked, then verifies, saves and reports. */
function settle(resign: boolean): void {
  const version = ++revision;
  clearTimeout(timer);
  checkSecret();
  note("key-status", "");
  save();
  timer = setTimeout(() => void run(version, resign), 120);
}
async function run(version: number, resign: boolean): Promise<void> {
  let signNote = "";
  if (resign) signNote = await resignToken(version);
  if (version !== revision) return;
  const inspection = inspectJwt(token.text);
  if (resign) decorateToken(inspection);
  const [result, checks] = await Promise.all([verify(inspection), checkPair(selected())]);
  if (version !== revision) return;
  state("signature-state", result.text, result.state);
  for (const [id, text, kind] of checks) state(id, text, kind);
  if (signNote || result.note)
    note("key-status", signNote || result.note!, Boolean(signNote) || result.state === "error");
  save();
}
/** Rebuilds the token from the header and payload; returns why it could not sign, if it could not. */
async function resignToken(version: number): Promise<string> {
  let head, body;
  try {
    head = strictObject(header.text);
    body = strictObject(payload.text);
  } catch {
    return "";
  }
  const input = signingInput(head, body);
  const old = token.text.trim().split(".")[2] ?? "";
  let next = input + "." + old,
    reason = "";
  const alg = head.object.alg;
  try {
    if (!isAlgorithm(alg))
      throw new Error(
        alg === undefined
          ? "the header has no alg."
          : `alg ${JSON.stringify(alg)} is not one this tool can sign with.`
      );
    const key = signingKey(alg);
    if (blank(alg, key.value))
      throw new Error(isHmac(alg) ? "enter a secret." : "add the private key.");
    next = await encodeJwt(header.text, payload.text, key.value, key.format, alg);
  } catch (error) {
    const message = (error as Error).message;
    reason = "Not signed: " + message.charAt(0).toLowerCase() + message.slice(1);
    if (old) reason += " The token keeps its previous signature.";
  }
  if (version === revision && next !== token.text) token.setText(next, "sync");
  return reason;
}
async function verify(
  inspection: Inspection
): Promise<{ text: string; state: State; note?: string }> {
  if (!token.text.trim()) return { text: "", state: "" };
  if (!inspection.valid || !inspection.signature) return { text: "Not verified", state: "" };
  const alg = inspection.header.object?.alg;
  if (!isAlgorithm(alg))
    return {
      text: "Unsupported algorithm",
      state: "error",
      note: `alg ${JSON.stringify(alg)} cannot be verified here: use HS, RS, PS, ES or EdDSA.`,
    };
  if (inspection.header.object?.crit !== undefined || inspection.header.object?.b64 !== undefined)
    return {
      text: "Not verified",
      state: "error",
      note: "Tokens with crit or b64 header parameters cannot be verified here.",
    };
  const key = verifyingKey(alg);
  if (blank(alg, key.value))
    return {
      text: "Not verified",
      state: "",
      note: isHmac(alg)
        ? "Enter the secret to verify the signature."
        : "Paste the public key to verify the signature.",
    };
  try {
    const matches = await verifyInput(
      inspection.input,
      inspection.signature,
      key.value,
      key.format,
      alg
    );
    return matches
      ? { text: "Signature verified", state: "ok" }
      : { text: "Invalid signature", state: "error" };
  } catch (error) {
    return { text: "Not verified", state: "error", note: (error as Error).message };
  }
}

function save(): void {
  // An incompatible draft stays as it was, for whoever can still read it.
  if (draft.error) return;
  if (
    !writeDraft("jwt", DRAFT, {
      token: token.text,
      header: header.text,
      payload: payload.text,
      secret: secret.value,
      secretFormat: secretFormat.value,
      publicKey: publicKey.value,
      privateKey: privateKey.value,
      generated,
    })
  )
    note(
      "token-status",
      "This tab's draft could not be kept (storage unavailable or over 2 MB).",
      true
    );
}

// ---------- Controls ----------

secret.addEventListener("input", () => {
  generated.secret = false;
  settle(false);
});
/** The same secret, written in the newly chosen encoding; it stays as typed if it was unreadable. */
secretFormat.addEventListener("change", () => {
  const to = secretFormat.value as KeyFormat;
  let readable = true;
  try {
    secretBytes(secret.value, secretEncoding);
  } catch {
    readable = false;
  }
  if (readable && secret.value !== "")
    try {
      secret.value = convertSecret(secret.value, secretEncoding, to);
    } catch (error) {
      secretFormat.value = secretEncoding;
      note("key-status", (error as Error).message + " The encoding stays as it was.", true);
      return;
    }
  secretEncoding = to;
  settle(false);
});
for (const field of [publicKey, privateKey])
  field.addEventListener("input", () => {
    generated.pair = false;
    settle(false);
  });

/** Can this key sign with this algorithm as it stands? */
async function signs(alg: SigningAlgorithm): Promise<boolean> {
  const key = signingKey(alg);
  try {
    await signInput("", key.value, key.format, alg);
    return true;
  } catch {
    return false;
  }
}
algorithm.addEventListener("change", async () => {
  const alg = selected();
  if (!alg) return;
  const version = ++revision;
  header.setText(withAlg(header.text, alg), "edit");
  showAlg(alg);
  const hmac = isHmac(alg);
  const missing = hmac ? secret.value === "" : !publicKey.value.trim() && !privateKey.value.trim();
  if (missing || ((hmac ? generated.secret : generated.pair) && !(await signs(alg)))) {
    const key = await generateKey(alg);
    if (version !== revision) return;
    useKey(key, alg);
  }
  fromJson();
});

const keyButton = byId<HTMLButtonElement>("generate-key");
keyButton.addEventListener("click", async () => {
  const alg = selected() ?? "HS256";
  keyButton.disabled = true;
  try {
    useKey(await generateKey(alg), alg);
    fromJson();
  } catch (error) {
    note("key-status", (error as Error).message, true);
  } finally {
    keyButton.disabled = false;
  }
});
byId("sign").addEventListener("click", fromJson);

/** A new tab starts with a signed sample, so every panel shows what it is for. */
async function loadSample(): Promise<void> {
  const version = ++revision;
  try {
    const sample = await defaultExample();
    if (version !== revision) return;
    useKey(sample, "HS256");
    token.setText(sample.token, "new");
    fromToken();
  } catch (error) {
    if (version === revision) note("token-status", (error as Error).message, true);
  }
}

byId("token-clear").addEventListener("click", () => {
  token.setText("", "edit");
  fromToken();
  token.focus();
});
for (const [id, text] of [
  ["token-copy", () => token.text.trim()],
  ["header-copy", () => header.text],
  ["payload-copy", () => payload.text],
] as const)
  byId(id).addEventListener("click", async () => {
    if (!(await copyText(text(), byId(id))))
      note("token-status", "Clipboard unavailable. Select and copy the text.", true);
  });
// ---------- Start ----------

if (draft.error) {
  showAlg("HS256");
  note("token-status", draft.error, true);
} else if (draft.found) {
  const value = draft.value;
  const text = (name: string): string =>
    typeof value[name] === "string" ? (value[name] as string) : "";
  token.setText(text("token"), "new");
  header.setText(text("header"), "new");
  payload.setText(text("payload"), "new");
  secret.value = text("secret");
  publicKey.value = text("publicKey");
  privateKey.value = text("privateKey");
  if ([...secretFormat.options].some((option) => option.value === value.secretFormat))
    secretFormat.value = secretEncoding = value.secretFormat as KeyFormat;
  const flags = value.generated as Partial<typeof generated> | undefined;
  generated.secret = flags?.secret === true;
  generated.pair = flags?.pair === true;
  const head = readJson(header);
  showAlg(head.object?.alg ?? inspectJwt(token.text).header.object?.alg);
  partNote("header-status", header, head);
  partNote("payload-status", payload, readJson(payload));
  decorateToken(inspectJwt(token.text));
  annotate();
  settle(false);
} else {
  showAlg("HS256");
  void loadSample();
}
