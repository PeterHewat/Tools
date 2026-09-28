import { parseJson, positionAt, type JsonPosition } from "@tools/codec";
import {
  bindDock,
  bindMenu,
  bindThemeToggle,
  byId,
  copyText,
  downloadText,
  onFileDrop,
  pickFiles,
  registerServiceWorker,
} from "@tools/ui";
import { createEditor, type LineLexer } from "@tools/editor";
import {
  applyEdits,
  parse,
  type Edit,
  type JsonNode,
  type ParseResult,
  type RepairKind,
} from "./lib/ast.js";
import { BLOCK_COMMENT, highlightLine } from "./lib/highlight.js";
import { lexCsvSheet, lexTypeScript, lexYaml } from "./lib/lexers.js";
import {
  exactCandidates,
  toCsv,
  toJsonSchema,
  toTypeScript,
  toYaml,
  type Converted,
} from "./lib/convert.js";
import { excerptAt, formatBytes } from "./lib/inspect.js";
import { unwrapString, wrapAsString } from "./lib/nested.js";
import { lineCount, lineOf, lineStarts } from "./lib/lines.js";
import { jsonPointer, jsPath, nodeAt, type PathSegment } from "./lib/path.js";
import { printJson, printedSize } from "./lib/print.js";
import { SAMPLE } from "./lib/sample.js";
import { csvToJson, looksLikeCsv } from "./lib/csv-read.js";
import { csvSheet, tablesIn, type CsvSheet } from "./lib/tables.js";
import { findInText, MAX_MATCHES } from "./lib/search.js";

const formatBtn = byId<HTMLButtonElement>("format");
const minifyBtn = byId<HTMLButtonElement>("minify");
const sortKeys = byId<HTMLButtonElement>("sort-keys");
const copyBtn = byId<HTMLButtonElement>("copy");
const downloadBtn = byId<HTMLButtonElement>("download");
const clearBtn = byId<HTMLButtonElement>("clear");
const findOpenBtn = byId<HTMLButtonElement>("find-open");
const status = byId("status");
const statusToggle = byId<HTMLButtonElement>("status-toggle");
const cursor = byId("cursor");
const warning = byId("warning");
const problem = byId("problem");
const excerpt = byId("excerpt");
const fixBtn = byId<HTMLButtonElement>("fix");
const fixNote = byId("fix-note");
const fromCsvBtn = byId<HTMLButtonElement>("from-csv");
const codeEl = byId("code");
const exportEl = byId("export");
const exportMessage = byId("export-message");
const csvBar = byId("csvbar");
const csvNote = byId("csv-note");
const exactBar = byId("exactbar");
const exactList = byId("exact-list");
const coloursBtn = byId<HTMLButtonElement>("colours");
const pathBtn = byId<HTMLButtonElement>("path");
const whereEl = pathBtn.parentElement!;
const foldAllBtn = byId<HTMLButtonElement>("fold-all");
const unfoldAllBtn = byId<HTMLButtonElement>("unfold-all");
const findBar = byId("findbar");
const findInput = byId<HTMLInputElement>("find-input");
const findCount = byId("find-count");
const findCase = byId<HTMLButtonElement>("find-case");
const findPrev = byId<HTMLButtonElement>("find-prev");
const findNext = byId<HTMLButtonElement>("find-next");
const options = byId("options");
const optionsBtn = byId<HTMLButtonElement>("options-btn");
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const viewSelect = byId<HTMLSelectElement>("view-select");
const indentButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-indent]")];
const pathStyleButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-path-style]")];
const unwrapBtn = options.querySelector<HTMLButtonElement>('[data-action="unwrap"]')!;
const wrapBtn = options.querySelector<HTMLButtonElement>('[data-action="wrap"]')!;
const editor = createEditor(codeEl, {
  language: "json",
  colours: jsonColours(),
  label: "JSON",
  placeholder: "Paste JSON here, or drop a .json file",
  keys: [
    {
      key: "Mod-Enter",
      run: () => {
        clearTimeout(pending);
        validate();
        rewrite(false);
        return true;
      },
    },
  ],
  onChange: (user) => {
    textCache = null;
    findVersion++;
    if (restored) droppedDraft = false;
    if (!user) return;
    stale = true;
    validateSoon();
  },
  onSelection: showCursor,
  onFolds: showFoldControls,
});
/** YAML, CSV, Types, Schema: the document converted, read-only. */
const exportView = createEditor(exportEl, {
  readOnly: true,
  label: "Converted document",
  // Where the cursor is in the CSV view decides which table Copy and Export take.
  onSelection: () => {
    if (mode !== "csv") return;
    showCsvNote();
    showFileControls();
  },
});
/** The JSON's colours: its lexer, with block comments that can run over lines. */
function jsonColours() {
  return { lexer: highlightLine, blockComment: BLOCK_COMMENT };
}

