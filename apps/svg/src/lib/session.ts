/**
 * What belongs to this tab rather than to the document: where you were looking. (Which panels
 * were open is kept the same way, by @tools/ui's bindDock.)
 *
 * None of it is part of the drawing, so it lives in `sessionStorage`: a refresh puts you back
 * exactly where you were, a new tab still starts clean, and nothing follows the document when it
 * is exported or shared.
 */

import { readStored, writeStored } from "@tools/ui";
import { setState } from "./state.js";
import type { EditorState, Viewport } from "./types.js";

const KEY = "svg.view";

export interface SessionView {
  /** The document the viewport belongs to: another document deserves its own fitted view. */
  docId: string | null;
  viewport: Viewport | null;
}

function isViewport(v: unknown): v is Viewport {
  const p = v as Viewport | null;
  return (
    !!p &&
    typeof p.panX === "number" &&
    typeof p.panY === "number" &&
    typeof p.zoom === "number" &&
    Number.isFinite(p.panX) &&
    Number.isFinite(p.panY) &&
    p.zoom > 0
  );
}

function readSessionView(): SessionView {
  const stored = (readStored(KEY, "session") ?? {}) as Partial<SessionView>;
  return {
    docId: typeof stored.docId === "string" ? stored.docId : null,
    viewport: isViewport(stored.viewport) ? stored.viewport : null,
  };
}

/** Read once, at load, before the first render would overwrite what it holds with a fitted view. */
export const savedView = readSessionView();

export function writeSessionView(patch: Partial<SessionView>): void {
  writeStored(KEY, { ...readSessionView(), ...patch }, "session");
}

/* ---------- Modifier switches ---------- */

/**
 * Sticky stand-ins for modifier keys, for a pointer with no keyboard to hold them on.
 *
 * Shift adds to a selection and Alt aligns to other shapes; a finger has neither. These are the
 * same two behaviours as switches that stay on until switched off. They belong to the session,
 * not the drawing: they are kept out of the editor state so that undo never flips them back.
 */

let selectMore = false;
let alignSnap = false;

/** Taps add shapes to the selection, or take them out, instead of replacing it (Shift). */
export function isSelectMore(): boolean {
  return selectMore;
}

export function setSelectMore(on: boolean): void {
  if (selectMore === on) return;
  selectMore = on;
  setState({});
}

/** Points snap to other shapes' points, as with Alt held, instead of to the grid. */
export function isAlignSnap(): boolean {
  return alignSnap;
}

/**
 * The two snaps are one choice: a point lands on the grid or on another shape's line, never both,
 * so switching either on switches the other off. Alt held borrows snap to shapes without
 * touching either switch.
 */
export function setAlignSnap(on: boolean): void {
  if (alignSnap === on) return;
  alignSnap = on;
  setState((s) => (on && s.grid.snap ? { ...s, grid: { ...s.grid, snap: false } } : { ...s }));
}

/** Grid snap, which belongs to the document: see `setAlignSnap`. */
export function setGridSnap(on: boolean): void {
  if (on) alignSnap = false;
  setState((s) => ({ ...s, grid: { ...s.grid, snap: on } }));
}

/**
 * Lets the switches go when the drawing changed under them, before it is drawn: adding to a
 * selection that has gone empty is starting a new one, and a document opened (or an undo) with
 * grid snap on keeps it, so snap to shapes lets go.
 */
export function followState(state: EditorState): void {
  if (!state.selection.elementIds.length) selectMore = false;
  if (state.grid.snap) alignSnap = false;
  // A Rotate field counts from 0 again for whatever is chosen next.
  const selection = keyOf(state.selection.elementIds);
  if (selection !== lastSelection) {
    lastSelection = selection;
    forgetTurns();
  }
}

/* ---------- The Rotate field's running total ---------- */

/**
 * How far the shapes of a group - or of a selection turned as one - have been rotated since they
 * were chosen. A group keeps no angle (every turn is baked into its members' coordinates), so the
 * Rotate field would otherwise read 0 again after every entry. Instead it reads this running
 * total, and typing a new value turns by the difference. Where you are, not part of the drawing:
 * never saved, and forgotten when the selection changes or history jumps.
 */

let key = "";
let degrees = 0;
/** The selection the running total was last checked against. */
let lastSelection = "";

const keyOf = (ids: Iterable<string>): string => [...ids].sort().join(",");

/** The running total for exactly these shapes; 0 for any other set. */
export function turnedBy(ids: Iterable<string>): number {
  return key && keyOf(ids) === key ? degrees : 0;
}

/** Adds a turn of these shapes to their total, starting a new one for a different set. */
export function addTurn(ids: Iterable<string>, by: number): void {
  const k = keyOf(ids);
  degrees = Math.round(((k === key ? degrees : 0) + by) * 100) / 100;
  key = k;
}

export function forgetTurns(): void {
  key = "";
  degrees = 0;
}
