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
import { createCodeView, type Lexer } from "./code-view.js";
import { highlightLine } from "./lib/highlight.js";
import { lexCsv, lexPlain, lexTypeScript, lexYaml } from "./lib/lexers.js";
import { toCsv, toJsonSchema, toTypeScript, toYaml, type Converted } from "./lib/convert.js";
import { excerptAt, formatBytes } from "./lib/inspect.js";
import { unwrapString, wrapAsString } from "./lib/nested.js";
import { lineCount, lineOf, lineStarts, pageAt, pageOf } from "./lib/pages.js";
import { jsonPointer, jsPath, nodeAt, type PathSegment } from "./lib/path.js";
import { printJson, printedSize } from "./lib/print.js";
import { findInText, findInTree, MAX_MATCHES, type NodeMatch } from "./lib/search.js";
import { createTree } from "./tree.js";
import "./styles.css";

const editor = byId<HTMLTextAreaElement>("editor");
const formatBtn = byId<HTMLButtonElement>("format");
const minifyBtn = byId<HTMLButtonElement>("minify");
const sortKeys = byId<HTMLButtonElement>("sort-keys");
const copyBtn = byId<HTMLButtonElement>("copy");
const downloadBtn = byId<HTMLButtonElement>("download");
const clearBtn = byId<HTMLButtonElement>("clear");
const findOpenBtn = byId<HTMLButtonElement>("find-open");
const status = byId("status");
const cursor = byId("cursor");
const warning = byId("warning");
const problem = byId("problem");
const excerpt = byId("excerpt");
const fixBtn = byId<HTMLButtonElement>("fix");
const fixNote = byId("fix-note");
const codeEl = byId("code");
const treeEl = byId("tree");
const exportEl = byId("export");
const exportText = byId<HTMLTextAreaElement>("export-text");
const exportMessage = byId("export-message");
const coloursBtn = byId<HTMLButtonElement>("colours");
const expandAllBtn = byId<HTMLButtonElement>("expand-all");
const collapseAllBtn = byId<HTMLButtonElement>("collapse-all");
const pathBtn = byId<HTMLButtonElement>("path");
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
const options = byId("options");
const optionsBtn = byId<HTMLButtonElement>("options-btn");
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const indentButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-indent]")];
const pathStyleButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-path-style]")];
const unwrapBtn = options.querySelector<HTMLButtonElement>('[data-action="unwrap"]')!;
const wrapBtn = options.querySelector<HTMLButtonElement>('[data-action="wrap"]')!;
const view = createCodeView(codeEl, editor, byId("highlight"), byId("gutter"));
const exportView = createCodeView(
  exportEl,
  exportText,
  byId("export-highlight"),
  byId("export-gutter")
);
const tree = createTree(treeEl, {
  select: (path, _node, indices) => {
    treeSelection = indices;
    showPath(path);
  },
  open: (node) => showInText(node),
});

// ---------- State ----------

/** Text and Tree edit the document; the others show it converted, read-only. */
type ViewMode = "text" | "tree" | ExportKind;
type ExportKind = "yaml" | "csv" | "ts" | "schema";
type PathStyle = "js" | "pointer";
type Indent = "2" | "4" | "tab";

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
/** Where "the value you are on" is: the text's caret or the tree's selection, whichever was last. */
let place: "text" | "tree" = "text";
let indentChoice: Indent = "2";
let pathStyle: PathStyle = "js";
/** Syntax colours in every view: a setting, on until someone turns it off. */
let colours = true;
/** The tree shows an older document until it is next opened. */
let treeStale = true;
/** Why the text is not JSON, and the edits that would make it JSON when there are some. */
let fault: { message: string; position: JsonPosition; edits: Edit[] | null } | null = null;

// ---------- Storage ----------

/**
 * Settings persist (localStorage, shared by every tab). The draft is the person's data, so
 * it lives only as long as the tab (sessionStorage): a reload keeps it, closing the tab ends it.
 */
const PREFS_KEY = "workbench.json.prefs";
const DRAFT_KEY = "workbench.json.draft";
/** Past this, a draft is not worth the storage quota it would eat. */
const MAX_SAVED = 2_000_000;

interface Prefs {
  indent: Indent;
  sortKeys: boolean;
  view: ViewMode;
  pathStyle: PathStyle;
  colours: boolean;
}

const VIEWS: readonly ViewMode[] = ["text", "tree", "yaml", "csv", "ts", "schema"];

