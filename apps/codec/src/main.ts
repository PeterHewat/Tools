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
import { FORMATS, readValue, writeAll } from "./lib/convert.js";
import type { Format } from "./lib/convert.js";
bindToolHelp("codec");
registerServiceWorker();

const NAMES: Record<Format, string> = {
  text: "UTF-8 text",
  url: "URL component",
  base64: "Base64",
  base64url: "Base64url",
  hex: "Hex",
};
const examples: { label: string; value: string; from: Format }[] = [
  { label: "Unicode text", value: "Hello, 🌍!\n", from: "text" },
  { label: "URL component", value: "hello%20world%20%2B%20caf%C3%A9%20%2F", from: "url" },
  { label: "Binary bytes", value: "00 ff 10 7f 80", from: "hex" },
  { label: "Base64url token header", value: "eyJhbGciOiJIUzI1NiJ9", from: "base64url" },
  { label: "Invisible characters", value: "\ufeffline 1\r\nline 2\t\u0000", from: "text" },
];

/** This tab's work, in session storage: the field last edited and what it holds. */
const DRAFT = 1;
const draft = readDraft("codec", DRAFT);

/** The field being edited: the others are written from its bytes. */
let source: Format = "text";

const editors = Object.fromEntries(
  FORMATS.map((format) => [
    format,
    createEditor(byId(format), {
      label: NAMES[format],
      lineWrapping: true,
      exact: true,
      onChange: (user) => {
        if (!user) return;
        source = format;
        update();
      },
    }),
  ])
) as Record<Format, Editor>;

function note(format: Format, text: string, error = false): void {
  const element = byId(format + "-note");
  element.textContent = text;
  element.dataset.error = String(error);
}

function update(): void {
  let bytes: Uint8Array;
  try {
    bytes = readValue(editors[source].text, source);
  } catch (error) {
    note(source, (error as Error).message, true);
    for (const format of FORMATS)
      byId(format + "-card").toggleAttribute("data-stale", format !== source);
    save();
    return;
  }
  const all = writeAll(bytes);
  for (const format of FORMATS) {
    byId(format + "-card").removeAttribute("data-stale");
    const value = all[format];
    if (format !== source) editors[format].setText(value ?? "", "sync");
    byId<HTMLButtonElement>(format + "-copy").disabled = value === null;
    note(format, value === null ? "Not valid UTF-8: these bytes have no text." : "");
  }
  byId("count").textContent =
    bytes.length === 1 ? "1 byte" : bytes.length.toLocaleString() + " bytes";
  save();
}

function save(): void {
  if (draft.error) return;
  if (!writeDraft("codec", DRAFT, { source, value: editors[source].text })) {
    const status = byId("status");
    status.hidden = false;
    showMessage(status, "Draft could not be remembered (storage unavailable or over 2 MB).", true);
  }
}

function load(value: string, from: Format): void {
  source = from;
  for (const format of FORMATS) if (format !== from) editors[format].setText("", "sync");
  editors[from].setText(value);
  update();
}

const sample = byId<HTMLSelectElement>("examples");
for (const [index, example] of examples.entries())
  sample.add(new Option(example.label, String(index)));
sample.addEventListener("change", () => {
  const example = examples[Number(sample.value)];
  if (example) load(example.value, example.from);
  sample.value = "";
});
byId("clear").addEventListener("click", () => {
  load("", "text");
  editors.text.focus();
});
for (const format of FORMATS) {
  const button = byId(format + "-copy");
  button.addEventListener("click", async () => {
    if (!(await copyText(editors[format].text, button))) {
      const status = byId("status");
      status.hidden = false;
      showMessage(status, "Clipboard unavailable. Select and copy the text.", true);
    }
  });
}

if (draft.error) {
  const status = byId("status");
  status.hidden = false;
  showMessage(status, draft.error, true);
} else {
  const { source: saved, value } = draft.value;
  if (FORMATS.includes(saved as Format) && typeof value === "string") load(value, saved as Format);
  else load(examples[0].value, examples[0].from);
}
