import { parseJson, positionAt, type JsonPosition } from "@workbench/codec";
import {
  bindThemeToggle,
  byId,
  copyText,
  downloadText,
  onFileDrop,
  pickFiles,
  registerServiceWorker,
} from "@workbench/ui";
import "@workbench/ui/base.css";
import { applyEdits, parse, type Edit, type ParseResult, type RepairKind } from "./lib/ast.js";
import { byteSize, excerptAt, formatBytes } from "./lib/inspect.js";
import { printJson } from "./lib/print.js";
import "./styles.css";

const editor = byId<HTMLTextAreaElement>("editor");
const formatBtn = byId<HTMLButtonElement>("format");
const minifyBtn = byId<HTMLButtonElement>("minify");
const sortKeys = byId<HTMLInputElement>("sort-keys");
const indentSel = byId<HTMLSelectElement>("indent");
const copyBtn = byId<HTMLButtonElement>("copy");
const downloadBtn = byId<HTMLButtonElement>("download");
const clearBtn = byId<HTMLButtonElement>("clear");
const status = byId("status");
const cursor = byId("cursor");
const warning = byId("warning");
const problem = byId("problem");
const excerpt = byId("excerpt");
const fixBtn = byId<HTMLButtonElement>("fix");
const fixNote = byId("fix-note");

/** The draft and options, kept across reloads. A convenience: the page works without it. */
const STORAGE_KEY = "workbench.json.draft";
/** Past this, a draft is not worth the storage quota it would eat. */
const MAX_SAVED = 2_000_000;

interface Saved {
  text: string;
  indent: string;
  sortKeys: boolean;
}

let fileName = "data.json";
type Doc = Extract<ParseResult, { ok: true }>;
/** The parsed document while the text is strict JSON; null otherwise. */
let doc: Doc | null = null;
/** Why the text is not JSON, and the edits that would make it JSON when there are some. */
let fault: { message: string; position: JsonPosition; edits: Edit[] | null } | null = null;

function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!saved) return;
    if (typeof saved.text === "string") editor.value = saved.text;
    if (saved.indent && [...indentSel.options].some((o) => o.value === saved.indent)) {
      indentSel.value = saved.indent;
    }
    sortKeys.checked = saved.sortKeys === true;
  } catch {
    /* storage refused or holds something else: start empty */
  }
}

function save(): void {
  const text = editor.value.length > MAX_SAVED ? "" : editor.value;
  const saved: Saved = { text, indent: indentSel.value, sortKeys: sortKeys.checked };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* storage refused or full */
  }
}

function indent(): number | "\t" {
  return indentSel.value === "tab" ? "\t" : Number(indentSel.value);
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

const REPAIR_WORDS: Record<RepairKind, string> = {
  comment: "comment",
  "trailing comma": "trailing comma",
  "single quotes": "single-quoted string",
  "unquoted key": "unquoted key",
  "string escape": "non-JSON string escape",
  number: "non-JSON number",
  "NaN or Infinity": "NaN or Infinity (becomes null)",
  literal: "Python or JavaScript literal",
  whitespace: "non-JSON space",
};

/** "3 comments, 1 trailing comma": what a Fix would change, most common first. */
function describeEdits(edits: readonly Edit[]): string {
  const counts = new Map<RepairKind, number>();
  for (const e of edits) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => plural(n, REPAIR_WORDS[kind]))
    .join(", ");
}

function validate(): void {
  const text = editor.value;
  const empty = !text.trim();
  const parsed = empty ? null : parse(text);
  doc = parsed?.ok && !parsed.edits.length ? parsed : null;
  fault = null;
  if (parsed && !doc) {
    // The strict parser words errors best; the lenient one knows whether a Fix exists.
    const strict = parseJson(text);
    const edits = parsed.ok ? parsed.edits : null;
    fault = !strict.ok
      ? { message: strict.message, position: strict.position, edits }
      : !parsed.ok
        ? { message: parsed.message, position: positionAt(text, parsed.offset), edits }
        : null;
  }

  for (const b of [copyBtn, downloadBtn, clearBtn]) b.disabled = empty;
  formatBtn.disabled = minifyBtn.disabled = !doc;
  status.classList.toggle("wb-status--error", !!fault);
  status.classList.toggle("wb-status--ok", !!doc);
  problem.classList.toggle("hidden", !fault);
  warning.classList.add("hidden");

  if (empty) {
    status.textContent = "Paste JSON, open a file or drop one on the editor.";
  } else if (doc) {
    // Sizes of both forms, not of the text as it stands, so Format and Minify leave the line
    // unchanged: it describes the document, and only an edit or a new file changes that.
    const formatted = byteSize(printJson(doc.root, { indent: indent() }));
    const minified = byteSize(printJson(doc.root, { indent: 0 }));
    status.textContent =
      `Valid JSON · ${plural(doc.values, "value")} · ${plural(doc.depth, "level")} deep` +
      ` · ${formatBytes(formatted)} Formatted · ${formatBytes(minified)} Minified`;
    const [first, ...more] = doc.duplicates;
    if (first) {
      warning.textContent =
        `Duplicate key "${first.key}" on line ${positionAt(text, first.offset).line}` +
        (more.length ? `, and ${plural(more.length, "more")}` : "") +
        ". Formatting keeps every copy; JSON.parse would keep only the last.";
      warning.classList.remove("hidden");
    }
  } else if (fault) {
    const { line, column } = fault.position;
    status.textContent = `Line ${line}, column ${column}: ${fault.message}`;
    const { line: code, caret } = excerptAt(text, fault.position);
    const caretEl = document.createElement("span");
    caretEl.className = "caret";
    caretEl.textContent = caret;
    excerpt.replaceChildren(
      `${code}
`,
      caretEl
    );
    fixBtn.classList.toggle("hidden", !fault.edits);
    fixNote.classList.toggle("hidden", !fault.edits);
    fixNote.textContent = fault.edits ? `Almost JSON: ${describeEdits(fault.edits)}.` : "";
  }
  save();
}

