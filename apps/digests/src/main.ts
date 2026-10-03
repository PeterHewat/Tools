import { decodeBytes, toBase64, toHex, utf8 } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";
import { createEditor } from "@tools/editor";
import {
  bindSwitch,
  bindToolHelp,
  byId,
  copyText,
  debounce,
  fieldValues,
  formatBytes,
  isOn,
  onFileDrop,
  readDraft,
  registerServiceWorker,
  restoreFields,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { ALGORITHMS, hashAll, matchDigest, readFile } from "./lib/hash.js";
import type { Digests } from "./lib/hash.js";
bindToolHelp("digests");
registerServiceWorker();

/** A new tab hashes the sentence every SHA test suite knows, so the digests can be recognised. */
const EXAMPLE = "The quick brown fox jumps over the lazy dog";

type Source = "text" | "file";
type Encoding = "hex" | "base64";

const DRAFT = 1;
const ids = ["hmac", "key", "key-format", "expected"];
const draft = readDraft("digests", DRAFT);
if (!draft.error) restoreFields(draft.value, ids);
const saved = draft.value;

const keyed = byId("hmac");
const key = byId<HTMLTextAreaElement>("key");
const keyFormat = byId<HTMLSelectElement>("key-format");
const expected = byId<HTMLInputElement>("expected");
const fileInput = byId<HTMLInputElement>("file");
const sourceButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-source]")];
const encodingButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-encoding]")];

let source: Source = saved.source === "file" ? "file" : "text";
let encoding: Encoding = saved.encoding === "base64" ? "base64" : "hex";
let file: File | undefined;
let fileName = typeof saved.fileName === "string" ? saved.fileName : "";
/** The digests on show, and the edit they were computed for. */
let digests: Digests | undefined;
let revision = 0;

const editor = createEditor(byId("text"), {
  text: typeof saved.text === "string" && !draft.error ? saved.text : EXAMPLE,
  label: "Text to hash",
  lineWrapping: true,
  exact: true,
  onChange: (user) => {
    if (user) update();
  },
});

function pressed(buttons: HTMLButtonElement[], value: string, data: string): void {
  for (const button of buttons)
    button.setAttribute("aria-pressed", String(button.dataset[data] === value));
}

function fields(): void {
  pressed(sourceButtons, source, "source");
  pressed(encodingButtons, encoding, "encoding");
  byId("text").hidden = source !== "text";
  byId("file-field").hidden = source !== "file";
  byId("key-fields").hidden = !isOn(keyed);
  byId("file-name").textContent = file
    ? file.name
    : fileName
      ? fileName + " · choose it again after a reload"
      : "or drop one anywhere on the page · up to 64 MiB";
}

function save(): void {
  // An incompatible draft stays as it was: this tab works without saving over it.
  if (draft.error) return;
  const value = { ...fieldValues(ids), text: editor.text, source, encoding, fileName };
  if (!writeDraft("digests", DRAFT, value)) {
    const status = byId("draft-status");
    status.hidden = false;
    showMessage(status, "Draft could not be remembered (storage unavailable or over 2 MB).", true);
  }
}

/**
 * The last file's bytes. Every field change computes again, and a file of up to 64 MiB is read
 * whole to hash it: typing a key or a digest to compare must not read it again.
 */
let read: { file: File; bytes: Uint8Array<ArrayBuffer> } | undefined;
async function fileBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (read?.file !== file) read = { file, bytes: await readFile(file) };
  return read.bytes;
}

/** The digests in the chosen encoding, and which line an expected digest matches. */
function show(): void {
  const match = digests && matchDigest(expected.value, digests, { hex: toHex, base64: toBase64 });
  for (const name of ALGORITHMS) {
    const id = name.toLowerCase();
    const value = digests?.[name];
    // Kept while the input cannot be hashed, dimmed: the lines never jump.
    if (value) {
      const [shown, other] =
        encoding === "hex" ? [toHex(value), toBase64(value)] : [toBase64(value), toHex(value)];
      byId(id).firstElementChild!.textContent = shown;
      // Sized for the other encoding too, so switching moves no line.
      byId(id).dataset.other = other;
    }
    byId<HTMLButtonElement>(id + "-copy").disabled = !value;
    byId(id + "-item").toggleAttribute("data-match", name === match);
  }
  byId("digests").toggleAttribute("data-stale", !digests);
  const compare = byId("compare-status");
  if (!expected.value.trim()) showMessage(compare, "");
  else if (!digests) showMessage(compare, "");
  else if (match) showMessage(compare, "Matches " + match + (isOn(keyed) ? " HMAC." : "."));
  else showMessage(compare, "Matches none of these digests.", true);
}

async function compute(version: number): Promise<void> {
  if (source === "file" && !file) {
    // Nothing to hash yet: empty lines, and what to do instead of an error.
    digests = undefined;
    for (const name of ALGORITHMS) {
      byId(name.toLowerCase()).firstElementChild!.textContent = "";
      delete byId(name.toLowerCase()).dataset.other;
    }
    byId("size").textContent = "";
    showMessage(byId("status"), fileName ? "Choose the file again to hash it." : "Choose a file.");
    show();
    return;
  }
  try {
    const hmacKey = isOn(keyed) ? decodeBytes(key.value, keyFormat.value as ByteFormat) : undefined;
    let bytes: Uint8Array<ArrayBuffer>;
    if (source === "text") bytes = utf8(editor.text);
    else bytes = await fileBytes(file!);
    byId("size").textContent = formatBytes(bytes.length);
    const result = await hashAll(bytes, hmacKey);
    if (version !== revision) return;
    digests = result;
    showMessage(byId("status"), isOn(keyed) ? "HMAC" : "");
  } catch (error) {
    if (version !== revision) return;
    digests = undefined;
    showMessage(byId("status"), (error as Error).message, true);
  }
  show();
}

/** Computed again once edits pause; a result from before a later edit is not shown. */
const recompute = debounce(() => void compute(revision), 100);
function update(): void {
  revision++;
  fields();
  // The lines stay in place, but a result from before this edit cannot be copied.
  for (const name of ALGORITHMS)
    byId<HTMLButtonElement>(name.toLowerCase() + "-copy").disabled = true;
  save();
  recompute();
}

for (const id of ["key", "key-format"]) byId(id).addEventListener("input", update);
bindSwitch(keyed, update);
expected.addEventListener("input", () => {
  save();
  show();
});
for (const button of sourceButtons)
  button.addEventListener("click", () => {
    source = button.dataset.source as Source;
    update();
  });
for (const button of encodingButtons)
  button.addEventListener("click", () => {
    encoding = button.dataset.encoding as Encoding;
    fields();
    save();
    show();
  });

function pick(chosen: File | undefined): void {
  file = chosen;
  fileName = file?.name ?? "";
  source = "file";
  update();
}
fileInput.addEventListener("change", () => pick(fileInput.files?.[0]));
onFileDrop(document.querySelector("main")!, (files) => {
  fileInput.value = "";
  pick(files[0]);
});

for (const name of ALGORITHMS) {
  const id = name.toLowerCase();
  const button = byId(id + "-copy");
  button.addEventListener("click", async () => {
    if (!(await copyText(byId(id).textContent ?? "", button)))
      showMessage(byId("status"), "Clipboard unavailable. Select and copy the digest.", true);
  });
}

byId("clear").addEventListener("click", () => {
  editor.setText("");
  fileInput.value = "";
  file = undefined;
  fileName = "";
  update();
  if (source === "text") editor.focus();
});

if (draft.error) {
  const status = byId("draft-status");
  status.hidden = false;
  showMessage(status, draft.error, true);
}
update();
