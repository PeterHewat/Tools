import { createEditor } from "@tools/editor";
import { decodeBytes, toBase64, utf8 } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";
import { bindToolHelp, byId, copyText, registerServiceWorker, showMessage } from "@tools/ui";
import { claimTimes, decodeToken, verifyToken } from "./lib/token.js";
import type { HmacAlgorithm, Token } from "./lib/token.js";

bindToolHelp("jwt");
registerServiceWorker();
const tokenInput = byId<HTMLTextAreaElement>("token");
const key = byId<HTMLInputElement>("key");
const keyFormat = byId<HTMLSelectElement>("key-format");
const algorithm = byId<HTMLSelectElement>("algorithm");
const verify = byId<HTMLButtonElement>("verify");
const header = createEditor(byId("header-editor"), {
  language: "json",
  colours: "syntax",
  readOnly: true,
  label: "Decoded JWT header",
});
const payload = createEditor(byId("payload-editor"), {
  language: "json",
  colours: "syntax",
  readOnly: true,
  label: "Decoded JWT payload",
});
let current: Token | null = null;
let revision = 0;
const invalidate = () => {
  revision++;
  showMessage(byId("verify-status"), "Signature not verified.");
};
function renderClaims(): void {
  const claims = byId("claims");
  claims.replaceChildren();
  const times = current ? claimTimes(current.payload) : [];
  if (!times.length) claims.textContent = "No exp, iat or nbf claims to display.";
  for (const time of times) {
    const row = document.createElement("p");
    row.textContent = `${time.claim} · ${time.date} · ${time.description}`;
    if (time.problem) row.style.color = "var(--warn)";
    claims.append(row);
  }
}
function decode(): void {
  invalidate();
  current = null;
  try {
    if (tokenInput.value.trim()) current = decodeToken(tokenInput.value);
    header.setText(current ? JSON.stringify(current.header, null, 2) : "", "new");
    payload.setText(current ? JSON.stringify(current.payload, null, 2) : "", "new");
    showMessage(
      byId("decode-status"),
      current
        ? `Decoded · algorithm: ${String(current.header.alg ?? "missing")}. Signature not verified.`
        : "Paste a JWT to inspect it."
    );
  } catch (error) {
    header.setText("", "new");
    payload.setText("", "new");
    showMessage(byId("decode-status"), (error as Error).message, true);
  }
  verify.disabled = !current;
  byId<HTMLButtonElement>("copy-header").disabled = !current;
  byId<HTMLButtonElement>("copy-payload").disabled = !current;
  renderClaims();
}
tokenInput.addEventListener("input", decode);
for (const control of [key, keyFormat, algorithm]) control.addEventListener("input", invalidate);
verify.addEventListener("click", async () => {
  if (!current) return;
  const version = ++revision;
  showMessage(byId("verify-status"), "Verifying…");
  try {
    const matches = await verifyToken(
      current,
      decodeBytes(key.value, keyFormat.value as ByteFormat),
      algorithm.value as HmacAlgorithm
    );
    if (version !== revision) return;
    showMessage(
      byId("verify-status"),
      matches
        ? "Signature matches this key. Check time claims, issuer and audience separately."
        : "Signature does not match this key.",
      !matches
    );
  } catch (error) {
    if (version === revision) showMessage(byId("verify-status"), (error as Error).message, true);
  }
});
for (const [id, editor] of [
  ["copy-header", header],
  ["copy-payload", payload],
] as const)
  byId(id).addEventListener("click", async () => {
    if (!(await copyText(editor.text, byId(id))))
      showMessage(
        byId("decode-status"),
        "Clipboard unavailable. Select and copy the decoded text.",
        true
      );
  });
byId("sample").addEventListener("click", () => {
  tokenInput.value = `${toBase64(utf8('{"alg":"HS256","typ":"JWT"}'), true)}.${toBase64(utf8(JSON.stringify({ sub: "example", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })), true)}.`;
  key.value = "";
  decode();
  showMessage(
    byId("decode-status"),
    "Example header and payload with an empty signature; verification will fail."
  );
});
byId("clear").addEventListener("click", () => {
  tokenInput.value = "";
  key.value = "";
  decode();
  tokenInput.focus();
});
window.setInterval(renderClaims, 30_000);
decode();
