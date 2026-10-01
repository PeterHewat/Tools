import { getState, setState, clearDrawing } from "./state.js";
import { collectAlignPoints } from "./model.js";
import { snapFeatures } from "./snap.js";
import { screenToWorld } from "./viewport.js";
import { pushUndo } from "./undo.js";
import { withGuide, type GuideAxis } from "./guides.js";
import type { EditorState, Point } from "./types.js";
const ALIGN_TOL_PX = 6;

/** Whether a press or release is over the ruler a guide on `axis` comes out of. */
export function overRuler(axis: GuideAxis, e: PointerEvent): boolean {
  const ruler = document.getElementById(axis === "y" ? "ruler-top" : "ruler-left");
  const r = ruler?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return false;
  return axis === "y" ? e.clientY <= r.bottom : e.clientX <= r.right;
}

/**
 * Where a guide dragged to `raw` settles. Snapping to shapes (the switch, or Alt) puts it in line
 * with the nearest point of a shape - corners, centres, midpoints, crossings - within reach; grid
 * snap puts it on the grid. `points` is asked only when shapes are snapped to, as working out
 * crossings is not free.
 */
export function guideAt(
  axis: GuideAxis,
  raw: number,
  e: PointerEvent,
  points: (s: EditorState) => readonly Point[]
): number {
  const s = getState();
  if (getState().alignSnap || e.altKey) {
    let at = raw;
    let best = ALIGN_TOL_PX / s.viewport.zoom;
    for (const p of points(s)) {
      const d = Math.abs(p[axis] - raw);
      if (d < best) {
        best = d;
        at = p[axis];
      }
    }
    return at;
  }
  if (!s.grid.snap) return raw;
  const step = Math.max(1, s.grid.step);
  return Math.round(raw / step) * step;
}

/** Every point of the document a guide can line up with. */
function guideTargets(s: EditorState): Point[] {
  return [...collectAlignPoints(s.elements, {}), ...snapFeatures(s.elements, new Set())];
}

/**
 * Dragging a new guide out of a ruler: the top ruler gives a horizontal one, the left a vertical
 * one. It follows the pointer as a dashed line and is placed where it is let go - unless that is
 * back on the ruler, which is how a guide pulled out by mistake goes away again.
 */
export function bindRulerGuides(top: HTMLCanvasElement, left: HTMLCanvasElement): void {
  const start = (axis: GuideAxis, canvas: HTMLCanvasElement) => (e: PointerEvent) => {
    const st = getState();
    if (e.button !== 0 || st.drawing?.activePathId) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    // The shapes stay put while a guide is dragged, so their points are worked out once.
    let targets: Point[] | null = null;
    const place = (ev: PointerEvent) => {
      const raw = screenToWorld(ev.clientX, ev.clientY)[axis];
      const at = guideAt(axis, raw, ev, (s) => (targets ??= guideTargets(s)));
      setState({ drawing: { guide: { axis, at } } });
    };
    const up = (ev: PointerEvent) => {
      canvas.removeEventListener("pointermove", place);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      const draft = getState().drawing?.guide;
      clearDrawing();
      if (!draft || ev.type === "pointercancel" || overRuler(axis, ev)) return;
      pushUndo();
      setState((s) => ({ ...s, guides: withGuide(s.guides, axis, draft.at) }));
    };
    canvas.addEventListener("pointermove", place);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  };
  top.addEventListener("pointerdown", start("y", top));
  left.addEventListener("pointerdown", start("x", left));
}
