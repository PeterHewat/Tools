import { decodeBytes, toBase64, toHex, utf8 } from "@tools/bytes";
import type { ByteFormat, HashAlgorithm } from "@tools/bytes";
import {
  bindToolHelp,
  byId,
  copyText,
  fieldValues,
  formatBytes,
  onFileDrop,
  readDraft,
  registerServiceWorker,
  restoreFields,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { hashBytes, hashFile } from "./lib/hash.js";
bindToolHelp("digests");
registerServiceWorker();
const ids = ["text", "source", "algorithm", "hmac", "key", "key-format", "expected"];
const draft = readDraft("digests", 1);
if (!draft.error) restoreFields(draft.value, ids);
const text = byId<HTMLTextAreaElement>("text");
const source = byId<HTMLSelectElement>("source");
const algorithm = byId<HTMLSelectElement>("algorithm");
const keyed = byId<HTMLInputElement>("hmac");
const key = byId<HTMLInputElement>("key");
const keyFormat = byId<HTMLSelectElement>("key-format");
const fileInput = byId<HTMLInputElement>("file");
let file: File | undefined;
let revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let fileName = typeof draft.value.fileName === "string" ? draft.value.fileName : "";
function fields(): void {
  byId("text-field").hidden = source.value !== "text";
  byId("file-field").hidden = source.value !== "file";
  byId("key-fields").hidden = !keyed.checked;
  byId("legacy").hidden = algorithm.value !== "SHA-1";
  byId("file-name").textContent = file
    ? file.name + " · " + formatBytes(file.size)
    : fileName
      ? fileName + " · reselect this file after reload"
      : "Choose or drop a file.";
}
function save(): void {
  // An incompatible draft stays as it was: this tab works without saving over it.
  if (draft.error) return;
  if (!writeDraft("digests", 1, { ...fieldValues(ids), fileName }))
    showMessage(
      byId("status"),
      "Draft could not be remembered (storage unavailable or over 2 MB).",
      true
    );
}
function clearOutputs(): void {
  byId("hex").textContent = "";
  byId("base64").textContent = "";
  showMessage(byId("compare-status"), "");
  for (const id of ["copy-hex", "copy-base64"]) byId<HTMLButtonElement>(id).disabled = true;
}
/**
 * The last file digest and what it was made from. Every field change computes again, and a file
 * of up to 64 MiB is read whole to hash it: typing a digest to compare must not read it again.
 */
let cached:
  | { file: File; hash: HashAlgorithm; key: string | null; result: Uint8Array<ArrayBuffer> }
  | undefined;
async function fileDigest(
  file: File,
  hash: HashAlgorithm,
  key: Uint8Array<ArrayBuffer> | undefined
): Promise<Uint8Array<ArrayBuffer>> {
  const keyId = key === undefined ? null : toHex(key);
  if (cached && cached.file === file && cached.hash === hash && cached.key === keyId)
    return cached.result;
  const result = await hashFile(file, hash, key);
  cached = { file, hash, key: keyId, result };
  return result;
}
async function compute(version: number): Promise<void> {
  try {
    const hash = algorithm.value as HashAlgorithm;
    const hmacKey = keyed.checked
      ? decodeBytes(key.value, keyFormat.value as ByteFormat)
      : undefined;
    if (source.value === "file" && !file)
      throw new Error(
        fileName ? "Reselect the file to recompute its digest." : "Choose or drop a file."
      );
    const bytes = source.value === "text" ? utf8(text.value) : undefined;
    const description = bytes
      ? "UTF-8 text · " + formatBytes(bytes.length)
      : file!.name + " · " + formatBytes(file!.size);
    const result = bytes
      ? await hashBytes(bytes, hash, hmacKey)
      : await fileDigest(file!, hash, hmacKey);
    if (version !== revision) return;
    byId("hex").textContent = toHex(result);
    byId("base64").textContent = toBase64(result);
    for (const id of ["copy-hex", "copy-base64"]) byId<HTMLButtonElement>(id).disabled = false;
    showMessage(byId("status"), (keyed.checked ? "HMAC · " : "") + hash + " · " + description);
    const expected = byId<HTMLInputElement>("expected").value.trim();
    showMessage(
      byId("compare-status"),
      expected
        ? expected.toLowerCase() === toHex(result) || expected === toBase64(result)
          ? "Digest matches."
          : "Digest does not match."
        : "Paste a hex or Base64 digest to compare.",
      Boolean(expected && expected.toLowerCase() !== toHex(result) && expected !== toBase64(result))
    );
  } catch (error) {
    if (version === revision) {
      clearOutputs();
      showMessage(byId("status"), (error as Error).message, true);
    }
  }
}
function update(): void {
  const version = ++revision;
  clearTimeout(timer);
  fields();
  // Leave the fixed result region in place, but never allow copying a pending old result.
  for (const id of ["copy-hex", "copy-base64"]) byId<HTMLButtonElement>(id).disabled = true;
  showMessage(byId("status"), "Computing…");
  showMessage(byId("compare-status"), "");
  save();
  timer = setTimeout(() => {
    void compute(version);
  }, 100);
}
for (const id of ids) byId(id).addEventListener("input", update);
fileInput.addEventListener("change", () => {
  file = fileInput.files?.[0];
  fileName = file?.name ?? "";
  source.value = "file";
  update();
});
onFileDrop(document.querySelector("main")!, (files) => {
  fileInput.value = "";
  file = files[0];
  fileName = file?.name ?? "";
  source.value = "file";
  update();
});
for (const id of ["hex", "base64"])
  byId("copy-" + id).addEventListener("click", async () => {
    if (!(await copyText(byId(id).textContent ?? "", byId("copy-" + id))))
      showMessage(byId("status"), "Clipboard unavailable. Select and copy the result.", true);
  });
byId("clear").addEventListener("click", () => {
  text.value = "";
  key.value = "";
  fileInput.value = "";
  file = undefined;
  fileName = "";
  source.value = "text";
  update();
  text.focus();
});
if (draft.error) {
  const status = byId("draft-status");
  status.hidden = false;
  showMessage(status, draft.error, true);
}
update();
