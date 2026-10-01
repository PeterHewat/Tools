import { decodeBytes, toBase64, toHex, utf8 } from "@tools/bytes";
import type { ByteFormat, HashAlgorithm } from "@tools/bytes";
import {
  bindToolHelp,
  byId,
  copyText,
  formatBytes,
  onFileDrop,
  registerServiceWorker,
  showMessage,
} from "@tools/ui";
import { hashBytes, hashFile } from "./lib/hash.js";
bindToolHelp("digests");
registerServiceWorker();
const text = byId<HTMLTextAreaElement>("text");
const source = byId<HTMLSelectElement>("source");
const algorithm = byId<HTMLSelectElement>("algorithm");
const keyed = byId<HTMLInputElement>("hmac");
const key = byId<HTMLInputElement>("key");
const keyFormat = byId<HTMLSelectElement>("key-format");
const fileInput = byId<HTMLInputElement>("file");
const button = byId<HTMLButtonElement>("hash");
let file: File | undefined;
let revision = 0;
function invalidate(): void {
  revision++;
  byId("hex").textContent = "";
  byId("base64").textContent = "";
  byId<HTMLButtonElement>("copy-hex").disabled = true;
  byId<HTMLButtonElement>("copy-base64").disabled = true;
  button.disabled = false;
  byId("text-field").hidden = source.value !== "text";
  byId("file-field").hidden = source.value !== "file";
  byId("key-fields").hidden = !keyed.checked;
  byId("legacy").hidden = algorithm.value !== "SHA-1";
  button.textContent = keyed.checked ? "Compute HMAC" : "Compute digest";
  showMessage(byId("status"), "Ready to compute. Previous result cleared.");
}
for (const control of [text, source, algorithm, keyed, key, keyFormat])
  control.addEventListener("input", invalidate);
function useFile(next?: File): void {
  file = next;
  source.value = "file";
  byId("file-name").textContent = file
    ? `${file.name} · ${formatBytes(file.size)}`
    : "No file selected.";
  invalidate();
}
fileInput.addEventListener("change", () => useFile(fileInput.files?.[0]));
onFileDrop(document.querySelector("main")!, (files) => useFile(files[0]));
button.addEventListener("click", async () => {
  const version = ++revision;
  button.disabled = true;
  showMessage(byId("status"), "Computing…");
  try {
    const hash = algorithm.value as HashAlgorithm;
    const hmacKey = keyed.checked
      ? decodeBytes(key.value, keyFormat.value as ByteFormat)
      : undefined;
    const description =
      source.value === "file"
        ? `${file?.name ?? "file"} · ${formatBytes(file?.size ?? 0)}`
        : `UTF-8 text · ${formatBytes(utf8(text.value).length)}`;
    if (source.value === "file" && !file) throw new Error("Choose or drop a file first.");
    const result =
      source.value === "file"
        ? await hashFile(file!, hash, hmacKey)
        : await hashBytes(utf8(text.value), hash, hmacKey);
    if (version !== revision) return;
    byId("hex").textContent = toHex(result);
    byId("base64").textContent = toBase64(result);
    byId<HTMLButtonElement>("copy-hex").disabled = false;
    byId<HTMLButtonElement>("copy-base64").disabled = false;
    showMessage(byId("status"), `${keyed.checked ? "HMAC · " : ""}${hash} · ${description}`);
  } catch (error) {
    if (version === revision) showMessage(byId("status"), (error as Error).message, true);
  } finally {
    if (version === revision) button.disabled = false;
  }
});
for (const id of ["hex", "base64"])
  byId(`copy-${id}`).addEventListener("click", async () => {
    if (!(await copyText(byId(id).textContent ?? "", byId(`copy-${id}`))))
      showMessage(byId("status"), "Clipboard unavailable. Select and copy the result.", true);
  });
byId("clear").addEventListener("click", () => {
  text.value = "";
  key.value = "";
  fileInput.value = "";
  file = undefined;
  source.value = "text";
  byId("file-name").textContent = "";
  invalidate();
  text.focus();
});
invalidate();
