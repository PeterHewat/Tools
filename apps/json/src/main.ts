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
import { lineCount, lineOf, lineStarts, pageAt, pageOf } from "./lib/pages.js";
import { printJson, printedSize } from "./lib/print.js";
import { findInText, findInTree, MAX_MATCHES, type NodeMatch } from "./lib/search.js";
import { toCsv, toJsonSchema, toTypeScript, toYaml, type Converted } from "./lib/convert.js";
import { unwrapString, wrapAsString } from "./lib/nested.js";
import { createTree } from "./tree.js";
import "./styles.css";

const editor = byId<HTMLTextAreaElement>("editor");
const formatBtn = byId<HTMLButtonElement>("format");
const minifyBtn = byId<HTMLButtonElement>("minify");
const sortKeys = byId<HTMLButtonElement>("sort-keys");
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
const findBar = byId("findbar");
const findInput = byId<HTMLInputElement>("find-input");
const findCount = byId("find-count");
const findCase = byId<HTMLButtonElement>("find-case");
const toolsMenu = byId("tools-menu");
const toolsBtn = byId<HTMLButtonElement>("tools-btn");
const output = byId<HTMLDialogElement>("output");
const outputTitle = byId("output-title");
const outputText = byId("output-text");
const outputCopy = byId<HTMLButtonElement>("output-copy");
const view = createCodeView(codeEl, editor, byId("highlight"), byId("gutter"));
const tree = createTree(treeEl, {
  select: (path, _node, indices) => {
    treeSelection = indices;
    showPath(path);
  },
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
/** Child positions of the row selected in the tree. */
let treeSelection: number[] = [];
/** Valid and on one line: sorting keeps it minified, and there is no indent to choose. */
let minified = false;
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
    setPressed(sortKeys, saved.sortKeys === true);
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
    sortKeys: isPressed(sortKeys),
    view: mode,
    pathStyle,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* storage refused or full */
  }
}

