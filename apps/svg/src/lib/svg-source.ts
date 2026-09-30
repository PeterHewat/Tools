import { getState, setState, findElement, selectOnly } from "./state.js";
import { undoStepper } from "./undo.js";
import { elementToSvgMarkup, buildDefsMarkup, formatExportSvg } from "./svg-export.js";
import { sanitizeName, elementIdFromSvgId, groupIdFromSvgId } from "./svg-names.js";
import { importSvgFile } from "./svg-import.js";
import { groupsOf, selectedGroups } from "./groups.js";
import { type EditorState, type SceneElement } from "./types.js";
import { byId } from "@tools/ui";
import { createEditor, type Highlight } from "@tools/editor";
import { noteChange } from "./documents.js";

/* ---------- SVG source: editable, highlighted, synced with the selection ---------- */
const svgError = byId("svg-error");
const primitiveListEl = byId("primitive-list");
let editStep = undoStepper();
let svgApplyTimer: ReturnType<typeof setTimeout> | null = null;
let lastSelectionKey = "";
/** What the highlights were last built from; see `refreshSvgHighlight`. */
let highlightKey = "";

// Primitive-row field that has keyboard focus -> the SVG attribute(s) it edits.
const FIELD_ATTRS: Record<string, string[]> = {
  stroke: ["stroke", "stroke-opacity"],
  strokeWidth: ["stroke-width", "stroke"],
  linecap: ["stroke-linecap"],
  linejoin: ["stroke-linejoin"],
  dash: ["stroke-dasharray"],
  fill: ["fill", "fill-opacity"],
  fillEnabled: ["fill", "fill-opacity"],
  fillType: ["fill"],
  strokeType: ["stroke"],
  fillRule: ["fill-rule"],
  fillStopOffset: [],
  strokeStopOffset: [],
  rx: ["rx", "ry"],
  ry: ["rx", "ry"],
  fontSize: ["font-size"],
  fontFamily: ["font-family"],
  anchor: ["text-anchor"],
  rotation: ["transform"],
  markerStart: ["marker-start"],
  markerEnd: ["marker-end"],
  name: ["id"],
  closed: ["d", "points"],
};
// Fields whose values live in a <defs> block: id prefix (and suffix) of that block.
const FIELD_BLOCKS: Record<string, [string, string?]> = {
  fillType: ["grad-"],
  fill: ["grad-"],
  fillStopOffset: ["grad-"],
  strokeType: ["grad-", "-stroke"],
  stroke: ["grad-", "-stroke"],
  strokeStopOffset: ["grad-", "-stroke"],
  markerStart: ["mk-", "-start"],
  markerEnd: ["mk-", "-end"],
};
let svgFocus: { id: string; field: string } | null = null;

const editor = createEditor(byId("svg-editor"), {
  language: "xml",
  colours: "syntax",
  lineWrapping: true,
  label: "SVG source (editable)",
  onChange(user) {
    if (!user) return;
    refreshSvgHighlight(getState().selection.elementIds);
    if (svgApplyTimer) clearTimeout(svgApplyTimer);
    svgApplyTimer = setTimeout(applySvgText, 500);
  },
  onSelection: selectFromCaret,
  onFocus(focused) {
    if (focused) {
      editStep = undoStepper();
    } else if (svgApplyTimer) {
      clearTimeout(svgApplyTimer);
      applySvgText();
    }
  },
});

/** Stretches of a line (starting at offset `at`) holding what a primitive field edits. */
function attrRanges(line: string, at: number, field: string): Highlight[] {
  const out: Highlight[] = [];
  const add = (index: number, length: number) =>
    out.push({ from: at + index, to: at + index + length, class: "svg-attr-focus" });
  for (const attr of FIELD_ATTRS[field] ?? []) {
    for (const m of line.matchAll(new RegExp(`(?<=\\s)${attr}="[^"]*"`, "g"))) {
      add(m.index, m[0].length);
    }
  }
  if (field === "text") {
    const m = /(?<=>)[^<]*(?=<\/text)/.exec(line);
    if (m && m[0]) add(m.index, m[0].length);
  }
  return out;
}

/** Where the selected shapes, and the focused attribute, first show: scrolled to. */
let firstSelected = -1;
let firstFocused = -1;