function restore(): void {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (prefs) {
      if (prefs.indent === "2" || prefs.indent === "4" || prefs.indent === "tab") {
        indentChoice = prefs.indent;
      }
      setPressed(sortKeys, prefs.sortKeys === true);
      if (prefs.view && VIEWS.includes(prefs.view)) mode = prefs.view;
      if (prefs.pathStyle === "pointer") pathStyle = "pointer";
      if (prefs.colours === false) colours = false;
    }
  } catch {
    /* storage refused or holds something else: defaults */
  }
  try {
    const draft = sessionStorage.getItem(DRAFT_KEY);
    if (draft !== null) showDocument(draft);
  } catch {
    /* storage refused: start empty */
  }
  showOptions();
}

function save(): void {
  const prefs: Prefs = {
    indent: indentChoice,
    sortKeys: isPressed(sortKeys),
    view: mode,
    pathStyle,
    colours,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage refused or full */
  }
  try {
    const text = documentText();
    sessionStorage.setItem(DRAFT_KEY, text.length > MAX_SAVED ? "" : text);
  } catch {
    /* storage refused or full */
  }
}

/** Toggle buttons keep their state in aria-pressed, which is also what they are styled by. */
const isPressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";
const setPressed = (button: HTMLElement, on: boolean) =>
  button.setAttribute("aria-pressed", String(on));