// ---------- State ----------

/** JSON edits the document; the others show it converted, read-only. */
type ViewMode = "json" | ExportKind;
type ExportKind = "yaml" | "csv" | "ts" | "schema";
type PathStyle = "js" | "pointer";
type Indent = "2" | "4" | "tab";

let fileName = "data.json";
type Doc = Extract<ParseResult, { ok: true }>;
/** The parsed document while the text is strict JSON; null otherwise. */
let doc: Doc | null = null;
/** Typed since the last parse: `doc`'s positions may be off until it is parsed again. */
let stale = false;
/** The editor's text, read once per change: a long document is costly to join into a string. */
let textCache: string | null = null;
/** Valid and on one line: sorting keeps it minified, and there is no indent to choose. */
let minified = false;
let mode: ViewMode = "json";
let indentChoice: Indent = "2";
let pathStyle: PathStyle = "js";
/** Syntax colours in every view: a setting, on until someone turns it off. */
let colours = true;
/** Why the text is not JSON, and the edits that would make it JSON when there are some. */
let fault: { message: string; position: JsonPosition; edits: Edit[] | null } | null = null;

// ---------- Storage ----------

/**
 * Settings persist (localStorage, shared by every tab). The draft is the person's data, so
 * it lives only as long as the tab (sessionStorage): a reload keeps it, closing the tab ends it.
 */
const PREFS_KEY = "tools.json.prefs";
const DRAFT_KEY = "tools.json.draft";
/** The Exact values turned on, kept beside the draft they were chosen for. */
const EXACT_KEY = "tools.json.exact";
/** Past this, a draft is not worth the storage quota it would eat. */
const MAX_SAVED = 2_000_000;
/** Set when the draft was too large to keep, so a reload can say why the editor is empty. */
const DROPPED_KEY = "tools.json.dropped";
/** The tab reloaded after dropping a draft too large to keep: said until the next change. */
let droppedDraft = false;
/** The draft is back in the editor: changes from here on are new ones. */
let restored = false;

interface Prefs {
  indent: Indent;
  sortKeys: boolean;
  view: ViewMode;
  pathStyle: PathStyle;
  colours: boolean;
}

const VIEWS: readonly ViewMode[] = ["json", "yaml", "csv", "ts", "schema"];

function restore(): void {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (prefs) {
      if (prefs.indent === "2" || prefs.indent === "4" || prefs.indent === "tab") {
        indentChoice = prefs.indent;
      }
      setOn(sortKeys, prefs.sortKeys === true);
      if (prefs.view && VIEWS.includes(prefs.view)) mode = prefs.view;
      if (prefs.pathStyle === "pointer") pathStyle = "pointer";
      if (prefs.colours === false) colours = false;
    }
  } catch {
    /* storage refused or holds something else: defaults */
  }
  try {
    // A tab with no draft yet opens on the sample. Cleared, the draft is "" and stays empty.
    showDocument(sessionStorage.getItem(DRAFT_KEY) ?? SAMPLE);
    droppedDraft = sessionStorage.getItem(DROPPED_KEY) === "1";
  } catch {
    /* storage refused: the sample, as for a new tab */
    showDocument(SAMPLE);
  }
  // On its own: exact values that cannot be read are dropped, never the draft with them.
  try {
    const exact = JSON.parse(sessionStorage.getItem(EXACT_KEY) ?? "[]") as unknown;
    if (Array.isArray(exact)) {
      for (const place of exact) if (typeof place === "string") exactPlaces.add(place);
    }
  } catch {
    /* storage refused or unreadable: none turned on */
  }
  showOptions();
}

