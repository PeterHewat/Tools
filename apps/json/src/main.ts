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
import {
  applyEdits,
  parse,
  type Edit,
  type JsonNode,
  type ParseResult,
  type RepairKind,
} from "./lib/ast.js";
import { createCodeView } from "./code-view.js";
import { excerptAt, formatBytes } from "./lib/inspect.js";
import { jsonPointer, jsPath, nodeAt, type PathSegment } from "./lib/path.js";
import { lineCount, pageAt, pageOf } from "./lib/pages.js";
import { printJson, printedSize } from "./lib/print.js";
import { createTree } from "./tree.js";
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
const codeEl = byId("code");
const treeEl = byId("tree");
const viewTextBtn = byId<HTMLButtonElement>("view-text");
const viewTreeBtn = byId<HTMLButtonElement>("view-tree");
const expandAllBtn = byId<HTMLButtonElement>("expand-all");
const collapseAllBtn = byId<HTMLButtonElement>("collapse-all");
const pathBtn = byId<HTMLButtonElement>("path");
const pathStyleBtn = byId<HTMLButtonElement>("path-style");
const pager = byId("pager");
const pageInput = byId<HTMLInputElement>("page-input");
const pageCountEl = byId("page-count");
const pageLines = byId("page-lines");
const pagePrev = byId<HTMLButtonElement>("page-prev");
const pageNext = byId<HTMLButtonElement>("page-next");
const view = createCodeView(codeEl, editor, byId("highlight"), byId("gutter"));
const tree = createTree(treeEl, {
  select: (path) => showPath(path),
  open: (node) => showInText(node),
});

/** The draft and options, kept across reloads. A convenience: the page works without it. */
const STORAGE_KEY = "workbench.json.draft";
/** Past this, a draft is not worth the storage quota it would eat. */
const MAX_SAVED = 2_000_000;

type ViewMode = "text" | "tree";
type PathStyle = "js" | "pointer";

interface Saved {
  text: string;
  indent: string;
  sortKeys: boolean;
  view: ViewMode;
  pathStyle: PathStyle;
}

let fileName = "data.json";
type Doc = Extract<ParseResult, { ok: true }>;
/** The parsed document while the text is strict JSON; null otherwise. */
let doc: Doc | null = null;
/** Typed since the last parse: `doc`'s positions may be off until it is parsed again. */
let stale = false;
/**
 * A long document is edited a page at a time (see lib/pages.ts). The document is always
 * `aside.before + editor.value + aside.after`; for a short one both are empty.
 */
let aside = { before: "", after: "" };
let page = { index: 0, count: 1, firstLine: 1 };
let mode: ViewMode = "text";
let pathStyle: PathStyle = "js";
/** The tree shows an older document until it is next opened. */
let treeStale = true;
/** Why the text is not JSON, and the edits that would make it JSON when there are some. */
let fault: { message: string; position: JsonPosition; edits: Edit[] | null } | null = null;

function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!saved) return;
    if (typeof saved.text === "string") showDocument(saved.text);
    if (saved.indent && [...indentSel.options].some((o) => o.value === saved.indent)) {
      indentSel.value = saved.indent;
    }
    sortKeys.checked = saved.sortKeys === true;
    if (saved.view === "tree") mode = "tree";
    if (saved.pathStyle === "pointer") pathStyle = "pointer";
  } catch {
    /* storage refused or holds something else: start empty */
  }
}

