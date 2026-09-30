import { getState, replaceElements, selectedElements, setState } from "./state.js";
import { clampZoom, zoomAt } from "./viewport.js";
import { pushUndo } from "./undo.js";
import { elementBBox, magnetTurn, rotateElementCopy } from "./model.js";
import type { Point, SceneElement, Viewport } from "./types.js";

/** Below this much turn, two fingers are panning and zooming rather than rotating. */
const ROTATE_START_RAD = 0.12;

function touchDist(t0: Touch, t1: Touch): number {
  return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
}

function touchCenter(t0: Touch, t1: Touch): Point {
  return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}

function touchAngle(t0: Touch, t1: Touch): number {
  return Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
}

/** The shape two fingers would turn: a single selection, and nothing being drawn. */
function rotatableSelection(): SceneElement | null {
  const st = getState();
  if (st.drawing?.activePathId || st.selection.elementIds.length !== 1) return null;
  const el = selectedElements()[0];
  return el && elementBBox(el) ? el : null;
}

/**
 * Pinch-zoom, two-finger pan and rotate, on touch devices. Everything done with one finger -
 * drawing, and a double-tap to finish a path - goes the same Pointer Events way as the mouse.
 */
export function bindTouch(svg: SVGSVGElement): void {
  let pinchStartDist: number | null = null;
  let pinchStartZoom = 1;
  let lastCenter: Point | null = null;
  // Two fingers over a single selected shape turn it; the twist has to pass a threshold first
  // so that an ordinary pinch to zoom does not nudge the shape round with it.
  let twist: { id: string; base: SceneElement; cx: number; cy: number; start: number } | null =
    null;
  let twisting = false;

  svg.addEventListener(
    "touchstart",
    (e) => {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault();
        pinchStartDist = touchDist(t0, t1);
        pinchStartZoom = getState().viewport.zoom;
        lastCenter = touchCenter(t0, t1);
        const target = rotatableSelection();
        const box = target ? elementBBox(target) : null;
        twist =
          target && box
            ? {
                id: target.id,
                base: structuredClone(target),
                cx: box.x + box.width / 2,
                cy: box.y + box.height / 2,
                start: touchAngle(t0, t1),
              }
            : null;
        twisting = false;
        svg.dispatchEvent(new Event("pinch-start"));
      }
    },
    { passive: false }
  );

  svg.addEventListener(
    "touchmove",
    (e) => {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      if (e.touches.length !== 2 || pinchStartDist == null || !t0 || !t1) return;
      e.preventDefault();
      const center = touchCenter(t0, t1);
      if (twist) {
        let delta = touchAngle(t0, t1) - twist.start;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        if (!twisting && Math.abs(delta) > ROTATE_START_RAD) {
          pushUndo();
          twisting = true;
        }
        if (twisting) {
          const d = twist;
          const rotated = rotateElementCopy(d.base, magnetTurn(delta, d.base.rotation), d.cx, d.cy);
          replaceElements([rotated]);
        }
      }
      const targetZoom = clampZoom(pinchStartZoom * (touchDist(t0, t1) / pinchStartDist));
      const current = getState().viewport.zoom;
      let viewport: Viewport = getState().viewport;
      if (Math.abs(targetZoom - current) > 0.0001) {
        viewport = zoomAt(center.x, center.y, targetZoom / current);
      }
      if (lastCenter) {
        viewport = {
          ...viewport,
          panX: viewport.panX + center.x - lastCenter.x,
          panY: viewport.panY + center.y - lastCenter.y,
        };
      }
      lastCenter = center;
      setState({ viewport });
    },
    { passive: false }
  );

  svg.addEventListener("touchend", (e) => {
    if (e.touches.length >= 2) return;
    pinchStartDist = null;
    twist = null;
    twisting = false;
  });
}