let pending = 0;
function validateSoon(): void {
  clearTimeout(pending);
  pending = window.setTimeout(validate, 150);
}

/**
 * Whole-text rewrites (Format, Minify, Clear), undone by the app rather than the browser.
 * `execCommand("insertText")` would put them on the browser's own undo stack, but Chromium
 * inserts line by line and takes seconds on a few thousand lines. Assigning `value` is instant
 * and resets the browser's stack instead, so Ctrl+Z / Ctrl+Y step through these here, whenever
 * the text still reads exactly as a rewrite left it.
 */
interface Rewrite {
  before: string;
  after: string;
}
const undoStack: Rewrite[] = [];
const redoStack: Rewrite[] = [];
/** Each step holds two copies of the document; a few are plenty. */
const MAX_UNDO = 20;

function setText(text: string): void {
  editor.value = text;
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  validate();
}

function replaceText(text: string): void {
  if (text === editor.value) return;
  undoStack.push({ before: editor.value, after: text });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  setText(text);
}

/** Steps one rewrite back or forward. False when the text has moved on, so the browser handles the key. */
function stepHistory(back: boolean): boolean {
  const [from, to] = back ? [undoStack, redoStack] : [redoStack, undoStack];
  const step = from.at(-1);
  if (!step || editor.value !== (back ? step.after : step.before)) return false;
  from.pop();
  to.push(step);
  setText(back ? step.before : step.after);
  return true;
}

/** The layout last applied, so a new option re-applies it: sorting minified text keeps it minified. */
let minified = false;

function rewrite(minify: boolean): void {
  if (!doc) return;
  minified = minify;
  replaceText(printJson(doc.root, { indent: minify ? 0 : indent(), sortKeys: sortKeys.checked }));
}

/** Makes almost-JSON strict in place, keeping the layout: only the offending bits change. */
function fix(): void {
  if (fault?.edits) replaceText(applyEdits(editor.value, fault.edits));
}

function showCursor(): void {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  cursor.textContent = `Ln ${line}, Col ${column}`;
}

function goToError(): void {
  if (!fault) return;
  const { offset, line } = fault.position;
  editor.focus();
  editor.setSelectionRange(offset, Math.min(offset + 1, editor.value.length));
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  showCursor();
}

async function load(file: File): Promise<void> {
  fileName = file.name;
  editor.value = await file.text();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  validate();
  showCursor();
}

editor.addEventListener("input", validateSoon);
for (const type of ["keyup", "click", "select", "focus"]) {
  editor.addEventListener(type, showCursor);
}
editor.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    clearTimeout(pending);
    validate();
    rewrite(false);
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const undo = mod && key === "z" && !e.shiftKey;
  const redo = mod && (key === "y" || (key === "z" && e.shiftKey));
  if ((undo || redo) && stepHistory(undo)) e.preventDefault();
});

formatBtn.addEventListener("click", () => rewrite(false));
minifyBtn.addEventListener("click", () => rewrite(true));
// Picking an option means "show it like this", so it applies at once (and Ctrl+Z takes it back).
// With nothing valid to rewrite, validate() still refreshes the formatted size and saves.
sortKeys.addEventListener("change", () => (doc ? rewrite(minified) : save()));
indentSel.addEventListener("change", () => (doc ? rewrite(false) : validate()));
byId("goto").addEventListener("click", goToError);
fixBtn.addEventListener("click", fix);

byId("open").addEventListener("click", async () => {
  const [file] = await pickFiles(".json,application/json,text/plain");
  if (file) await load(file);
});
copyBtn.addEventListener("click", async () => {
  if (!(await copyText(editor.value, copyBtn)))
    downloadText(fileName, editor.value, "application/json");
});
downloadBtn.addEventListener("click", () =>
  downloadText(fileName, editor.value, "application/json")
);
clearBtn.addEventListener("click", () => {
  fileName = "data.json";
  replaceText("");
});

onFileDrop(editor, ([file]) => {
  if (file) void load(file);
});

bindThemeToggle(byId("theme-toggle"));
restore();
validate();
showCursor();

registerServiceWorker();
