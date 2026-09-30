import { AUTO_NAME_RE } from "./utils.js";
import { isCoarsePointer } from "./pointer.js";
import { assignGroupHuesInPlace, pruneGroupsInPlace } from "./groups.js";
import { createDocument } from "./project-file.js";
import type { DocumentState, EditorState, PathEdit, SceneElement, Selection } from "./types.js";

export interface NotifyOptions {
  /**
   * Only the pointer moved: the cursor, the hover target or the alignment guides changed, and
   * nothing else. The document, the lists and the SVG source can stay as they are.
   */
  pointerOnly?: boolean;
}

type Listener = (state: EditorState, options: NotifyOptions) => void;

/** The whole selection: some elements, plus optionally one of their anchors. */
export function selectOnly(elementIds: string[] = [], pathEdit: PathEdit | null = null): Selection {
  return { elementIds, pathEdit };
}

export function createInitialState(document = createDocument(isCoarsePointer())): EditorState {
  return {
    ...document,
    viewport: { panX: 40, panY: 40, zoom: 1 },
    tool: "select",
    finalOnly: false,
    selectMore: false,
    alignSnap: false,
    selection: selectOnly(),
    drawing: null,
    hoverId: null,
    cursor: { x: 0, y: 0, snapX: 0, snapY: 0, snapActive: false },
    align: { x: null, y: null },
    dropTarget: null,
    ui: { expandedImageId: null, expandedElementId: null, editingTextId: null },
    spacePan: false,
  };
}

let state: EditorState = createInitialState();
const listeners = new Set<Listener>();
const documentListeners = new Set<() => void>();
let documentRevision = 0;
const DOCUMENT_KEYS: readonly (keyof DocumentState)[] = [
  "artboard",
  "background",
  "grid",
  "elements",
  "groupNames",
  "groupHues",
  "guides",
  "images",
];

export const getDocumentRevision = (): number => documentRevision;

export function subscribeDocument(fn: () => void): () => void {
  documentListeners.add(fn);
  return () => {
    documentListeners.delete(fn);
  };
}

function normalizeDocument(): void {
  ensureDefaultNames(state.elements);
  pruneGroupsInPlace(state.elements);
  assignGroupHuesInPlace(state.elements, state.groupHues);
}

function documentChanged(normalize: boolean): void {
  if (normalize) normalizeDocument();
  documentRevision++;
  for (const fn of documentListeners) fn();
}

export function getState(): EditorState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let pending: NotifyOptions | null = null;

/**
 * Renders on the next frame; document edits have already normalized the model.
 *
 * A single pointer move can change state two or three times (the cursor, a drag, the hover).
 * Deferred, they cost one render per frame however many there were - and that render is a
 * pointer-only one when all of them were.
 */
function notify(options: NotifyOptions): void {
  if (pending) {
    pending = { pointerOnly: !!pending.pointerOnly && !!options.pointerOnly };
    return;
  }
  pending = { ...options };
  requestAnimationFrame(flushRender);
}

/** Renders now whatever is waiting for the next frame, for code that needs the DOM current. */
export function flushRender(): void {
  if (!pending) return;
  const options = pending;
  pending = null;
  for (const fn of listeners) fn(state, options);
}

/**
 * Every shape always has a real name. Unnamed shapes get "<type> <n>" (n = highest used for that
 * type + 1). Default names of another type (after path->line, rect->polygon, ...) and duplicated
 * default names (copy/paste) are renumbered. Names a user typed are never touched.
 */
function ensureDefaultNames(elements: SceneElement[]): void {
  const top = new Map<string, number>();
  const seen = new Set<string>();
  for (const el of elements) {
    const m = AUTO_NAME_RE.exec(el.name);
    if (m && m[1] === el.type) {
      top.set(el.type, Math.max(top.get(el.type) ?? 0, Number(m[2])));
    }
  }
  for (const el of elements) {
    const name = el.name;
    const m = AUTO_NAME_RE.exec(name);
    const keep = name && !(m && (m[1] !== el.type || seen.has(name)));
    if (keep) {
      if (m) seen.add(name);
      continue;
    }
    const n = (top.get(el.type) ?? 0) + 1;
    top.set(el.type, n);
    el.name = `${el.type} ${n}`;
    seen.add(el.name);
  }
}