/** Highlights the selected shapes' lines and the attribute the focused primitive field edits. */
function refreshSvgHighlight(selectedIds: readonly string[]): void {
  // Rebuilt only when what it shows changed: on a drag, the text changes every frame, but on a
  // pointer move or a click elsewhere it rarely does.
  const text = editor.text;
  const key = `${text}\0${selectedIds.join(",")}\0${svgFocus?.id}:${svgFocus?.field}`;
  if (key === highlightKey) return;
  highlightKey = key;
  const sel = new Set(selectedIds);
  // A group counts as selected when all of it is; its <g> and its </g> are highlighted then.
  const groups = selectedGroups(getState().elements, sel);
  // One entry per <g> still open, saying whether its </g> should be highlighted too.
  const open: boolean[] = [];
  const focus = svgFocus;
  const block = focus ? FIELD_BLOCKS[focus.field] : undefined;
  let inBlock = false;
  const highlights: Highlight[] = [];
  firstSelected = firstFocused = -1;
  let at = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/\bid="([^"]+)"/);
    const svgId = m ? m[1]! : "";
    const elId = m ? elementIdFromSvgId(svgId) : null;
    if (focus && elId === focus.id) highlights.push(...attrRanges(line, at, focus.field));
    let selected = !!elId && sel.has(elId);
    if (/^\s*<g[\s>]/.test(line) && !/\/>\s*$/.test(line)) {
      const gid = groupIdFromSvgId(svgId);
      selected = !!gid && groups.has(gid);
      open.push(selected);
    } else if (/^\s*<\/g>/.test(line)) {
      selected = open.pop() ?? false;
    }
    if (selected) {
      highlights.push({ from: at, to: at, class: "svg-line--selected", line: true });
      if (firstSelected < 0) firstSelected = at;
    }
    if (block && focus) {
      if (svgId === block[0] + focus.id + (block[1] ?? "")) {
        inBlock = true;
      }
      if (inBlock && line) {
        highlights.push({ from: at, to: at + line.length, class: "svg-attr-focus" });
      }
      if (inBlock && /<\/(linearGradient|radialGradient|marker)>/.test(line)) inBlock = false;
    }
    at += line.length + 1;
  }
  for (const h of highlights) {
    if (h.class === "svg-attr-focus" && (firstFocused < 0 || h.from < firstFocused)) {
      firstFocused = h.from;
    }
  }
  editor.setHighlights(highlights);
}

export function setSvgFocus(next: { id: string; field: string } | null): void {
  const same = svgFocus?.id === next?.id && svgFocus?.field === next?.field;
  svgFocus = next;
  if (same) return;
  refreshSvgHighlight(getState().selection.elementIds);
  if (next && !editor.focused && firstFocused >= 0) editor.scrollTo(firstFocused, "top");
}

function fieldOf(target: EventTarget | null): { id: string; field: string } | null {
  const el = target as HTMLElement | null;
  const li = el?.closest<HTMLElement>("[data-element-id]");
  if (!li || !primitiveListEl.contains(li)) return null;
  const field = el?.closest<HTMLElement>("[data-picker]")?.dataset.picker ?? el?.dataset.field;
  const id = li.dataset.elementId;
  return field && id ? { id, field } : null;
}

primitiveListEl.addEventListener("focusin", (e) => setSvgFocus(fieldOf(e.target)));
let pickerHold = false; // the color popover steals focus but its swatch stays "in use"

/** Called while the colour popover is open, which takes focus without the swatch leaving use. */
export function holdSvgFocus(hold: boolean): void {
  pickerHold = hold;
}
primitiveListEl.addEventListener("focusout", () => {
  if (!pickerHold) setSvgFocus(null);
});

/**
 * How often, at most, the panel follows a stream of changes. Keeping it current means exporting
 * the whole document, which on a large one is most of the cost of each frame of a drag; a few
 * updates a second read as live, and the last change always lands.
 */
const SYNC_INTERVAL_MS = 120;
let lastSyncAt = -Infinity;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** Changes were skipped while the panel was not on screen. */
let stale = false;

function onScreen(): boolean {
  const dom = editor.dom;
  return typeof dom.checkVisibility === "function" ? dom.checkVisibility() : true;
}

// Opening the section or the panel lays the field out again, and that is when it catches up.
new ResizeObserver(() => {
  if (stale && onScreen()) syncSvgEditorNow(getState());
}).observe(editor.dom);

