import { bindHeader } from "./lib/header.js";
import {
  readPrefs,
  writePrefs,
  readExactChoices,
  writeExactChoices,
  type Prefs,
  type ViewMode,
  type PathStyle,
  type Indent,
} from "./lib/preferences.js";
import {
  bindMenu,
  byId,
  copyText,
  debounce,
  downloadText,
  dropDraft,
  formatBytes,
  isOn,
  onFileDrop,
  pickFiles,
  readDraft,
  registerServiceWorker,
  setOn,
  setPressed,
  writeDraft,
} from "@tools/ui";
import { createEditor, type LineLexer } from "@tools/editor";
import { applyEdits, REPAIRS, type Edit, type JsonNode, type RepairKind } from "./lib/ast.js";
import { BLOCK_COMMENT, highlightLine } from "./lib/highlight.js";
import { lexCsvSheet, lexTypeScript, lexYaml } from "./lib/lexers.js";
import { toCsv, type Converted } from "./lib/convert.js";
import { createAnalysis, type Analysis } from "./lib/analysis.js";
import type { ExportKind, ExportResult } from "./lib/exports.js";
import { excerptAt } from "./lib/inspect.js";
import { unwrapString, wrapAsString } from "./lib/nested.js";
import { positionAt } from "./lib/lines.js";
import { jsonPointer, jsPath, nodeAt, type PathSegment } from "./lib/path.js";
import { printJson, printedSize } from "./lib/print.js";
import { SAMPLE } from "./lib/sample.js";
import { csvToJson, looksLikeCsv } from "./lib/csv-read.js";
import { type CsvSheet } from "./lib/tables.js";
import { bindFind } from "./lib/find.js";