/** Toggle buttons keep their state in aria-pressed, which is also what they are styled by. */
const isPressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";
const setPressed = (button: HTMLElement, on: boolean) =>
  button.setAttribute("aria-pressed", String(on));

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
  showMarks();
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
function selectInDocument(start: number, end: number, focus = true): void {
  const text = documentText();
  const index = pageAt(text, start);
  if (index !== page.index) showDocument(text, index);
  const offset = aside.before.length;
  const length = editor.value.length;
  if (focus) editor.focus();
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

// ---------- Tools: nested JSON and export ----------

/** The values from the root down to the one under the caret, or selected in the tree. */
function contextChain(): JsonNode[] {
  if (!doc || stale) return [];
  const indices = mode === "tree" ? treeSelection : (atCursor()?.indices ?? []);
  const chain: JsonNode[] = [doc.root];
  for (const k of indices) {
    const node = chain.at(-1)!;
    const next =
      node.kind === "object"
        ? node.members[k]?.value
        : node.kind === "array"
          ? node.items[k]
          : null;
    if (!next) break;
    chain.push(next);
  }
  return chain;
}

interface Export {
  title: string;
  extension: string;
  make: () => Converted;
}

const EXPORTS: Record<string, Export> = {
  yaml: { title: "YAML", extension: ".yaml", make: () => ({ ok: true, text: toYaml(doc!.root) }) },
  csv: {
    title: "CSV",
    extension: ".csv",
    // The innermost array around the caret, so a table nested in a document still exports.
    make: () => toCsv(contextChain().findLast((n) => n.kind === "array") ?? doc!.root),
  },
  ts: {
    title: "TypeScript types",
    extension: ".d.ts",
    make: () => ({ ok: true, text: toTypeScript(doc!.root) }),
  },
  schema: {
    title: "JSON Schema",
    extension: ".schema.json",
    make: () => ({ ok: true, text: toJsonSchema(doc!.root) }),
  },
};

let outputName = "";

function showExport(kind: string): void {
  const spec = EXPORTS[kind];
  if (!spec || !doc) return;
  let result: Converted;
  try {
    result = spec.make();
  } catch (err) {
    // Converters recurse; a document nested thousands deep can exhaust the stack.
    result = {
      ok: false,
      message: err instanceof RangeError ? "Too deeply nested to convert." : String(err),
    };
  }
  outputTitle.textContent = spec.title;
  outputText.textContent = result.ok ? result.text : result.message;
  outputText.classList.toggle("error", !result.ok);
  outputCopy.disabled = !result.ok;
  byId<HTMLButtonElement>("output-download").disabled = !result.ok;
  outputName = fileName.replace(/\.json$/i, "") + spec.extension;
  output.showModal();
}

/** Enables the menu's items for what is under the caret, and names what they will act on. */
function prepareTools(): void {
  const chain = contextChain();
  const node = chain.at(-1);
  const unwrap = toolsMenu.querySelector<HTMLButtonElement>('[data-action="unwrap"]')!;
  const wrap = toolsMenu.querySelector<HTMLButtonElement>('[data-action="wrap"]')!;
  unwrap.disabled = !node || unwrapString(documentText(), node, indent()) === null;
  unwrap.title = unwrap.disabled
    ? "Put the cursor on a string that holds a JSON object or array"
    : "";
  wrap.disabled = !node;
  wrap.textContent = chain.length > 1 ? "Wrap value in a string" : "Wrap document in a string";
  for (const b of toolsMenu.querySelectorAll<HTMLButtonElement>("[data-export]")) {
    b.disabled = !doc || stale;
  }
}

function runTool(action: string): void {
  const node = contextChain().at(-1);
  if (!node) return;
  const text = documentText();
  const next = action === "unwrap" ? unwrapString(text, node, indent()) : wrapAsString(text, node);
  if (next !== null) replaceText(next);
}

// ---------- Find ----------

/** Bumped whenever the text changes, so find results know when they are out of date. */
let findVersion = 0;
let findKey = "";
let textMatches: number[] = [];
let treeMatches: NodeMatch[] = [];
let findIndex = -1;

const findOpen = () => !findBar.classList.contains("hidden");

/** Searches again when the query, the options, the view or the text changed. */
function refreshFind(): void {
  const query = findInput.value;
  const key = [query, isPressed(findCase), mode, findVersion].join("\u0000");
  if (key === findKey) return;
  findKey = key;
  const options = { matchCase: isPressed(findCase) };
  textMatches = mode === "text" ? findInText(documentText(), query, options) : [];
  treeMatches = mode === "tree" && doc && !stale ? findInTree(doc.root, query, options) : [];
  findIndex = Math.min(findIndex, matchCount() - 1);
  showFindCount();
  showMarks();
}

const matchCount = () => (mode === "text" ? textMatches.length : treeMatches.length);

function showFindCount(): void {
  const n = matchCount();
  const capped = n >= MAX_MATCHES ? "+" : "";
  findCount.textContent = !findInput.value
    ? ""
    : !n
      ? "No matches"
      : findIndex < 0
        ? `${n.toLocaleString()}${capped} matches`
        : `${(findIndex + 1).toLocaleString()} of ${n.toLocaleString()}${capped}`;
  findBar.classList.toggle("no-match", !!findInput.value && !n);
}

/** Marks the matches on the page the editor shows; the current one stands out. */
function showMarks(): void {
  if (!findOpen() || mode !== "text" || !textMatches.length) {
    view.setMarks([]);
    return;
  }
  const offset = aside.before.length;
  const end = offset + editor.value.length;
  const size = findInput.value.length;
  let k = 0;
  while (k < textMatches.length && textMatches[k] + size <= offset) k++;
  const marks = [];
  for (; k < textMatches.length && textMatches[k] < end; k++) {
    const start = textMatches[k] - offset;
    marks.push({ start, end: start + size, current: k === findIndex });
  }
  view.setMarks(marks);
}

/** Moves to the next (1) or previous (-1) match; 0 picks the first at or after the caret. */
function findStep(delta: number): void {
  refreshFind();
  const n = matchCount();
  if (!n) {
    findIndex = -1;
    showFindCount();
    return;
  }
  if (findIndex < 0 || delta === 0) {
    const caret = aside.before.length + editor.selectionStart;
    const after =
      mode === "text"
        ? textMatches.findIndex((m) => m >= caret)
        : treeMatches.findIndex((m) => m.node.start >= caret);
    findIndex = after < 0 ? 0 : after;
    if (delta < 0) findIndex = (findIndex - 1 + n) % n;
  } else {
    findIndex = (findIndex + delta + n) % n;
  }
  if (mode === "text") {
    const start = textMatches[findIndex];
    selectInDocument(start, start + findInput.value.length, false);
  } else {
    tree.reveal(treeMatches[findIndex].indices);
  }
  showFindCount();
  showMarks();
}

function openFind(): void {
  findBar.classList.remove("hidden");
  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (mode === "text" && selected && selected.length < 200 && !selected.includes("\n")) {
    findInput.value = selected;
  }
  findInput.focus();
  findInput.select();
  findKey = "";
  refreshFind();
}

function closeFind(): void {
  findBar.classList.add("hidden");
  view.setMarks([]);
  if (mode === "text") editor.focus();
  else tree.focus();
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
  formatBtn.disabled = minifyBtn.disabled = sortKeys.disabled = !doc;
  // Minified text has no indent to change, so the choice waits, disabled, until Format.
  minified = !!doc && !text.includes("\n");
  indentSel.disabled = !doc || minified;
  showViewControls();
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
    const minifiedSize = printedSize(doc.root, { indent: 0 });
    // Two halves, so a narrow screen can break the line between them (see styles.css).
    const sizes = document.createElement("span");
    sizes.className = "sizes";
    sizes.append(
      Object.assign(document.createElement("span"), { className: "sep", textContent: " · " }),
      `${formatBytes(formatted)} Formatted · ${formatBytes(minifiedSize)} Minified`
    );
    status.replaceChildren(
      `Valid JSON · ${plural(doc.values, "value")} · ${plural(doc.depth, "level")} deep`,
      sizes
    );
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
  findVersion++;
  if (!findBar.classList.contains("hidden")) refreshFind();
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

function rewrite(minify: boolean): void {
  if (!doc) return;
  minified = minify;
  replaceText(
    printJson(doc.root, { indent: minify ? 0 : indent(), sortKeys: isPressed(sortKeys) })
  );
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
  const starts = lineStarts(documentText());
  tree.show(
    doc?.root ?? null,
    fault ? "Not valid JSON: switch to Text to fix it." : "Nothing to show yet.",
    (offset) => lineOf(starts, offset)
  );
  treeStale = false;
}

function setMode(next: ViewMode): void {
  mode = next;
  const inTree = mode === "tree";
  codeEl.classList.toggle("hidden", inTree);
  treeEl.classList.toggle("hidden", !inTree);
  showViewControls();
  cursor.classList.toggle("hidden", inTree);
  showPager();
  if (findOpen()) {
    findIndex = -1;
    refreshFind();
  }
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

/** Expand and collapse act on the tree: disabled, not hidden, while it is not shown. */
function showViewControls(): void {
  expandAllBtn.disabled = collapseAllBtn.disabled = mode !== "tree" || !doc;
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

// Select all + paste on a long document means "replace it", not "replace this page": Ctrl+A
// can only select the page the editor holds.
editor.addEventListener("paste", (e) => {
  const all = editor.selectionStart === 0 && editor.selectionEnd === editor.value.length;
  const pasted = e.clipboardData?.getData("text/plain");
  if (page.count > 1 && all && pasted !== undefined) {
    e.preventDefault();
    replaceText(pasted);
  }
});
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
sortKeys.addEventListener("click", () => {
  setPressed(sortKeys, !isPressed(sortKeys));
  if (doc) rewrite(minified);
  else save();
});
indentSel.addEventListener("change", () => (doc ? rewrite(false) : validate()));
byId("goto").addEventListener("click", goToError);
fixBtn.addEventListener("click", fix);
viewTextBtn.addEventListener("click", () => setMode("text"));
viewTreeBtn.addEventListener("click", () => setMode("tree"));
expandAllBtn.addEventListener("click", () => tree.expandAll());
collapseAllBtn.addEventListener("click", () => tree.collapseAll());
toolsMenu.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState !== "open") return;
  clearTimeout(pending);
  if (stale) validate();
  prepareTools();
  // Popovers open in the top layer; place this one under its button.
  const r = toolsBtn.getBoundingClientRect();
  toolsMenu.style.top = `${r.bottom + 4}px`;
  toolsMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 248))}px`;
});
toolsMenu.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!item || item.disabled) return;
  toolsMenu.hidePopover();
  if (item.dataset.export) showExport(item.dataset.export);
  else if (item.dataset.action) runTool(item.dataset.action);
});
toolsMenu.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...toolsMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
});
toolsMenu.addEventListener("toggle", (e) => {
  if ((e as ToggleEvent).newState === "open") {
    toolsMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }
});
outputCopy.addEventListener("click", () => void copyText(outputText.textContent ?? "", outputCopy));
byId("output-download").addEventListener("click", () =>
  downloadText(outputName, outputText.textContent ?? "")
);
byId("output-close").addEventListener("click", () => output.close());

let findTimer = 0;
findInput.addEventListener("input", () => {
  clearTimeout(findTimer);
  findTimer = window.setTimeout(() => findStep(0), 120);
});
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(findTimer);
    findStep(e.shiftKey ? -1 : 1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFind();
  }
});
findCase.addEventListener("click", () => {
  setPressed(findCase, !isPressed(findCase));
  findStep(0);
});
byId("find-prev").addEventListener("click", () => findStep(-1));
byId("find-next").addEventListener("click", () => findStep(1));
byId("find-close").addEventListener("click", closeFind);
byId("find-open").addEventListener("click", openFind);
// Ctrl+F opens this find rather than the browser's, which cannot see other pages of a long
// document; F3 steps through matches like most editors.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openFind();
  } else if (e.key === "F3") {
    e.preventDefault();
    if (!findOpen()) openFind();
    else findStep(e.shiftKey ? -1 : 1);
  }
});
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
