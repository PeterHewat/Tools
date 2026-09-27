import { formatJson, parseJson, type JsonResult } from "@workbench/codec";
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
import { byteSize, excerptAt, formatBytes, shapeOf } from "./lib/inspect.js";
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
let result: JsonResult | null = null;

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

function validate(): void {
  const text = editor.value;
  const empty = !text.trim();
  result = empty ? null : parseJson(text);

  for (const b of [formatBtn, minifyBtn, copyBtn, downloadBtn, clearBtn]) b.disabled = empty;
  formatBtn.disabled = minifyBtn.disabled = !result?.ok;
  status.classList.toggle("wb-status--error", result?.ok === false);
  status.classList.toggle("wb-status--ok", result?.ok === true);
  problem.classList.toggle("hidden", result?.ok !== false);
  warning.classList.add("hidden");

  if (!result) {
    status.textContent = "Paste JSON, open a file or drop one on the editor.";
  } else if (result.ok) {
    const shape = shapeOf(result.value);
    const plural = (n: number, word: string) =>
      `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
    // Sizes of both forms, not of the text as it stands, so Format and Minify leave the line
    // unchanged: it describes the document, and only an edit or a new file changes that.
    const formatted = byteSize(formatJson(result.value, { indent: indent() }));
    const minified = byteSize(formatJson(result.value, { indent: 0 }));
    status.textContent =
      `Valid JSON · ${plural(shape.values, "value")} · ${plural(shape.depth, "level")} deep` +
      ` · ${formatBytes(formatted)} Formatted · ${formatBytes(minified)} Minified`;
    if (shape.unsafeIntegers) {
      warning.textContent =
        `${plural(shape.unsafeIntegers, "integer")} ${shape.unsafeIntegers === 1 ? "is" : "are"}` +
        " too large to hold exactly. Format and Minify will round " +
        (shape.unsafeIntegers === 1 ? "it." : "them.");
      warning.classList.remove("hidden");
    }
  } else {
    const { line, column } = result.position;
    status.textContent = `Line ${line}, column ${column}: ${result.message}`;
    const { line: code, caret } = excerptAt(text, result.position);
    const caretEl = document.createElement("span");
    caretEl.className = "caret";
    caretEl.textContent = caret;
    excerpt.replaceChildren(`${code}\n`, caretEl);
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
  if (!result?.ok) return;
  minified = minify;
  replaceText(
    formatJson(result.value, { indent: minify ? 0 : indent(), sortKeys: sortKeys.checked })
  );
}

function showCursor(): void {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  cursor.textContent = `Ln ${line}, Col ${column}`;
}

function goToError(): void {
  if (!result || result.ok) return;
  const { offset, line } = result.position;
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
sortKeys.addEventListener("change", () => (result?.ok ? rewrite(minified) : save()));
indentSel.addEventListener("change", () => (result?.ok ? rewrite(false) : validate()));
byId("goto").addEventListener("click", goToError);

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