function indent(): number | "\t" {
  return indentChoice === "tab" ? "\t" : Number(indentChoice);
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

// ---------- Pages ----------

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

// ---------- The value you are on: nested JSON and the CSV table ----------

/** The value under the caret, while the document is valid and parsed from the text as it is. */
function atCursor(): ReturnType<typeof nodeAt> | null {
  return doc && !stale ? nodeAt(doc.root, aside.before.length + editor.selectionStart) : null;
}

/** The values from the root down to the one under the caret, or selected in the tree. */
function contextChain(): JsonNode[] {
  if (!doc || stale) return [];
  const indices = place === "tree" ? treeSelection : (atCursor()?.indices ?? []);
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

// ---------- Export views ----------

interface ExportSpec {
  label: string;
  lexer: Lexer;
  extension: string;
  make: (root: JsonNode) => Converted;
}

/** The first array in the document, nearest the root first: a document's main table. */
function firstArray(root: JsonNode): JsonNode | undefined {
  const queue = [root];
  for (let k = 0; k < queue.length; k++) {
    const node = queue[k];
    if (node.kind === "array") return node;
    if (node.kind === "object") for (const m of node.members) queue.push(m.value);
  }
  return undefined;
}

const EXPORTS: Record<ExportKind, ExportSpec> = {
  yaml: {
    label: "YAML",
    lexer: lexYaml,
    extension: ".yaml",
    make: (root) => ({ ok: true, text: toYaml(root) }),
  },
  // The innermost array around the caret (or tree selection), so any table in a document can
  // be exported; failing that, the document's first array.
  csv: {
    label: "CSV",
    lexer: lexCsv,
    extension: ".csv",
    make: (root) =>
      toCsv(contextChain().findLast((n) => n.kind === "array") ?? firstArray(root) ?? root),
  },
  ts: {
    label: "TypeScript types",
    lexer: lexTypeScript,
    extension: ".d.ts",
    make: (root) => ({ ok: true, text: toTypeScript(root) }),
  },
  schema: {
    label: "JSON Schema",
    lexer: highlightLine,
    extension: ".schema.json",
    make: (root) => ({ ok: true, text: toJsonSchema(root) }),
  },
};

const isExport = (m: ViewMode): m is ExportKind => m in EXPORTS;

/** What the export view shows, or null when it shows a message instead. */
let exported: string | null = null;

function showExport(): void {
  if (!isExport(mode)) {
    exportEl.classList.add("hidden");
    exportMessage.classList.add("hidden");
    return;
  }
  let result: Converted;
  if (!doc) {
    result = {
      ok: false,
      message: fault ? "Not valid JSON: switch to Text to fix it." : "Nothing to convert yet.",
    };
  } else {
    try {
      result = EXPORTS[mode].make(doc.root);
    } catch (err) {
      // Converters recurse; a document nested thousands deep can exhaust the stack.
      result = {
        ok: false,
        message: err instanceof RangeError ? "Too deeply nested to convert." : String(err),
      };
    }
  }
  exported = result.ok ? result.text : null;
  exportEl.classList.toggle("hidden", !result.ok);
  exportMessage.classList.toggle("hidden", result.ok);
  if (result.ok) {
    exportView.setLexer(colours ? EXPORTS[mode].lexer : lexPlain);
    // Only when it changed: an edit elsewhere must not throw the reader back to the top.
    if (exportText.value !== result.text) exportText.value = result.text;
    exportView.refresh();
  } else {
    exportMessage.textContent = result.message;
  }
  showFileControls();
}

/** Turns syntax colours on or off everywhere: the text, the converted views and the tree. */
function showColours(): void {
  view.setLexer(colours ? highlightLine : lexPlain);
  if (isExport(mode)) exportView.setLexer(colours ? EXPORTS[mode].lexer : lexPlain);
  document.body.classList.toggle("no-colour", !colours);
}

// ---------- Options: indent, sort keys, path style, nested JSON ----------

/**
 * Shows the settings as they are. Settings can always be changed: they apply to the text at
 * once when it is laid out that way (formatted, for the indent), and otherwise wait for Format.
 */
function showOptions(): void {
  for (const b of indentButtons) setPressed(b, b.dataset.indent === indentChoice);
  sortKeys.textContent = isPressed(sortKeys) ? "On" : "Off";
  setPressed(coloursBtn, colours);
  coloursBtn.textContent = colours ? "On" : "Off";
  for (const b of pathStyleButtons) setPressed(b, b.dataset.pathStyle === pathStyle);

  const chain = contextChain();
  const node = chain.at(-1);
  unwrapBtn.disabled = !node || unwrapString(documentText(), node, indent()) === null;
  unwrapBtn.title = unwrapBtn.disabled
    ? "Put the cursor on (or select in the tree) a string that holds a JSON object or array"
    : "";
  wrapBtn.disabled = !node;
  wrapBtn.textContent = chain.length > 1 ? "Wrap value in a string" : "Wrap document in a string";
}

function runNested(action: string): void {
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
  const matchCase = { matchCase: isPressed(findCase) };
  textMatches = mode === "text" ? findInText(documentText(), query, matchCase) : [];
  treeMatches = mode === "tree" && doc && !stale ? findInTree(doc.root, query, matchCase) : [];
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
  if (mode !== "text" && mode !== "tree") return;
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
  else if (mode === "tree") tree.focus();
}

// ---------- Validation: after every pause in typing, and every change made from code ----------

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
  minified = !!doc && !text.includes("\n");

  formatBtn.disabled = minifyBtn.disabled = !doc;
  clearBtn.disabled = empty;
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
  if (findOpen()) refreshFind();
  treeStale = true;
  if (mode === "tree") showTree();
  showExport();
  showOptions();
  showViewControls();
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

// ---------- Rewrites and their undo ----------

/**
 * Whole-text rewrites (Format, Minify, Clear, Fix, Unwrap), undone by the app rather than the
 * browser. `execCommand("insertText")` would put them on the browser's own undo stack, but
 * Chromium inserts line by line and takes seconds on a few thousand lines. Assigning `value`
 * is instant and resets the browser's stack instead, so Ctrl+Z / Ctrl+Y step through these
 * here, whenever the text still reads exactly as a rewrite left it.
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
  replaceText(
    printJson(doc.root, { indent: minify ? 0 : indent(), sortKeys: isPressed(sortKeys) })
  );
}

/** Makes almost-JSON strict in place, keeping the layout: only the offending bits change. */
function fix(): void {
  if (fault?.edits) replaceText(applyEdits(documentText(), fault.edits));
}

// ---------- Where you are: caret, path ----------

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
  pathBtn.classList.toggle("hidden", !path || isExport(mode));
  pathBtn.textContent = text || "root";
  pathBtn.disabled = !text;
}

// ---------- Views ----------

function showTree(): void {
  if (!treeStale) return;
  const text = documentText();
  // A minified document is one line, where every value would be "line 1": number the rows by
  // column there instead, which still says where each value is.
  const oneLine = !text.includes("\n");
  const starts = oneLine ? [] : lineStarts(text);
  tree.show(
    doc?.root ?? null,
    fault ? "Not valid JSON: switch to Text to fix it." : "Nothing to show yet.",
    oneLine ? (offset) => offset + 1 : (offset) => lineOf(starts, offset),
    oneLine ? "Column" : "Line"
  );
  treeStale = false;
}

function setMode(next: ViewMode): void {
  mode = next;
  if (mode === "text" || mode === "tree") place = mode;
  codeEl.classList.toggle("hidden", mode !== "text");
  treeEl.classList.toggle("hidden", mode !== "tree");
  for (const b of viewButtons) setPressed(b, b.dataset.view === mode);
  cursor.classList.toggle("hidden", mode !== "text");
  showPager();
  if (findOpen()) {
    if (isExport(mode)) closeFind();
    else {
      findIndex = -1;
      refreshFind();
    }
  }
  showExport();
  if (mode === "tree") {
    showTree();
    const at = atCursor();
    if (at) tree.reveal(at.indices);
    else showPath(null);
    tree.focus();
  } else if (mode === "text") {
    view.refresh();
    editor.focus();
    showCursor();
  } else {
    exportText.scrollTop = exportText.scrollLeft = 0;
    exportView.refresh();
    showPath(shownPath);
  }
  showViewControls();
  save();
}

/** Controls that act on one view: disabled, not hidden, while another is shown. */
function showViewControls(): void {
  expandAllBtn.disabled = collapseAllBtn.disabled = mode !== "tree" || !doc;
  findOpenBtn.disabled = isExport(mode);
  showFileControls();
}

/** Copy and Download take what is on screen: the document, or the conversion shown. */
function showFileControls(): void {
  const empty = !documentText().trim();
  copyBtn.disabled = downloadBtn.disabled = isExport(mode) ? exported === null : empty;
  const what = isExport(mode) ? EXPORTS[mode].label : "the document";
  copyBtn.title = `Copy ${what}`;
  downloadBtn.title = `Download ${what}`;
}

/** Switches to the text with a value selected and scrolled to the middle. */
function showInText(node: JsonNode): void {
  setMode("text");
  selectInDocument(node.start, node.end);
}

function goToError(): void {
  if (!fault) return;
  if (mode !== "text") setMode("text");
  const { offset } = fault.position;
  selectInDocument(offset, offset + 1);
}

async function load(file: File): Promise<void> {
  fileName = file.name;
  showDocument(await file.text());
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  validate();
  // A file opens as it is, in the text: what was opened is what you see first.
  setMode("text");
}

/** What Copy and Download hand over, and under which name. */
function outgoing(): { text: string; name: string; mime: string } {
  if (isExport(mode) && exported !== null) {
    const name = fileName.replace(/\.json$/i, "") + EXPORTS[mode].extension;
    return { text: exported, name, mime: "text/plain" };
  }
  return { text: documentText(), name: fileName, mime: "application/json" };
}

// ---------- Events ----------

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
byId("goto").addEventListener("click", goToError);
fixBtn.addEventListener("click", fix);
for (const b of viewButtons) {
  b.addEventListener("click", () => setMode(b.dataset.view as ViewMode));
}
expandAllBtn.addEventListener("click", () => tree.expandAll());
collapseAllBtn.addEventListener("click", () => tree.collapseAll());

// Options. Picking one means "show it like this", so it applies at once (and Ctrl+Z takes it
// back); with nothing valid to rewrite, it is just remembered.
// The rewrite changes nothing when the text is already laid out that way, so the options and
// the formatted size refresh either way.
for (const b of indentButtons) {
  b.addEventListener("click", () => {
    indentChoice = b.dataset.indent as Indent;
    if (doc && !minified) rewrite(false);
    validate();
  });
}
sortKeys.addEventListener("click", () => {
  setPressed(sortKeys, !isPressed(sortKeys));
  if (doc) rewrite(minified);
  showOptions();
  save();
});
coloursBtn.addEventListener("click", () => {
  colours = !colours;
  showColours();
  showOptions();
  save();
});
for (const b of pathStyleButtons) {
  b.addEventListener("click", () => {
    pathStyle = b.dataset.pathStyle as PathStyle;
    showOptions();
    showPath(shownPath);
    save();
  });
}
unwrapBtn.addEventListener("click", () => {
  options.hidePopover();
  runNested("unwrap");
});
wrapBtn.addEventListener("click", () => {
  options.hidePopover();
  runNested("wrap");
});
options.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState !== "open") return;
  clearTimeout(pending);
  if (stale) validate();
  showOptions();
  // Popovers open in the top layer; place this one under its button, inside the window.
  const r = optionsBtn.getBoundingClientRect();
  options.style.top = `${r.bottom + 4}px`;
  options.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 288))}px`;
});

const help = byId("help");
help.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState !== "open") return;
  // Opens under its button, against the right edge of the window.
  const r = byId("help-btn").getBoundingClientRect();
  help.style.top = `${r.bottom + 4}px`;
  help.style.right = `${Math.max(8, innerWidth - r.right)}px`;
});

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
findOpenBtn.addEventListener("click", openFind);
// Ctrl+F opens this find rather than the browser's, which cannot see other pages of a long
// document; F3 steps through matches like most editors.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !isExport(mode)) {
    e.preventDefault();
    openFind();
  } else if (e.key === "F3" && !isExport(mode)) {
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

byId("open").addEventListener("click", async () => {
  const [file] = await pickFiles(".json,application/json,text/plain");
  if (file) await load(file);
});
copyBtn.addEventListener("click", async () => {
  const out = outgoing();
  if (!(await copyText(out.text, copyBtn))) downloadText(out.name, out.text, out.mime);
});
downloadBtn.addEventListener("click", () => {
  const out = outgoing();
  downloadText(out.name, out.text, out.mime);
});
clearBtn.addEventListener("click", () => {
  fileName = "data.json";
  replaceText("");
});

onFileDrop(editor, ([file]) => {
  if (file) void load(file);
});

bindThemeToggle(byId("theme-toggle"));
restore();
showColours();
validate();
setMode(mode);

registerServiceWorker();
