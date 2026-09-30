import { elementBBox, localBBox, toWorldPoint } from "./model.js";
import {
  cornerHandleInset,
  isCoarsePointer,
  ROTATE_REACH_COARSE,
  ROTATE_REACH_FINE,
} from "./pointer.js";
import { hasBoxHandles } from "./resize.js";
import { unionBox } from "./selection-transform.js";
import type { Point, RectElement, SceneElement } from "./types.js";

/** Visible handle radius in screen pixels, shared by drawing and floating controls. */
export const HANDLE_RADIUS = 5;

/** How far the rotate handle sits above the shape, in screen pixels. */
export function rotateOffset(): number {
  return isCoarsePointer() ? ROTATE_REACH_COARSE : ROTATE_REACH_FINE;
}

/** Where the rotate handle sits, and the top-centre of the shape it hangs from, in world units. */
export function rotateHandlePlacement(
  el: SceneElement,
  zoomLevel: number
): { top: Point; out: Point } | null {
  const box = localBBox(el);
  if (!box) return null;
  const reach = rotateOffset() / zoomLevel;
  const cx = box.x + box.width / 2;
  return {
    top: toWorldPoint(el, { x: cx, y: box.y }),
    out: toWorldPoint(el, { x: cx, y: box.y - reach }),
  };
}

/** Where a rect's square handle sits, in the rect's own frame: outside its bottom-right corner. */
export function squareHandleLocal(el: RectElement, zoomLevel: number): Point {
  const off = cornerHandleInset() / zoomLevel;
  return { x: el.x + el.width + off, y: el.y + el.height + off };
}

/**
 * The handles that stand outside a shape's own outline (the rotate handle, a rect's square
 * handle), in world units and wherever the rotation has put them. Whatever floats beside the
 * selection has to keep clear of these, on whichever side they end up.
 */
export function outerHandlePoints(
  el: SceneElement,
  zoomLevel: number,
  rotatable: boolean
): Point[] {
  const points: Point[] = [];
  if (rotatable) {
    const place = rotateHandlePlacement(el, zoomLevel);
    if (place) points.push(place.out);
  }
  if (el.type === "rect") points.push(toWorldPoint(el, squareHandleLocal(el, zoomLevel)));
  const box = hasBoxHandles(el) ? elementBBox(el) : null;
  if (box) {
    const off = cornerHandleInset() / zoomLevel;
    points.push(
      { x: box.x - off, y: box.y - off },
      { x: box.x + box.width + off, y: box.y + box.height + off }
    );
  }
  return points;
}

/** Where a selection's own handles reach beyond its shapes, for the bar to keep clear of. */
export function selectionHandlePoints(sel: readonly SceneElement[], zoomLevel: number): Point[] {
  const box = sel.length > 1 ? unionBox(sel) : null;
  if (!box) return [];
  const off = cornerHandleInset() / zoomLevel;
  return [
    { x: box.x - off, y: box.y - rotateOffset() / zoomLevel },
    { x: box.x + box.width + off, y: box.y + box.height + off },
  ];
}
