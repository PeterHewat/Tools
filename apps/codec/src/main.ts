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
/**
 * A new tab shows several scripts, composed and combining accents, emoji, URL punctuation
 * and invisible characters: BOM, CRLF, nonbreaking and zero-width spaces, a tab and a null.
 */
const EXAMPLE =
  "\ufeffCafé / Cafe\u0301 — Ελληνικά 中文 日本語 Привет العربية 🌍 🚀\r\n" +
  'URL: a+b=c&x/y? #100% "quotes" <tag> \\\r\n' +
  "Invisible: A\u00a0B\u200bC\tEnd\u0000";

/** This tab's work, in session storage: the field last edited and what it holds. */
const DRAFT = 1;
const draft = readDraft("codec", DRAFT);

/** The field being edited: the others are written from its bytes. */
let source: Format = "text";
/** The bytes as UTF-8 text, for Digests; null while they cannot be read or are not text. */
let asText: string | null = "";

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
    asText = null;
    // The other fields still hold the last bytes that read: shown, but not copied as current.
    for (const format of FORMATS) {
      const stale = format !== source;
      byId(format + "-card").toggleAttribute("data-stale", stale);
      byId<HTMLButtonElement>(format + "-copy").disabled = stale;
      if (stale) note(format, "");
    }
    save();
    return;
  }
  const all = writeAll(bytes);
  asText = all.text;
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

/** Digests opens on the same text, keeping its own settings (HMAC, key, encoding). */
const toDigests = byId<HTMLAnchorElement>("to-digests");
toDigests.addEventListener("click", (event) => {
  event.preventDefault();
  if (asText === null) {
    const status = byId("status");
    status.hidden = false;
    showMessage(status, "Digests hashes text: these bytes are not valid UTF-8.", true);
    return;
  }
  const digests = readDraft("digests", 1);
  writeDraft("digests", 1, {
    ...(digests.error ? {} : digests.value),
    text: asText,
    source: "text",
  });
  location.href = toDigests.href;
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
  else load(EXAMPLE, "text");
}
