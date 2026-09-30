import { afterAll, afterEach, expect, test } from "bun:test";
import { createPinch } from "./pinch.js";
import {
  hasActivePointers,
  initPointerTracking,
  subscribePointerActivity,
  touchesOn,
} from "./pointer.js";
import { createRect } from "./model.js";
import {
  createInitialState,
  getState,
  getDocumentRevision,
  replaceState,
  selectOnly,
} from "./state.js";
import { clearHistory, undo } from "./undo.js";
import { initViewport } from "./viewport.js";

initPointerTracking();
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
document.body.append(svg);
// Identity screen transform: tests exercise the gesture math, not browser SVG matrices.
svg.createSVGPoint = () => ({ x: 0, y: 0 }) as DOMPoint;
svg.getScreenCTM = () => null;
initViewport(svg, document.createElementNS(svg.namespaceURI, "g") as SVGGElement);
afterAll(() => svg.remove());

function pointer(type: string, id: number, x = 0, y = 0, target: Element = svg): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
    })
  );
}

afterEach(() => {
  window.dispatchEvent(new Event("blur"));
  clearHistory();
  replaceState(createInitialState());
});

test("multiple pointers stay busy until cancelled or released, including lost capture and blur", () => {
  const busy: boolean[] = [];
  const unsubscribe = subscribePointerActivity(() => busy.push(hasActivePointers()));
  pointer("pointerdown", 1);
  pointer("pointerdown", 2);
  pointer("pointercancel", 1);
  expect(hasActivePointers()).toBe(true);
  pointer("lostpointercapture", 2);
  expect(hasActivePointers()).toBe(false);
  pointer("pointerdown", 3);
  window.dispatchEvent(new Event("blur"));
  expect(busy).toEqual([true, true, true, false, true, false]);
  unsubscribe();
});

test("pinch uses pointer origins after overlay replacement and never resumes the remaining finger's drag", () => {
  replaceState({ ...createInitialState(), viewport: { panX: 0, panY: 0, zoom: 1 } });
  const revision = getDocumentRevision();
  const pinch = createPinch(svg);
  const overlay = document.createElementNS(svg.namespaceURI, "circle");
  svg.append(overlay);
  pointer("pointerdown", 1, 0, 0, overlay);
  expect(pinch.start()).toBe(false);
  overlay.remove();
  pointer("pointerdown", 2, 100, 0);
  expect(touchesOn(svg)).toHaveLength(2);
  expect(pinch.start()).toBe(true);
  pointer("pointermove", 2, 200, 0);
  expect(pinch.move()).toBe(true);
  expect(getState().viewport).toEqual({ panX: -50, panY: 0, zoom: 2 });
  expect(getDocumentRevision()).toBe(revision);
  pointer("pointercancel", 2);
  expect(pinch.end()).toBe(true);
  pointer("pointermove", 1, 40, 40);
  expect(pinch.move()).toBe(true);
  expect(getState().viewport.zoom).toBe(2);
  pointer("pointerup", 1);
  expect(pinch.end()).toBe(true);
  expect(pinch.move()).toBe(false);
});

test("two-finger rotation spends one document undo step and keeps the viewport on undo", () => {
  const rect = createRect(0, 0, 40, 40);
  replaceState({ ...createInitialState(), elements: [rect], selection: selectOnly([rect.id]) });
  const pinch = createPinch(svg);
  pointer("pointerdown", 1);
  pointer("pointerdown", 2, 100, 0);
  pinch.start();
  pointer("pointermove", 2, 100, 5);
  pinch.move();
  expect(getState().elements[0]!.rotation ?? 0).toBe(0);
  pointer("pointermove", 2, 100, 50);
  pinch.move();
  pointer("pointermove", 2, 100, 70);
  pinch.move();
  expect(getState().elements[0]!.rotation).toBeGreaterThan(20);
  const viewport = getState().viewport;
  expect(undo()).toBe(true);
  expect(getState().elements[0]!.rotation ?? 0).toBe(0);
  expect(getState().viewport).toBe(viewport);
  expect(undo()).toBe(false);
});
