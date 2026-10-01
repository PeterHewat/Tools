import { toHex } from "@tools/bytes";
import {
  bindToolHelp,
  byId,
  copyText,
  fieldValues,
  readDraft,
  registerServiceWorker,
  restoreFields,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { convert, readValue } from "./lib/convert.js";
import type { Format } from "./lib/convert.js";
bindToolHelp("codec");
registerServiceWorker();
const ids = ["left", "right", "left-format", "right-format"];
const draft = readDraft("codec", 1);
const field = (side: string) => byId<HTMLTextAreaElement>(side);
const format = (side: string) => byId<HTMLSelectElement>(side + "-format");
const examples = [
  { label: "Unicode · UTF-8 → Base64", value: "Hello, 🌍!\n", from: "text", to: "base64" },
  { label: "URL component · text → URL", value: "hello world + café /", from: "text", to: "url" },
  { label: "Binary bytes · hex → Base64", value: "00 ff 10 7f 80", from: "hex", to: "base64" },
  {
    label: "Base64url · token bytes → text",
    value: "eyJhbGciOiJIUzI1NiJ9",
    from: "base64url",
    to: "text",
  },
  {
    label: "Invisible characters · text → hex",
    value: "\ufeffline 1\r\nline 2\t\u0000",
    from: "text",
    to: "hex",
  },
];
let active =
  typeof draft.value.active === "string" && draft.value.active === "right" ? "right" : "left";
let composing = false;
function save(): void {
  if (!writeDraft("codec", 1, { ...fieldValues(ids), active }))
    showMessage(
      byId("status"),
      "Draft could not be remembered (storage unavailable or over 2 MB).",
      true
    );
}
function inspect(side: string): void {
  try {
    const bytes = readValue(field(side).value, format(side).value as Format);
    byId(side + "-bytes").textContent =
      toHex(bytes.subarray(0, 4096)).replace(/(..)/g, "$1 ").trim() +
      (bytes.length > 4096 ? "\n… first 4096 bytes shown" : "");
    showMessage(byId(side + "-status"), bytes.length.toLocaleString() + " bytes");
  } catch (error) {
    byId(side + "-bytes").textContent = "";
    showMessage(byId(side + "-status"), (error as Error).message, true);
  }
}
function update(side: string): void {
  if (draft.error || composing) return;
  active = side;
  const target = side === "left" ? "right" : "left";
  try {
    field(target).value = convert(
      field(side).value,
      format(side).value as Format,
      format(target).value as Format
    ).text;
    showMessage(byId("status"), "Live · " + side + " → " + target);
  } catch (error) {
    field(target).value = "";
    showMessage(byId("status"), (error as Error).message, true);
  }
  inspect(side);
  inspect(target);
  save();
}
function loadExample(index: number): void {
  const example = examples[index];
  if (!example) return;
  format("left").value = example.from;
  format("right").value = example.to;
  field("left").value = example.value;
  update("left");
}
const sample = byId<HTMLSelectElement>("examples");
for (const [index, example] of examples.entries())
  sample.add(new Option(example.label, String(index)));
sample.addEventListener("change", () => {
  loadExample(Number(sample.value));
  sample.value = "";
});
for (const side of ["left", "right"]) {
  field(side).addEventListener("compositionstart", () => {
    composing = true;
  });
  field(side).addEventListener("compositionend", () => {
    composing = false;
    update(side);
  });
  field(side).addEventListener("input", () => update(side));
  format(side).addEventListener("change", () => update(active));
  byId(side + "-copy").addEventListener("click", async () => {
    if (!(await copyText(field(side).value, byId(side + "-copy"))))
      showMessage(byId("status"), "Clipboard unavailable. Select and copy the text.", true);
  });
  byId(side + "-clear").addEventListener("click", () => {
    field(side).value = "";
    update(side);
    field(side).focus();
  });
}
if (draft.error) showMessage(byId("status"), draft.error, true);
else if (draft.found) {
  restoreFields(draft.value, ids);
  inspect("left");
  inspect("right");
} else loadExample(0);