function save(): void {
  const full = documentText();
  const text = full.length > MAX_SAVED ? "" : full;
  const saved: Saved = {
    text,
    indent: indentSel.value,
    sortKeys: sortKeys.checked,
    view: mode,
    pathStyle,
  };
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

/** The whole document, whichever page the editor shows. */
function documentText(): string {
  return aside.before + editor.value + aside.after;
}

/** Puts a document in the editor, showing one of its pages. */
function showDocument(text: string, index = 0): void {
  const p = pageOf(text, index);
  aside = { before: p.before, after: p.after };
  page = { index: p.index, count: p.count, firstLine: p.firstLine };
  editor.value = p.body;
  view.setFirstLine(p.firstLine);
  showPager();
}

function showPager(): void {
  const paged = page.count > 1 && mode === "text";
  pager.classList.toggle("hidden", !paged);
  if (!paged) return;
  const last = page.firstLine + lineCount(editor.value) - 1;
  const total = last + lineCount(aside.after) - 1;
  pageInput.value = String(page.index + 1);
  pageInput.max = String(page.count);
  pageCountEl.textContent = page.count.toLocaleString();
  pageLines.textContent = `lines ${page.firstLine.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
  pagePrev.disabled = page.index === 0;
  pageNext.disabled = page.index === page.count - 1;
}

/** Turns to another page. The document does not change, so nothing is parsed again. */
function turnPage(index: number): void {
  if (index === page.index || index < 0 || index >= page.count) return;
  showDocument(documentText(), index);
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  view.refresh();
  showCursor();
}

/** Selects a stretch of the document, turning to its page, and scrolls it to the middle. */
function selectInDocument(start: number, end: number): void {
  const text = documentText();
  const index = pageAt(text, start);
  if (index !== page.index) showDocument(text, index);
  const offset = aside.before.length;
  const length = editor.value.length;
  editor.focus();
  editor.setSelectionRange(
    Math.min(Math.max(0, start - offset), length),
    Math.min(Math.max(0, end - offset), length)
  );
  const line = positionAt(editor.value, editor.selectionStart).line;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 2);
  view.refresh();
  showCursor();
}

function validate(): void {
  const text = documentText();
  const empty = !text.trim();
  const parsed = empty ? null : parse(text);
  doc = parsed?.ok && !parsed.edits.length ? parsed : null;
  stale = false;
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
    const formatted = printedSize(doc.root, { indent: indent() });
    const minified = printedSize(doc.root, { indent: 0 });
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
    } else if (text.length > LONG_TEXT && lineCount(text) < 100) {
      // Pages split lines, not characters: a minified megabyte is one line nothing can split.
      warning.textContent =
        "This is a few very long lines, which is slow to edit. Format it to edit it page by page.";
      warning.classList.remove("hidden");
    }
  } else if (fault) {
    const { line, column } = fault.position;
    status.textContent = `Line ${line}, column ${column}: ${fault.message}`;
    const { line: code, caret } = excerptAt(text, fault.position);
    const caretEl = document.createElement("span");
    caretEl.className = "caret";
    caretEl.textContent = caret;
    excerpt.replaceChildren(`${code}\n`, caretEl);
    fixBtn.classList.toggle("hidden", !fault.edits);
    fixNote.classList.toggle("hidden", !fault.edits);
    fixNote.textContent = fault.edits ? `Almost JSON: ${describeEdits(fault.edits)}.` : "";
  }
  view.setErrorLine(fault?.position.line ?? null);
  view.refresh();
  showPager();
  treeStale = true;
  if (mode === "tree") showTree();
  showCursor();
  save();
}

let pending = 0;
function validateSoon(): void {
  clearTimeout(pending);
  pending = window.setTimeout(validate, 150);
}

/** Past this, a document with hardly any line breaks gets a nudge to format it. */
const LONG_TEXT = 1_000_000;

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
  showDocument(text);
  if (mode === "text") editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  validate();
}

function replaceText(text: string): void {
  const current = documentText();
  if (text === current) return;
  undoStack.push({ before: current, after: text });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  setText(text);
}

/** Steps one rewrite back or forward. False when the text has moved on, so the browser handles the key. */
function stepHistory(back: boolean): boolean {
  const [from, to] = back ? [undoStack, redoStack] : [redoStack, undoStack];
  const step = from.at(-1);
  if (!step || documentText() !== (back ? step.after : step.before)) return false;
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
  if (fault?.edits) replaceText(applyEdits(documentText(), fault.edits));
}

/** The value under the caret, while the document is valid and parsed from the text as it is. */
function atCursor(): ReturnType<typeof nodeAt> | null {
  return doc && !stale ? nodeAt(doc.root, aside.before.length + editor.selectionStart) : null;
}

function showCursor(): void {
  if (mode !== "text") return;
  const before = editor.value.slice(0, editor.selectionStart);
  const line = page.firstLine + lineCount(before) - 1;
  const column = before.length - before.lastIndexOf("\n");
  cursor.textContent = `Ln ${line.toLocaleString()}, Col ${column}`;
  showPath(atCursor()?.path ?? null);
}

let shownPath: PathSegment[] | null = null;

/** The path of the value under the caret or selected in the tree; click it to copy. */
function showPath(path: PathSegment[] | null): void {
  shownPath = path;
  const text = path && (pathStyle === "js" ? jsPath(path) : jsonPointer(path));
  pathBtn.classList.toggle("hidden", !path);
  pathStyleBtn.classList.toggle("hidden", !path);
  pathBtn.textContent = text || "root";
  pathBtn.disabled = !text;
  pathStyleBtn.textContent = pathStyle === "js" ? "a.b" : "/a/b";
}

function showTree(): void {
  if (!treeStale) return;
  tree.show(
    doc?.root ?? null,
    fault ? "Not valid JSON: switch to Text to fix it." : "Nothing to show yet."
  );
  treeStale = false;
}

function setMode(next: ViewMode): void {
  mode = next;
  const inTree = mode === "tree";
  codeEl.classList.toggle("hidden", inTree);
  treeEl.classList.toggle("hidden", !inTree);
  expandAllBtn.classList.toggle("hidden", !inTree);
  collapseAllBtn.classList.toggle("hidden", !inTree);
  cursor.classList.toggle("hidden", inTree);
  showPager();
  viewTextBtn.setAttribute("aria-pressed", String(!inTree));
  viewTreeBtn.setAttribute("aria-pressed", String(inTree));
  if (inTree) {
    showTree();
    const at = atCursor();
    if (at) tree.reveal(at.indices);
    else showPath(null);
    tree.focus();
  } else {
    view.refresh();
    editor.focus();
    showCursor();
  }
  save();
}

/** Switches to the text with a value selected and scrolled to the middle. */
function showInText(node: JsonNode): void {
  setMode("text");
  selectInDocument(node.start, node.end);
}

function goToError(): void {
  if (!fault) return;
  const { offset } = fault.position;
  selectInDocument(offset, offset + 1);
}

async function load(file: File): Promise<void> {
  fileName = file.name;
  showDocument(await file.text());
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  validate();
  showCursor();
}

editor.addEventListener("input", () => {
  stale = true;
  validateSoon();
});
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
viewTextBtn.addEventListener("click", () => setMode("text"));
viewTreeBtn.addEventListener("click", () => setMode("tree"));
expandAllBtn.addEventListener("click", () => tree.expandAll());
collapseAllBtn.addEventListener("click", () => tree.collapseAll());
pagePrev.addEventListener("click", () => turnPage(page.index - 1));
pageNext.addEventListener("click", () => turnPage(page.index + 1));
pageInput.addEventListener("change", () => {
  const wanted = Math.round(Number(pageInput.value)) - 1;
  if (Number.isFinite(wanted)) turnPage(Math.min(Math.max(0, wanted), page.count - 1));
  showPager();
});
pathBtn.addEventListener("click", () => void copyText(pathBtn.textContent ?? "", pathBtn));
pathStyleBtn.addEventListener("click", () => {
  pathStyle = pathStyle === "js" ? "pointer" : "js";
  showPath(shownPath);
  save();
});

byId("open").addEventListener("click", async () => {
  const [file] = await pickFiles(".json,application/json,text/plain");
  if (file) await load(file);
});
copyBtn.addEventListener("click", async () => {
  const text = documentText();
  if (!(await copyText(text, copyBtn))) downloadText(fileName, text, "application/json");
});
downloadBtn.addEventListener("click", () =>
  downloadText(fileName, documentText(), "application/json")
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
setMode(mode);

registerServiceWorker();
