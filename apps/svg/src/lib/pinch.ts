import { getState, replaceElements, selectedElements, setState } from "./state.js";
import { touchesOn } from "./pointer.js";
import { clampZoom, zoomAt } from "./viewport.js";
import { pushUndo } from "./undo.js";
import { elementBBox, magnetTurn, rotateElementCopy } from "./model.js";
import type { Point, SceneElement, Viewport } from "./types.js";

/** Below this much turn, two fingers are panning and zooming rather than rotating. */
const ROTATE_START_RAD = 0.12;

function touchDist(t0: Point, t1: Point): number {
  return Math.hypot(t1.x - t0.x, t1.y - t0.y);
}

function touchCenter(t0: Point, t1: Point): Point {
  return { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
}

function touchAngle(t0: Point, t1: Point): number {
  return Math.atan2(t1.y - t0.y, t1.x - t0.x);
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
export function createPinch(svg: SVGSVGElement) {
  let active = false;
  let pinchStartDist: number | null = null;
  let pinchStartZoom = 1;
  let lastCenter: Point | null = null;
  // Two fingers over a single selected shape turn it; the twist has to pass a threshold first
  // so that an ordinary pinch to zoom does not nudge the shape round with it.
  let twist: { id: string; base: SceneElement; cx: number; cy: number; start: number } | null =
    null;
  let twisting = false;

  function reset(): void {
    pinchStartDist = null;
    lastCenter = null;
    twist = null;
    twisting = false;
  }
  return {
    start(): boolean {
      const touches = touchesOn(svg);
      const [t0, t1] = touches;
      if (touches.length === 2 && t0 && t1) {
        active = true;
        pinchStartDist = Math.max(1, touchDist(t0, t1));
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
      }
      return active;
    },
    move(): boolean {
      if (!active) return false;
      const touches = touchesOn(svg);
      const [t0, t1] = touches;
      if (touches.length !== 2 || pinchStartDist === null || !t0 || !t1) return true;
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

      return true;
    },
    end(): boolean {
      const wasActive = active;
      if (touchesOn(svg).length < 2) reset();
      // Lifting one finger ends the pinch, but must not restart its interrupted drag.
      if (touchesOn(svg).length === 0) active = false;
      return wasActive;
    },
    cancel(): void {
      active = false;
      reset();
    },
  };
}