const formatBtn = byId<HTMLButtonElement>("format");
const minifyBtn = byId<HTMLButtonElement>("minify");
const sortKeys = byId<HTMLButtonElement>("sort-keys");
const copyBtn = byId<HTMLButtonElement>("copy");
const downloadBtn = byId<HTMLButtonElement>("download");
const clearBtn = byId<HTMLButtonElement>("clear");
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
const options = byId("options");
const optionsBtn = byId<HTMLButtonElement>("options-btn");
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const viewSelect = byId<HTMLSelectElement>("view-select");
const indentButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-indent]")];
const pathStyleButtons = [...options.querySelectorAll<HTMLButtonElement>("[data-path-style]")];
const unwrapBtn = options.querySelector<HTMLButtonElement>('[data-action="unwrap"]')!;
const wrapBtn = options.querySelector<HTMLButtonElement>('[data-action="wrap"]')!;
/** The JSON's colours: its lexer, with block comments that can run over lines. */
const JSON_COLOURS = { lexer: highlightLine, blockComment: BLOCK_COMMENT };
const editor = createEditor(codeEl, {
  language: "json",
  colours: JSON_COLOURS,
  label: "JSON",
  placeholder: "Paste JSON here, or drop a .json file",
  keys: [
    {
      key: "Mod-Enter",
      run: () => {
        validate();
        rewrite(false);
        return true;
      },
    },
  ],
  onChange: (user) => {
    textCache = null;
    find.changed();
    droppedDraft = false;
    draftChanged = true;
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

// ---------- State ----------

/** JSON edits the document; the others show it converted, read-only. */

let fileName = "data.json";
const analysis = createAnalysis();
let currentAnalysis: Analysis = analysis.read("");
/** Typed since the last parse: the analysis's positions may be off until it is parsed again. */
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

const find = bindFind([editor, exportView], () => ({
  editor: mode === "json" ? editor : exportView,
  text: mode === "json" ? documentText() : (exportedText() ?? ""),
  mode,
}));

// ---------- Storage ----------

/** This tab's document, in the shared session draft (`@tools/ui`). */
const DRAFT = 1;
/** The tab reloaded after dropping a draft too large to keep: said until the next change. */
let droppedDraft = false;
/** Only text changes write the draft; settings changes leave it alone. */
let draftChanged = true;

function restore(): void {
  const prefs = readPrefs();
  indentChoice = prefs.indent;
  setOn(sortKeys, prefs.sortKeys);
  mode = prefs.view;
  pathStyle = prefs.pathStyle;
  colours = prefs.colours;
  // A tab with no draft yet opens on the sample. Cleared, the draft is "" and stays empty.
  const draft = readDraft("json", DRAFT);
  const saved = draft.value.text;
  showDocument(draft.dropped ? "" : typeof saved === "string" ? saved : SAMPLE);
  // After the document is in: putting it there was a change, and a change ends the warning.
  droppedDraft = draft.dropped === true;
  for (const place of readExactChoices()) exactPlaces.add(place);
  showOptions();
}

function savePrefs(): void {
  const prefs: Prefs = {
    indent: indentChoice,
    sortKeys: isOn(sortKeys),
    view: mode,
    pathStyle,
    colours,
  };
  writePrefs(prefs);
}

function saveDraft(): void {
  if (!draftChanged) return;
  draftChanged = false;
  // Marked dropped while the empty editor still stands for a draft too large to keep: every
  // reload says so.
  if (droppedDraft) dropDraft("json", DRAFT);
  else writeDraft("json", DRAFT, { text: documentText() });
}

function saveExactChoices(): void {
  writeExactChoices(exactPlaces);
}

function indent(): number | "\t" {
  return indentChoice === "tab" ? "\t" : Number(indentChoice);
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** "3 comments, 1 trailing comma": what a Fix would change, most common first. */
function describeEdits(edits: readonly Edit[]): string {
  const counts = new Map<RepairKind, number>();
  for (const e of edits) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => plural(n, REPAIRS[kind].noun))
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
  find.marks();
}

/** Selects a stretch of the document, unfolding what hides it, and scrolls it to the middle. */
function selectInDocument(start: number, end: number, focus = true): void {
  editor.select(start, end, { focus });
  showCursor();
}

// ---------- The value you are on: nested JSON and the CSV table ----------

/** The value under the caret, while the document is valid and parsed from the text as it is. */
function atCursor(): ReturnType<typeof nodeAt> | null {
  return currentAnalysis.doc && !stale
    ? nodeAt(currentAnalysis.doc.root, editor.selection.from)
    : null;
}

/** The values from the root down to the one under the caret. */
function contextChain(): JsonNode[] {
  return atCursor()?.chain ?? [];
}

// ---------- Export views ----------

interface ExportSpec {
  label: string;
  lexer: LineLexer;
  extension: string;
}

// ---------- CSV: every array as a table ----------

const rows = (n: number) => plural(n, "row");

/** With several tables, the one the CSV view's cursor is in: Copy and Export take it. */
function csvSection(): CsvSheet["sections"][number] | undefined {
  const sheet = conversion?.sheet;
  if (mode !== "csv" || !sheet || sheet.sections.length < 2) return undefined;
  const line = exportView.position(exportView.selection.from).line - 1;
  return sheet.sections.find((s) => line <= s.lastLine) ?? sheet.sections.at(-1);
}

/** Says what the tables are, and which one Copy and Export take. */
function showCsvNote(): void {
  const sheet = conversion?.sheet;
  const shown = mode === "csv" && !!sheet && exportedText() !== null;
  csvBar.classList.toggle("hidden", !shown);
  if (!shown) return;
  const numbered = conversion?.lineLabels ? ", numbered by their line in the JSON" : "";
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
  const candidates = conversion?.candidates ?? [];
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
          saveExactChoices();
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
  },
  // Every array, one table after another (see lib/tables.ts).
  csv: {
    label: "CSV",
    lexer: lexCsvSheet,
    extension: ".csv",
  },
  ts: {
    label: "TypeScript types",
    lexer: lexTypeScript,
    extension: ".d.ts",
  },
  schema: {
    label: "JSON Schema",
    lexer: highlightLine,
    extension: ".schema.json",
  },
};

const isExport = (m: ViewMode): m is ExportKind => m in EXPORTS;

/** One conversion owns its text, candidates, tables and line mapping together. */
let conversion: ExportResult | null = null;

function exportedText(): string | null {
  return conversion?.result.ok ? conversion.result.text : null;
}
/** The text last put in the export view, kept so it is only replaced when it changes. */
let exportShown = "";

function showExport(): void {
  if (!isExport(mode)) {
    conversion = null;
    exportEl.classList.add("hidden");
    exportMessage.classList.add("hidden");
    showCsvNote();
    showExactBar();
    return;
  }
  conversion = currentAnalysis.exports?.convert(mode, { exact: exactPlaces, pathStyle }) ?? null;
  const result: Converted = conversion?.result ?? {
    ok: false,
    message: currentAnalysis.fault
      ? "Not valid JSON: switch to the JSON view to fix it."
      : "Nothing to convert yet.",
  };
  exportEl.classList.toggle("hidden", !result.ok);
  exportMessage.classList.toggle("hidden", result.ok);
  showCsvNote();
  showExactBar();
  if (result.ok) {
    exportView.setColours(colours ? EXPORTS[mode].lexer : null);
    exportView.setLineLabels(mode === "csv" ? (conversion?.lineLabels ?? null) : null);
    // Only when it changed, and only what changed, so the reader keeps their place.
    if (exportShown !== result.text) {
      exportShown = result.text;
      exportView.setText(result.text, "sync");
      find.changed();
      find.refresh();
    }
  } else {
    exportMessage.textContent = result.message;
  }
  showFileControls();
}

/** Turns syntax colours on or off everywhere: the text and the converted views. */
function showColours(): void {
  editor.setColours(colours ? JSON_COLOURS : null);
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

// ---------- Validation: after every pause in typing, and every change made from code ----------

function validate(): void {
  validateSoon.cancel();
  const text = documentText();
  const empty = !text.trim();
  currentAnalysis = analysis.read(text);
  const { doc, fault } = currentAnalysis;
  stale = false;
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
    } else if (text.length > LONG_TEXT && editor.lineCount < 100) {
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
  editor.setError(
    fault && {
      from: fault.position.offset,
      message: fault.message,
    }
  );
  find.changed();
  find.refresh();
  showExport();
  showOptions();
  showViewControls();
  showCursor();
  saveDraft();
}

const validateSoon = debounce(validate, 150);

/** Past this, a document with hardly any line breaks gets a nudge to format it. */
const LONG_TEXT = 1_000_000;

// ---------- Rewrites ----------

/**
 * Whole-text rewrites (Format, Minify, Clear, Fix, Unwrap): each is one step of the editor's
 * undo, and changes only what differs, so the caret and folds stay where the text did not.
 */
function replaceText(text: string): void {
  if (text === documentText()) {
    validate();
    return;
  }
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
  formatBtn.disabled = minifyBtn.disabled = !currentAnalysis.doc;
  const oneLine = !text.includes("\n");
  const laidOut =
    !!currentAnalysis.doc &&
    text ===
      printJson(currentAnalysis.doc.root, {
        indent: oneLine ? 0 : indent(),
        sortKeys: isOn(sortKeys),
      });
  setPressed(formatBtn, laidOut && !oneLine);
  setPressed(minifyBtn, laidOut && oneLine);
}

function rewrite(minify: boolean): void {
  if (stale) validate();
  if (!currentAnalysis.doc) return;
  replaceText(
    printJson(currentAnalysis.doc.root, { indent: minify ? 0 : indent(), sortKeys: isOn(sortKeys) })
  );
}

/** Makes almost-JSON strict in place, keeping the layout: only the offending bits change. */
function fix(): void {
  if (stale) validate();
  if (currentAnalysis.fault?.edits)
    replaceText(applyEdits(documentText(), currentAnalysis.fault.edits));
}

/** The text, read as CSV, replaced by the JSON array of its rows (Ctrl+Z takes it back). */
function fromCsv(): void {
  const json = csvToJson(documentText(), indent());
  if (!json) return;
  replaceText(json);
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
  pathBtn.classList.toggle("hidden", !path || isExport(mode));
  // In a span: see .path in styles.css for why.
  const label = document.createElement("span");
  label.textContent = formatPath(path ?? []);
  pathBtn.replaceChildren(label);
  // The root has no path to copy.
  pathBtn.disabled = !path?.length;
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
  if (stale) validate();
  mode = next;
  codeEl.classList.toggle("hidden", mode !== "json");
  for (const b of viewButtons) setPressed(b, b.dataset.view === mode);
  viewSelect.value = mode;
  // The text's own buttons float over it, shown only in its view.
  document.body.dataset.view = mode;
  // Hidden but still holding its place, so the path does not move when the view changes.
  cursor.classList.toggle("invisible", mode !== "json");
  showExport();
  find.viewChanged();
  if (mode === "json") {
    editor.focus();
    showCursor();
  } else {
    exportView.select(0, 0, { scroll: "top" });
    showPath(shownPath);
  }
  showViewControls();
  savePrefs();
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
  copyBtn.disabled = downloadBtn.disabled = isExport(mode) ? exportedText() === null : empty;
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
  if (!currentAnalysis.fault) return;
  if (mode !== "json") setMode("json");
  const { offset } = currentAnalysis.fault.position;
  selectInDocument(offset, offset + 1);
}

async function load(file: File): Promise<void> {
  fileName = file.name;
  exactPlaces.clear();
  saveExactChoices();
  const text = await file.text();
  const json = isCsvFile(file) ? csvToJson(text, indent()) : null;
  if (json) fileName = file.name.replace(/\.(csv|tsv)$/i, ".json");
  showDocument(json ?? text);
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
  const text = exportedText();
  if (isExport(mode) && text !== null) {
    return { text, name: base + EXPORTS[mode].extension, mime: "text/plain" };
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
    if (currentAnalysis.doc && !minified) rewrite(false);
    else validate();
    savePrefs();
  });
}
sortKeys.addEventListener("click", () => {
  setOn(sortKeys, !isOn(sortKeys));
  if (currentAnalysis.doc) rewrite(minified);
  showLayout(documentText());
  showOptions();
  savePrefs();
});
coloursBtn.addEventListener("click", () => {
  colours = !colours;
  showColours();
  showOptions();
  savePrefs();
});
for (const b of pathStyleButtons) {
  b.addEventListener("click", () => {
    pathStyle = b.dataset.pathStyle as PathStyle;
    showOptions();
    showPath(shownPath);
    if (mode === "csv") showExport();
    savePrefs();
  });
}
const settingsMenu = bindMenu(optionsBtn, options, {
  onOpen: () => {
    validateSoon.cancel();
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

bindHeader();

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

restore();
editor.setIndent(indent());
showColours();
validate();
setMode(mode);

registerServiceWorker();