function save(): void {
  const prefs: Prefs = {
    indent: indentChoice,
    sortKeys: isOn(sortKeys),
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
    const tooLarge = text.length > MAX_SAVED;
    sessionStorage.setItem(DRAFT_KEY, tooLarge ? "" : text);
    // Kept while the empty draft still stands for the large one, so every reload says so.
    if (tooLarge || !droppedDraft) sessionStorage.setItem(DROPPED_KEY, tooLarge ? "1" : "");
    sessionStorage.setItem(EXACT_KEY, JSON.stringify([...exactPlaces]));
  } catch {
    /* storage refused or full */
  }
}

/** Toggle buttons keep their state in aria-pressed, which is also what they are styled by. */
const isPressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";
const setPressed = (button: HTMLElement, on: boolean) =>
  button.setAttribute("aria-pressed", String(on));
/** Switches (settings that are on or off) keep theirs in aria-checked, as role="switch" has it. */
const isOn = (button: HTMLElement) => button.getAttribute("aria-checked") === "true";
const setOn = (button: HTMLElement, on: boolean) => button.setAttribute("aria-checked", String(on));

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

// ---------- The document ----------

/** The whole document. */
function documentText(): string {
  return (textCache ??= editor.text);
}

/** Puts a new document in the editor: a file, or the draft on reload. Not a step of undo. */
function showDocument(text: string): void {
  editor.setText(text, "new");
  showMarks();
}

/** Selects a stretch of the document, unfolding what hides it, and scrolls it to the middle. */
function selectInDocument(start: number, end: number, focus = true): void {
  editor.select(start, end, { focus });
  showCursor();
}

// ---------- The value you are on: nested JSON and the CSV table ----------

/** The value under the caret, while the document is valid and parsed from the text as it is. */
function atCursor(): ReturnType<typeof nodeAt> | null {
  return doc && !stale ? nodeAt(doc.root, editor.selection.from) : null;
}

/** The values from the root down to the one under the caret. */
function contextChain(): JsonNode[] {
  if (!doc || stale) return [];
  const indices = atCursor()?.indices ?? [];
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
  lexer: LineLexer;
  extension: string;
  make: (root: JsonNode) => Converted;
}

// ---------- CSV: every array as a table ----------

/** The CSV view's tables as last shown, for the gutter, Copy and Export. */
let sheet: CsvSheet | null = null;
/** The JSON line each line of the CSV view comes from (see `showExport`). */
let sheetLabels: (number | null)[] | null = null;