type StatePatch = Partial<EditorState> | ((current: EditorState) => EditorState);

/** An empty selection ends additive selection; grid snap takes priority over shape snap. */
function normalizeSession(): void {
  if (!state.selection.elementIds.length) state.selectMore = false;
  if (state.grid.snap) state.alignSnap = false;
}

/** The slices that follow the pointer around without changing the drawing. */
const POINTER_KEYS: ReadonlySet<string> = new Set(["cursor", "align", "hoverId", "dropTarget"]);

/**
 * Whether going from `prev` to `next` changed pointer slices and nothing else. A change that
 * touched nothing at all is not one: a session control may still need a full render.
 */
function onlyPointerChanged(prev: EditorState, next: EditorState): boolean {
  let changed = false;
  for (const key of Object.keys(next) as (keyof EditorState)[]) {
    if (prev[key] === next[key]) continue;
    if (!POINTER_KEYS.has(key)) return false;
    changed = true;
  }
  return changed;
}

/** Replaces state slices. `patch` is an object of slices, or a function returning the next state. */
export function setState(patch: StatePatch): void {
  const prev = state;
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  normalizeSession();
  if (DOCUMENT_KEYS.some((key) => prev[key] !== state[key]))
    documentChanged(prev.elements !== state.elements);
  notify({ pointerOnly: onlyPointerChanged(prev, state) });
}

/**
 * Edits the current state in place, then re-renders. Used where the change is a mutation of
 * existing geometry (drags, field edits) rather than a replacement of a slice.
 */
export function mutateDocument(fn: (current: DocumentState) => void): void {
  fn(state);
  normalizeSession();
  documentChanged(true);
  notify({});
}

export function replaceState(next: EditorState): void {
  state = next;
  normalizeSession();
  normalizeDocument();
  documentRevision++;
  notify({});
}

/** Open document data with fresh editing UI while keeping this tab's tool, view and shape snap. */
export function replaceDocument(document?: DocumentState): void {
  replaceState({
    ...createInitialState(document),
    tool: state.tool,
    finalOnly: state.finalOnly,
    alignSnap: state.alignSnap,
  });
}

/**
 * A snapshot for the undo stack. Reference images are cloned without their data URL, which is
 * then put back by reference: a base64 image is megabytes, the stack holds a hundred entries,
 * and the pixels never change - only the transform around them, which is what undo has to keep.
 */
export function snapshotDocument(): DocumentState {
  const document = Object.fromEntries(
    DOCUMENT_KEYS.map((key) => [key, state[key]])
  ) as unknown as DocumentState;
  return {
    ...structuredClone({ ...document, images: [] }),
    images: state.images.map((image) => ({ ...image })),
  };
}

/** Restore history without rewinding the viewport, current tool or transient UI. */
export function restoreDocument(document: DocumentState): void {
  const ids = new Set(document.elements.map((element) => element.id));
  setState({
    ...document,
    selection: selectOnly(state.selection.elementIds.filter((id) => ids.has(id))),
    drawing: null,
    dropTarget: null,
    ui: { ...state.ui, editingTextId: null },
  });
}

export function findElement(id: string | null | undefined): SceneElement | undefined {
  if (!id) return undefined;
  return state.elements.find((e) => e.id === id);
}

export function selectedElements(): SceneElement[] {
  return state.selection.elementIds
    .map((id) => findElement(id))
    .filter((e): e is SceneElement => !!e);
}

/**
 * Puts each of `next` in place of the shape with the same id; `patch` changes other slices in
 * the same update (the selection, the drawing).
 */
export function replaceElements(
  next: readonly SceneElement[],
  patch: Partial<EditorState> = {}
): void {
  const byId = new Map(next.map((el) => [el.id, el]));
  setState((s) => ({ ...s, ...patch, elements: s.elements.map((x) => byId.get(x.id) ?? x) }));
}

export function clearDrawing(): void {
  setState({ drawing: null, dropTarget: null });
}