/** Keeps the panel in step with the document: at once when it can, soon after when it cannot. */
export function syncSvgEditor(state: EditorState): void {
  if (!onScreen()) {
    stale = true;
    return;
  }
  const wait = lastSyncAt + SYNC_INTERVAL_MS - performance.now();
  if (wait <= 0) {
    syncSvgEditorNow(state);
    return;
  }
  syncTimer ??= setTimeout(() => {
    syncTimer = null;
    syncSvgEditorNow(getState());
  }, wait);
}

function syncSvgEditorNow(state: EditorState): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  lastSyncAt = performance.now();
  stale = false;
  const focused = editor.focused;
  if (!focused) {
    const text = formatExportSvg(state, true);
    // Only what changed is replaced, so the scroll stays put. The text follows the drawing, so
    // it is not a step of the editor's undo: the app's own undo covers the drawing.
    if (editor.text !== text) {
      editor.setText(text, "sync");
      hideSvgError();
    }
  }
  refreshSvgHighlight(state.selection.elementIds);
  const key = state.selection.elementIds.join(",");
  if (!focused && key !== lastSelectionKey && firstSelected >= 0) {
    editor.scrollTo(firstSelected, "top");
  }
  lastSelectionKey = key;
}

function showSvgError(message: string): void {
  svgError.textContent = `Invalid SVG — not applied: ${message}`;
  svgError.classList.remove("hidden");
  editor.dom.classList.add("invalid");
}

function hideSvgError(): void {
  svgError.classList.add("hidden");
  editor.dom.classList.remove("invalid");
}

function sameElement(a: SceneElement, b: SceneElement): boolean {
  return (
    a.type === b.type &&
    elementToSvgMarkup(a) === elementToSvgMarkup(b) &&
    buildDefsMarkup([a]) === buildDefsMarkup([b]) &&
    sanitizeName(a.name) === sanitizeName(b.name) &&
    groupsOf(a).join("/") === groupsOf(b).join("/")
  );
}

/**
 * Group names from the markup. A name typed with spaces comes back underscored from its id, so
 * where the markup still says the same thing the name as typed is kept, as shapes' names are.
 */
function mergeGroupNames(
  parsed: Record<string, string>,
  current: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [gid, name] of Object.entries(parsed)) {
    const typed = current[gid];
    out[gid] = typed && sanitizeName(typed) === sanitizeName(name) ? typed : name;
  }
  return out;
}

const sameNames = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** Applies the edited markup. Untouched shapes keep their exact float geometry. */
function applySvgText(): void {
  svgApplyTimer = null;
  let parsed;
  try {
    parsed = importSvgFile(editor.text, { keepIds: true });
  } catch (err) {
    showSvgError(err instanceof Error ? err.message : String(err));
    return;
  }
  hideSvgError();
  const st = getState();
  const old = new Map(st.elements.map((e) => [e.id, e]));
  const next = parsed.elements.map((n) => {
    const o = old.get(n.id);
    if (o && sameElement(o, n)) return o;
    // The markup does not carry a lock: an edited shape keeps the one it had.
    return o?.locked ? { ...n, locked: true } : n;
  });
  const artboard = parsed.artboard ? { ...st.artboard, ...parsed.artboard } : st.artboard;
  // No background rect in the markup means a transparent document; the colour is kept so that
  // deleting the rect and typing it back does not lose what was chosen.
  const background = parsed.background ?? { color: st.background.color, opacity: 0 };
  const groupNames = mergeGroupNames(parsed.groupNames, st.groupNames);
  const same =
    sameNames(groupNames, st.groupNames) &&
    next.length === st.elements.length &&
    next.every((e, i) => e === st.elements[i]) &&
    artboard.width === st.artboard.width &&
    artboard.height === st.artboard.height &&
    background.color === st.background.color &&
    background.opacity === st.background.opacity;
  if (same) return;
  editStep();
  const ids = new Set(next.map((e) => e.id));
  setState((s) => ({
    ...s,
    elements: next,
    groupNames,
    artboard,
    background,
    selection: selectOnly(s.selection.elementIds.filter((id) => ids.has(id))),
  }));
  noteChange();
}

/** The caret inside a shape's line selects that shape (like picking it in Primitives). */
function selectFromCaret(): void {
  if (!editor.focused) return;
  const line = editor.line(editor.position(editor.selection.head).line);
  const m = line.match(/\bid="([^"]+)"/);
  const elId = m ? elementIdFromSvgId(m[1]) : null;
  if (!elId || !findElement(elId)) return;
  const cur = getState().selection.elementIds;
  if (cur.length === 1 && cur[0] === elId) return;
  setState({ tool: "select", selection: selectOnly([elId]) });
}