const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`;

function makeCsv(root: JsonNode): Converted {
  const tables = tablesIn(root);
  sheet = tables.length
    ? csvSheet(tables, (t) => `${formatPath(t.path)} · ${rows(t.node.items.length)}`)
    : null;
  sheetLabels = null;
  if (!sheet) return { ok: false, message: "No arrays here: CSV makes a table of a list." };
  // One line of JSON would number every row 1: then the rows keep their own numbers.
  const text = documentText();
  if (text.includes("\n")) {
    const starts = lineStarts(text);
    sheetLabels = sheet.sources.map((s) => (s < 0 ? null : lineOf(starts, s)));
  }
  return { ok: true, text: sheet.text };
}

/** With several tables, the one the CSV view's cursor is in: Copy and Export take it. */
function csvSection(): CsvSheet["sections"][number] | undefined {
  if (mode !== "csv" || !sheet || sheet.sections.length < 2) return undefined;
  const line = exportView.position(exportView.selection.from).line - 1;
  return sheet.sections.find((s) => line <= s.lastLine) ?? sheet.sections.at(-1);
}

/** Says what the tables are, and which one Copy and Export take. */
function showCsvNote(): void {
  const shown = mode === "csv" && !!sheet && exported !== null;
  csvBar.classList.toggle("hidden", !shown);
  if (!shown) return;
  const numbered = sheetLabels ? ", numbered by their line in the JSON" : "";
  const [only] = sheet!.sections;
  const section = csvSection();
  if (!section) {
    csvNote.textContent = `${formatPath(only.table.path)} · ${rows(only.table.node.items.length)}${numbered}`;
    return;
  }
  const name = document.createElement("b");
  name.textContent = formatPath(section.table.path);
  csvNote.replaceChildren(
    `${sheet!.sections.length} tables${numbered}. Copy and Export take the one at the cursor: `,
    name
  );
}

// ---------- Types and Schema: exact values ----------

/** Places (as `apps[].id`) whose strings Types and Schema list rather than call "string". */
const exactPlaces = new Set<string>();
/** The places the bar shows, so it is only rebuilt when they change and focus stays put. */
let exactShown = "";

/** One toggle per place with a few strings, for Types and Schema. */
function showExactBar(): void {
  const candidates = (mode === "ts" || mode === "schema") && doc ? exactCandidates(doc.root) : [];
  exactBar.classList.toggle("hidden", !candidates.length);
  const key = JSON.stringify(candidates);
  if (key !== exactShown) {
    exactShown = key;
    exactList.replaceChildren(
      ...candidates.map(({ place, values }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ui-btn toggle";
        b.dataset.place = place;
        b.textContent = place || "(root)";
        b.title = values.map((v) => JSON.stringify(v)).join(" | ");
        b.addEventListener("click", () => {
          if (!exactPlaces.delete(place)) exactPlaces.add(place);
          showExport();
          save();
        });
        return b;
      })
    );
  }
  for (const b of exactList.querySelectorAll<HTMLButtonElement>("[data-place]")) {
    setPressed(b, exactPlaces.has(b.dataset.place!));
  }
}

/** A path as the status bar writes it, in the chosen style; the root has a name of its own. */
function formatPath(path: readonly PathSegment[]): string {
  if (!path.length) return "(root)";
  return pathStyle === "pointer" ? jsonPointer(path) : jsPath(path);
}

const EXPORTS: Record<ExportKind, ExportSpec> = {
  yaml: {
    label: "YAML",
    lexer: lexYaml,
    extension: ".yaml",
    make: (root) => ({ ok: true, text: toYaml(root) }),
  },
  // Every array, one table after another (see lib/tables.ts).
  csv: {
    label: "CSV",
    lexer: lexCsvSheet,
    extension: ".csv",
    make: makeCsv,
  },
  ts: {
    label: "TypeScript types",
    lexer: lexTypeScript,
    extension: ".d.ts",
    make: (root) => ({ ok: true, text: toTypeScript(root, { exact: exactPlaces }) }),
  },
  schema: {
    label: "JSON Schema",
    lexer: highlightLine,
    extension: ".schema.json",
    make: (root) => ({ ok: true, text: toJsonSchema(root, { exact: exactPlaces }) }),
  },
};

const isExport = (m: ViewMode): m is ExportKind => m in EXPORTS;

/** What the export view shows, or null when it shows a message instead. */
let exported: string | null = null;
/** The text last put in the export view, kept so it is only replaced when it changes. */
let exportShown = "";

function showExport(): void {
  if (!isExport(mode)) {
    exportEl.classList.add("hidden");
    exportMessage.classList.add("hidden");
    showCsvNote();
    showExactBar();
    return;
  }
  let result: Converted;
  if (!doc) {
    result = {
      ok: false,
      message: fault
        ? "Not valid JSON: switch to the JSON view to fix it."
        : "Nothing to convert yet.",
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
  showCsvNote();
  showExactBar();
  if (result.ok) {
    exportView.setColours(colours ? EXPORTS[mode].lexer : null);
    exportView.setLineLabels(mode === "csv" ? sheetLabels : null);
    // Only when it changed, and only what changed, so the reader keeps their place.
    if (exportShown !== result.text) {
      exportShown = result.text;
      exportView.setText(result.text, "sync");
      findVersion++;
      if (findOpen()) refreshFind();
    }
  } else {
    exportMessage.textContent = result.message;
  }
  showFileControls();
}

/** Turns syntax colours on or off everywhere: the text and the converted views. */
function showColours(): void {
  editor.setColours(colours ? jsonColours() : null);
  if (isExport(mode)) exportView.setColours(colours ? EXPORTS[mode].lexer : null);
}

// ---------- Options: indent, sort keys, path style, nested JSON ----------

/**
 * Shows the settings as they are. Settings can always be changed: they apply to the text at
 * once when it is laid out that way (formatted, for the indent), and otherwise wait for Format.
 */
function showOptions(): void {
  for (const b of indentButtons) setPressed(b, b.dataset.indent === indentChoice);
  setOn(coloursBtn, colours);
  for (const b of pathStyleButtons) setPressed(b, b.dataset.pathStyle === pathStyle);

  const chain = contextChain();
  const node = chain.at(-1);
  unwrapBtn.disabled = !node || unwrapString(documentText(), node, indent()) === null;
  unwrapBtn.title = unwrapBtn.disabled
    ? "Put the cursor on a string that holds a JSON object or array"
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
let findIndex = -1;

const findOpen = () => !findBar.classList.contains("hidden");

/** Searches again when the query, the options, the view or the text changed. */
function refreshFind(): void {
  const query = findInput.value;
  const key = [query, isPressed(findCase), mode, findVersion].join("\u0000");
  if (key === findKey) return;
  findKey = key;
  const matchCase = { matchCase: isPressed(findCase) };
  textMatches = findInText(searchedText(), query, matchCase);
  findIndex = Math.min(findIndex, textMatches.length - 1);
  showFindCount();
  showMarks();
}

/** What find searches: the document, or the conversion on screen. */
const searchedText = () => (isExport(mode) ? (exported ?? "") : documentText());

function showFindCount(): void {
  const n = textMatches.length;
  const capped = n >= MAX_MATCHES ? "+" : "";
  findCount.textContent = !findInput.value
    ? ""
    : !n
      ? "No matches"
      : findIndex < 0
        ? `${n.toLocaleString()}${capped} matches`
        : `${(findIndex + 1).toLocaleString()} of ${n.toLocaleString()}${capped}`;
  findBar.classList.toggle("no-match", !!findInput.value && !n);
  // Nothing to step to: the arrows say so rather than doing nothing.
  findPrev.disabled = findNext.disabled = !n;
}

/** Marks the matches in the view shown; the current one stands out. */
function showMarks(): void {
  const size = findInput.value.length;
  const marks = findOpen()
    ? textMatches.map((m, k) => ({ start: m, end: m + size, current: k === findIndex }))
    : [];
  editor.setMarks(mode === "json" ? marks : []);
  exportView.setMarks(isExport(mode) ? marks : []);
}

/** Moves to the next (1) or previous (-1) match; 0 picks the first at or after the caret. */
function findStep(delta: number): void {
  refreshFind();
  const n = textMatches.length;
  if (!n) {
    findIndex = -1;
    showFindCount();
    return;
  }
  if (findIndex < 0 || delta === 0) {
    const caret = isExport(mode) ? exportView.selection.from : editor.selection.from;
    const after = textMatches.findIndex((m) => m >= caret);
    findIndex = after < 0 ? 0 : after;
    if (delta < 0) findIndex = (findIndex - 1 + n) % n;
  } else {
    findIndex = (findIndex + delta + n) % n;
  }
  const start = textMatches[findIndex];
  if (mode === "json") selectInDocument(start, start + findInput.value.length, false);
  else selectInExport(start, start + findInput.value.length);
  showFindCount();
  showMarks();
}

/** The search button: opens find, or closes it when it is already open. */
function toggleFind(): void {
  if (findOpen()) closeFind();
  else openFind();
}

/** Selects a stretch of the converted text and scrolls it to the middle, as in the text. */
function selectInExport(start: number, end: number): void {
  exportView.select(start, end);
}

function openFind(): void {
  findBar.classList.remove("hidden");
  findOpenBtn.setAttribute("aria-expanded", "true");
  const { from, to } = isExport(mode) ? exportView.selection : editor.selection;
  const selected = to - from < 200 ? searchedText().slice(from, to) : "";
  if (selected && !selected.includes("\n")) findInput.value = selected;
  findInput.focus();
  findInput.select();
  findKey = "";
  refreshFind();
}

function closeFind(): void {
  findBar.classList.add("hidden");
  findOpenBtn.setAttribute("aria-expanded", "false");
  editor.setMarks([]);
  exportView.setMarks([]);
  if (mode === "json") editor.focus();
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
  showLayout(text);
  clearBtn.disabled = empty;
  status.classList.toggle("ui-status--error", !!fault);
  status.classList.toggle("ui-status--ok", !!doc);
  statusToggle.classList.toggle("error", !!fault);
  statusToggle.classList.toggle("ok", !!doc);
  problem.classList.toggle("hidden", !fault);
  warning.classList.add("hidden");

  if (empty) {
    status.textContent = "Paste JSON, open a file or drop one on the editor.";
    if (droppedDraft) {
      warning.textContent =
        "The last document was over 2 MB, too large to keep across a reload: open it again.";
      warning.classList.remove("hidden");
    }
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
      warning.textContent =
        "This is a few very long lines, which is slow to edit. Format it to edit it quickly.";
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
    // Not JSON at all but a CSV table: offered as a conversion rather than a fix.
    const csv = !fault.edits && looksLikeCsv(text);
    fixBtn.classList.toggle("hidden", !fault.edits);
    fromCsvBtn.classList.toggle("hidden", !csv);
    fixNote.classList.toggle("hidden", !fault.edits && !csv);
    fixNote.textContent = fault.edits
      ? `Almost JSON: ${describeEdits(fault.edits)}.`
      : csv
        ? "This looks like CSV: each row can become an object."
        : "";
  }
  editor.setError(fault && { from: fault.position.offset, message: fault.message });
  findVersion++;
  if (findOpen()) refreshFind();
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

// ---------- Rewrites ----------

/**
 * Whole-text rewrites (Format, Minify, Clear, Fix, Unwrap): each is one step of the editor's
 * undo, and changes only what differs, so the caret and folds stay where the text did not.
 */
function replaceText(text: string): void {
  if (text === documentText()) return;
  editor.setText(text);
  if (mode === "json") editor.focus();
  validate();
}

/**
 * Format and Minify read as pressed while the text is exactly what they would make of it, so
 * they say how the text is laid out until an edit changes that. One printing, of the layout
 * the text has the shape of: several lines can only be formatted, one only minified.
 */
function showLayout(text: string): void {
  formatBtn.disabled = minifyBtn.disabled = !doc;
  const oneLine = !text.includes("\n");
  const laidOut =
    !!doc &&
    text === printJson(doc.root, { indent: oneLine ? 0 : indent(), sortKeys: isOn(sortKeys) });
  setPressed(formatBtn, laidOut && !oneLine);
  setPressed(minifyBtn, laidOut && oneLine);
}

function rewrite(minify: boolean): void {
  if (!doc) return;
  replaceText(printJson(doc.root, { indent: minify ? 0 : indent(), sortKeys: isOn(sortKeys) }));
}

/** Makes almost-JSON strict in place, keeping the layout: only the offending bits change. */
function fix(): void {
  if (fault?.edits) replaceText(applyEdits(documentText(), fault.edits));
}

/** The text, read as CSV, replaced by the JSON array of its rows (Ctrl+Z takes it back). */
function fromCsv(): void {
  const json = csvToJson(documentText(), indent());
  if (!json) return;
  replaceText(json.text);
  fileName = fileName.replace(/\.(csv|tsv|txt)$/i, "") + (/\.json$/i.test(fileName) ? "" : ".json");
}

/** A file of CSV (by its name or type) opens as JSON: a table is what it was opened to be. */
const isCsvFile = (file: File) => /\.(csv|tsv)$/i.test(file.name) || file.type === "text/csv";

// ---------- Where you are: caret, path ----------

function showCursor(): void {
  if (mode !== "json") return;
  const { line, column } = editor.position(editor.selection.head);
  cursor.textContent = `Ln ${line.toLocaleString()}, Col ${column}`;
  // While typing, the parse is behind the text: the last path stays until it catches up,
  // rather than vanishing and coming back and moving everything beside it.
  if (!stale) showPath(atCursor()?.path ?? null);
  else fitPath();
}

let shownPath: PathSegment[] | null = null;

/** The path of the value under the caret; click it to copy. */
function showPath(path: PathSegment[] | null): void {
  shownPath = path;
  const text = path && (pathStyle === "js" ? jsPath(path) : jsonPointer(path));
  pathBtn.classList.toggle("hidden", !path || isExport(mode));
  // In a span: see .path in styles.css for why.
  const label = document.createElement("span");
  label.textContent = text || "root";
  pathBtn.replaceChildren(label);
  pathBtn.disabled = !text;
  fitPath();
}

/**
 * The path sits against the end of its block and grows leftwards; when it would run into the
 * line and column, it covers them: the path is the longer and rarer thing to read.
 */
function fitPath(): void {
  const room = whereEl.clientWidth - cursor.offsetWidth - 12;
  whereEl.classList.toggle(
    "covered",
    !pathBtn.classList.contains("hidden") && pathBtn.scrollWidth > room
  );
}

// ---------- Views ----------

function setMode(next: ViewMode): void {
  mode = next;
  codeEl.classList.toggle("hidden", mode !== "json");
  for (const b of viewButtons) setPressed(b, b.dataset.view === mode);
  viewSelect.value = mode;
  // The text's own buttons float over it, shown only in its view.
  document.body.dataset.view = mode;
  // Hidden but still holding its place, so the path does not move when the view changes.
  cursor.classList.toggle("invisible", mode !== "json");
  showExport();
  if (findOpen()) {
    findIndex = -1;
    refreshFind();
  }
  if (mode === "json") {
    editor.focus();
    showCursor();
  } else {
    exportView.select(0, 0, { scroll: "top" });
    showPath(shownPath);
  }
  showViewControls();
  save();
}

/** Controls that act on one view: disabled, not hidden, while another is shown. */
function showViewControls(): void {
  showFoldControls();
  showFileControls();
}

/** Fold all while something is still open, Unfold all while something is folded. */
function showFoldControls(): void {
  foldAllBtn.disabled = !editor.canFold;
  unfoldAllBtn.disabled = !editor.hasFolds;
}

/**
 * Export and Copy take what is on screen: the document, or the conversion shown. Named as
 * the SVG app names its own: Export SVG, Copy SVG to clipboard.
 */
function showFileControls(): void {
  const empty = !documentText().trim();
  copyBtn.disabled = downloadBtn.disabled = isExport(mode) ? exported === null : empty;
  const section = csvSection();
  const what = section
    ? `CSV of ${formatPath(section.table.path)}`
    : isExport(mode)
      ? EXPORTS[mode].label
      : "JSON";
  copyBtn.title = `Copy ${what} to clipboard`;
  downloadBtn.title = `Export ${what}`;
  copyBtn.setAttribute("aria-label", copyBtn.title);
  downloadBtn.setAttribute("aria-label", downloadBtn.title);
}

function goToError(): void {
  if (!fault) return;
  if (mode !== "json") setMode("json");
  const { offset } = fault.position;
  selectInDocument(offset, offset + 1);
}

async function load(file: File): Promise<void> {
  fileName = file.name;
  exactPlaces.clear();
  const text = await file.text();
  const json = isCsvFile(file) ? csvToJson(text, indent()) : null;
  if (json) fileName = file.name.replace(/\.(csv|tsv)$/i, ".json");
  showDocument(json ? json.text : text);
  validate();
  // A file opens as it is, in the text: what was opened is what you see first.
  setMode("json");
}

/** What Copy and Download hand over, and under which name. */
function outgoing(): { text: string; name: string; mime: string } {
  const base = fileName.replace(/\.json$/i, "");
  const section = csvSection();
  if (section) {
    // One of several tables: its CSV alone, named after it ("data-apps.csv").
    const csv = toCsv(section.table.node);
    const path = section.table.path.join("-").replace(/[^\w.-]+/g, "_");
    if (csv.ok) return { text: csv.text, name: `${base}-${path || "root"}.csv`, mime: "text/csv" };
  }
  if (isExport(mode) && exported !== null) {
    return { text: exported, name: base + EXPORTS[mode].extension, mime: "text/plain" };
  }
  return { text: documentText(), name: fileName, mime: "application/json" };
}

// ---------- Events ----------

formatBtn.addEventListener("click", () => rewrite(false));
minifyBtn.addEventListener("click", () => rewrite(true));
byId("goto").addEventListener("click", goToError);
fixBtn.addEventListener("click", fix);
fromCsvBtn.addEventListener("click", fromCsv);
for (const b of viewButtons) {
  b.addEventListener("click", () => setMode(b.dataset.view as ViewMode));
}
viewSelect.addEventListener("change", () => setMode(viewSelect.value as ViewMode));
unfoldAllBtn.addEventListener("click", () => {
  editor.unfoldAll();
  editor.focus();
});
foldAllBtn.addEventListener("click", () => {
  editor.foldAll();
  editor.focus();
});

// Options. Picking one means "show it like this", so it applies at once (and Ctrl+Z takes it
// back); with nothing valid to rewrite, it is just remembered.
// The rewrite changes nothing when the text is already laid out that way, so the options and
// the formatted size refresh either way.
for (const b of indentButtons) {
  b.addEventListener("click", () => {
    indentChoice = b.dataset.indent as Indent;
    editor.setIndent(indent());
    if (doc && !minified) rewrite(false);
    validate();
  });
}
sortKeys.addEventListener("click", () => {
  setOn(sortKeys, !isOn(sortKeys));
  if (doc) rewrite(minified);
  showLayout(documentText());
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
const settingsMenu = bindMenu(optionsBtn, options, {
  onOpen: () => {
    clearTimeout(pending);
    if (stale) validate();
    showOptions();
  },
});
unwrapBtn.addEventListener("click", () => {
  settingsMenu.close();
  runNested("unwrap");
});
wrapBtn.addEventListener("click", () => {
  settingsMenu.close();
  runNested("wrap");
});

// On a phone the file actions (Import, Export, Copy, Clear) fold into the "⋯" menu. Its
// items are made from the bar's buttons each time it opens, so they carry the same names and
// the same disabled state, and pressing one presses that button.
const more = byId("more");
const moreBtn = byId<HTMLButtonElement>("more-btn");
const fileButtons = [byId("open"), downloadBtn, copyBtn, clearBtn] as HTMLButtonElement[];
const moreMenu = bindMenu(moreBtn, more, {
  onOpen: () =>
    more.replaceChildren(
      ...fileButtons.map((b) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ui-menu-item";
        item.disabled = b.disabled;
        item.append(b.querySelector("svg")!.cloneNode(true), b.title.replace(/ —.*/, ""));
        item.addEventListener("click", () => {
          moreMenu.close();
          b.click();
        });
        return item;
      })
    ),
});

// Help docks under the header and stays open until its button closes it; a reload of the tab
// keeps it open.
bindDock(byId("help"), byId("help-btn"), { key: "tools.json.help" }).restore();

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
findPrev.addEventListener("click", () => findStep(-1));
findNext.addEventListener("click", () => findStep(1));
byId("find-close").addEventListener("click", closeFind);
findOpenBtn.addEventListener("click", toggleFind);
// Ctrl+F opens this find rather than the browser's, which cannot see the lines of a long
// document that are not drawn; F3 steps through matches like most editors.
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
pathBtn.addEventListener("click", () => void copyText(pathBtn.textContent ?? "", pathBtn));
// A phone's status bar: folded away until this opens it over the editor (see styles.css).
statusToggle.addEventListener("click", () => {
  const open = document.body.classList.toggle("status-open");
  statusToggle.setAttribute("aria-expanded", String(open));
  statusToggle.title = open ? "Hide status" : "Show status";
  statusToggle.setAttribute("aria-label", statusToggle.title);
  // Folded away, the footer had no size to measure the path against.
  if (open) fitPath();
});
window.addEventListener("resize", fitPath);

byId("open").addEventListener("click", async () => {
  const [file] = await pickFiles(".json,.csv,.tsv,application/json,text/csv,text/plain");
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

for (const view of [editor, exportView]) {
  onFileDrop(view.dom, ([file]) => {
    if (file) void load(file);
  });
}

bindThemeToggle(byId("theme-toggle"));
restore();
restored = true;
editor.setIndent(indent());
showColours();
validate();
setMode(mode);

registerServiceWorker();
