import {
  getState,
  setState,
  mutate,
  replaceElements,
  findElement,
  selectOnly,
  selectedElements,
  clearDrawing,
} from "./state.js";
import {
  createPath,
  createPoint,
  elementBBox,
  translateElement,
  collectAlignPoints,
  alignToPoints,
  mirrorHandle,
  nearestOnElement,
  insertPointAt,
  createText,
  type AlignOptions,
  magnetTurn,
} from "./model.js";
import { screenToWorld, zoomAt } from "./viewport.js";
import { dist } from "./utils.js";
import { pushUndo } from "./undo.js";
import { addTurn, isAlignSnap, isSelectMore } from "./session.js";
import {
  type Anchor,
  type EditorState,
  type Marquee,
  type PathElement,
  type Point,
  type PointRef,
  type SceneElement,
} from "./types.js";
import { closeAndFinishPath, endPath, finishPath } from "./pen-commands.js";
import {
  endDropTarget,
  mergeDroppedEnd,
  removePointHandle,
  togglePointCurve,
} from "./selection-commands.js";
import { applyResize, pointIndexForRole } from "./resize.js";
import { boxCorners, rotateAll, scaleAllByCorner, unionBox } from "./selection-transform.js";
import { SELECTION_HANDLE_ID } from "./render.js";
import { snapFeatures } from "./boolean.js";
import { boxToGuides, movedGuide, nearestGuide, withGuide, type GuideAxis } from "./guides.js";
import {
  byShape,
  isPicked,
  movePoints,
  onePoint,
  pickedPoints,
  pickPoints,
  pointsInMarquee,
  togglePoint,
} from "./points.js";
import { clickTarget, drillTarget, expandToGroups } from "./groups.js";
import { beginTextEdit } from "./textedit.js";
import {
  type ShapeTool,
  updatePenPreview,
  updateShapePreview,
  finalizeShape,
} from "./shape-tools.js";

const CLOSE_TOL = 12;
const ALIGN_TOL_PX = 6;
type DragState =
  | { type: "pan"; startX: number; startY: number; panX: number; panY: number }
  | ({ type: "marquee" } & Marquee)
  | { type: "move-elements"; start: Point; ids: string[]; bases: Record<string, SceneElement> }
  | {
      type: "handle";
      pathId: string;
      index: number;
      kind: HandleKind;
      otherStart: Point | null;
      /** Whether the handles were linked when the drag began: a cusp stays one. */
      linked: boolean;
      last: Point | null;
    }
  | { type: "pen-handle"; pathId: string; index: number }
  | {
      type: "resize";
      elementId: string;
      role: string;
      base: SceneElement;
      /** Handle centre minus pointer at the press: see `grabOffset`. */
      grab: Point;
    }
  | {
      /** A turn from a rotate handle: one shape's, or the one on the box a selection shares. */
      type: "rotate";
      /** Whose handle: the shape's id, or `SELECTION_HANDLE_ID`. */
      handleId: string;
      bases: SceneElement[];
      cx: number;
      cy: number;
      /** The angle the shape already has, for the magnet; 0 for a selection, which has none. */
      startDeg: number;
      startAngle: number;
      radius: number;
      active: boolean;
      /** How far it has turned so far, in degrees. */
      degrees: number;
    }
  | { type: "shape-drag"; tool: ShapeTool; start: Point; current: Point }
  | { type: "guide"; axis: GuideAxis; index: number }
  | {
      /** Several picked points, moved together. */
      type: "points";
      start: Point;
      refs: PointRef[];
      bases: Map<string, SceneElement>;
    }
  | {
      /** A corner of the box several selected shapes share. */
      type: "sel-scale";
      role: string;
      bases: SceneElement[];
      grab: Point;
    };

function hitElement(target: EventTarget | null): string | null {
  let node = target as Node | null;
  while (node && node !== document) {
    const id = (node as Element).getAttribute?.("data-element-id");
    if (id) return id;
    node = node.parentNode;
  }
  return null;
}

/** What a point handle on the canvas is: the anchor itself, or one of its curve handles. */
type HandleKind = "anchor" | "in" | "out";

function hitHandle(target: Element): { pathId: string; index: number; kind: HandleKind } | null {
  const kind = target.getAttribute("data-handle-kind");
  const pathId = target.getAttribute("data-path-id");
  if ((kind !== "anchor" && kind !== "in" && kind !== "out") || !pathId) return null;
  return { pathId, index: parseInt(target.getAttribute("data-point-index") ?? "0", 10), kind };
}

function elementsInMarquee(m: Marquee): string[] {
  const x1 = Math.min(m.x1, m.x2);
  const y1 = Math.min(m.y1, m.y2);
  const x2 = Math.max(m.x1, m.x2);
  const y2 = Math.max(m.y1, m.y2);
  const ids: string[] = [];
  for (const el of getState().elements) {
    if (el.hidden || el.locked) continue;
    const box = elementBBox(el);
    if (!box) continue;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) ids.push(el.id);
  }
  return ids;
}

/** How long a finger must rest on empty canvas before the drag becomes a marquee. */
const HOLD_MS = 450;

/** How far a pointer must travel before a press counts as a drag, in screen pixels. */
function dragSlop(e: PointerEvent): number {
  if (e.pointerType === "touch") return 10;
  return e.pointerType === "pen" ? 6 : 4;
}

/** A press that becomes a drag if the pointer moves far enough, and stays a click if not. */
interface PendingDrag {
  drag: DragState;
  x: number;
  y: number;
  slop: number;
  undo: boolean;
  grab: boolean;
}

/** How close, in screen pixels, a dropped end has to be to another end to merge with it. */
const MERGE_REACH = 8;

/** Rings the end that the dragged point would merge with if it were dropped now, if any. */
function showDropTarget(elementId: string, index: number | null): void {
  const el = index != null ? findElement(elementId) : undefined;
  const hit =
    el && index != null ? endDropTarget(el, index, MERGE_REACH / getState().viewport.zoom) : null;
  const prev = getState().dropTarget;
  const next = hit?.point ?? null;
  if (prev?.x === next?.x && prev?.y === next?.y) return;
  setState({ dropTarget: next });
}

/**
 * Rings the first point of the path being drawn while a click would close onto it: the same
 * ring a dragged end shows over the end it would merge with, since both close the shape.
 */
function showPenCloseTarget(path: PathElement, world: Point): void {
  const first = path.points[0]!;
  const closes =
    path.points.length >= 2 && dist(world, first) <= CLOSE_TOL / getState().viewport.zoom;
  const next = closes ? { x: first.x, y: first.y } : null;
  const prev = getState().dropTarget;
  if (prev?.x === next?.x && prev?.y === next?.y) return;
  setState({ dropTarget: next });
}

/** Whether a press or release is over the ruler a guide on `axis` comes out of. */
function overRuler(axis: GuideAxis, e: PointerEvent): boolean {
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
function guideAt(
  axis: GuideAxis,
  raw: number,
  e: PointerEvent,
  points: (s: EditorState) => readonly Point[]
): number {
  const s = getState();
  if (isAlignSnap() || e.altKey) {
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

/** The canvas and its wrapper, set once by `bindInteraction`. */
let svg: SVGSVGElement;
let wrap: HTMLElement;

let drag: DragState | null = null;

let pending: PendingDrag | null = null;

let holdTimer = 0;

let lastDown = { t: 0, x: 0, y: 0 };

/** The selected shape pressed, while that press may still turn out to be a click. */
let drillId: string | null = null;

/** A picked point pressed among several, while that press may still turn out to be a click. */
let pointClick: PointRef | null = null;

/** Empty canvas pressed with a point picked: a marquee picks points, a click lets go of them. */
let pointMarquee = false;

function cancelHold(): void {
  if (holdTimer) window.clearTimeout(holdTimer);
  holdTimer = 0;
}

/**
 * Arms a drag instead of starting one. Tapping a shape to select it, or a point to pick it,
 * must not move anything and must not spend an undo step; both happen only once the pointer
 * really travels, which matters most on a touch screen where every tap wobbles a few pixels.
 */
function arm(e: PointerEvent, next: DragState, { undo = true, grab = true } = {}): void {
  pending = { drag: next, x: e.clientX, y: e.clientY, slop: dragSlop(e), undo, grab };
}

/** True once the armed drag has started, or when there was none waiting. */
function releaseArmed(e: PointerEvent): boolean {
  if (!pending) return true;
  if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < pending.slop) return false;
  cancelHold();
  if (pending.undo) pushUndo();
  drag = pending.drag;
  if (pending.grab) wrap.classList.add("grabbing");
  pending = null;
  return true;
}

function alignExcludes(): AlignOptions {
  if (!drag) return {};
  if (drag.type === "move-elements") return { excludeElementIds: new Set(drag.ids) };
  if (drag.type === "resize") return { excludeElementIds: new Set([drag.elementId]) };
  if (drag.type === "sel-scale") return { excludeElementIds: new Set(drag.bases.map((b) => b.id)) };
  if (drag.type === "points") return { excludeElementIds: new Set(drag.bases.keys()) };
  if (drag.type === "handle" || drag.type === "pen-handle") {
    return { excludePoint: { elementId: drag.pathId, index: drag.index } };
  }
  return {};
}

/**
 * Where the handle is relative to where you pressed.
 *
 * A handle's target is far wider than the dot - 22px across on a mouse, 44 on a finger. Read
 * from the bare pointer, a press anywhere but the exact centre would jump the shape by the
 * difference, and on the corner-radius handle, which clamps at zero, a press on the outer half
 * would have to be dragged all the way back before anything moved.
 */
function grabOffset(handle: Element, world: Point): Point {
  const cx = Number(handle.getAttribute("cx"));
  const cy = Number(handle.getAttribute("cy"));
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { x: 0, y: 0 };
  return { x: cx - world.x, y: cy - world.y };
}

/**
 * A box handle stands off its corner, so the drag works from the corner itself: the offset
 * from the pointer to the bounding box's corner, not to the handle.
 */
function boxGrab(el: SceneElement, role: string, world: Point): Point {
  const box = elementBBox(el);
  if (!box) return { x: 0, y: 0 };
  const { corner } = boxCorners(box, role);
  return { x: corner.x - world.x, y: corner.y - world.y };
}

/**
 * A linked pair mirrors; Alt holds the partner still and leaves the point a cusp. A cusp's
 * handles move on their own with or without Alt - it is linked again from the bar beside the
 * point, which is the same on every pointer, rather than by a drag that happens to lack a key.
 */
function applyHandleDrag(p: Anchor, world: Point, alt: boolean): void {
  if (drag?.type !== "handle") return;
  const key = drag.kind === "out" ? "hOut" : "hIn";
  const otherKey = drag.kind === "out" ? "hIn" : "hOut";
  p[key] = { x: world.x, y: world.y };
  if (!drag.otherStart) return;
  const mirror = drag.linked && !alt;
  p.smooth = mirror;
  p[otherKey] = mirror ? mirrorHandle(p, p[key]!) : { ...drag.otherStart };
}

function onAltKey(e: KeyboardEvent): void {
  if (e.key !== "Alt" || drag?.type !== "handle" || drag.kind === "anchor" || !drag.last) return;
  e.preventDefault();
  const path = findElement(drag.pathId);
  const last = drag.last;
  const index = drag.index;
  if (path?.type !== "path") return;
  const p = path.points[index];
  if (!p) return;
  mutate(() => applyHandleDrag(p, last, e.type === "keydown"));
}

/**
 * Segment midpoints and crossings to snap to, worked out once per gesture: a drag changes only
 * what it moves, and that is left out of them.
 */
let featureCache: { elements: readonly SceneElement[]; key: string; points: Point[] } | null = null;

function features(s: EditorState): Point[] {
  const ex = alignExcludes();
  const ids = new Set(ex.excludeElementIds ?? []);
  if (ex.excludePoint) ids.add(ex.excludePoint.elementId);
  const key = [...ids].sort().join(",");
  if (featureCache?.elements !== s.elements || featureCache.key !== key) {
    featureCache = { elements: s.elements, key, points: snapFeatures(s.elements, ids) };
  }
  return featureCache.points;
}

function pointerWorld(e: PointerEvent): Point {
  const p = screenToWorld(e.clientX, e.clientY);
  const s = getState();
  // A box handle stands off the corner it drags, so the corner is what snaps and aligns:
  // everything below works on it, and the pointer is given back at the same offset.
  const g =
    (drag?.type === "resize" && drag.role.startsWith("box-")) || drag?.type === "sel-scale"
      ? drag.grab
      : { x: 0, y: 0 };
  const w = { x: p.x + g.x, y: p.y + g.y };
  // While dragging a curve handle, Alt breaks its symmetry instead of aligning. The align
  // switch has no second meaning to give way to, so it aligns whatever is being dragged.
  const alignOn =
    isAlignSnap() ||
    (e.altKey &&
      !(drag?.type === "handle" && drag.kind !== "anchor") &&
      !(drag?.type === "resize" && drag.role === "corner"));
  let x = w.x;
  let y = w.y;
  let guideX: number | null = null;
  let guideY: number | null = null;
  if (alignOn) {
    const tol = ALIGN_TOL_PX / s.viewport.zoom;
    const candidates = [...collectAlignPoints(s.elements, alignExcludes()), ...features(s)];
    const aligned = alignToPoints(w, candidates, tol);
    ({ x, y, guideX, guideY } = aligned);
  }
  const snapOn =
    !alignOn &&
    s.grid.snap &&
    (s.tool !== "select" || drag?.type === "handle" || drag?.type === "resize");
  if (snapOn) {
    const step = Math.max(1, s.grid.step);
    x = Math.round(x / step) * step;
    y = Math.round(y / step) * step;
  }
  // A guide in reach wins over the grid and over other shapes: it was put there to be used.
  if ((alignOn || snapOn) && drag?.type !== "guide") {
    const tol = ALIGN_TOL_PX / s.viewport.zoom;
    const gx = nearestGuide(w.x, s.guides.x, tol);
    const gy = nearestGuide(w.y, s.guides.y, tol);
    if (gx != null) x = gx;
    if (gy != null) y = gy;
  }
  setState({
    cursor: { x: p.x, y: p.y, snapX: x, snapY: y, snapActive: alignOn || snapOn },
    align: { x: guideX, y: guideY },
  });
  return { x: x - g.x, y: y - g.y };
}

function startPan(e: PointerEvent): void {
  const { panX, panY } = getState().viewport;
  drag = { type: "pan", startX: e.clientX, startY: e.clientY, panX, panY };
  wrap.classList.add("panning");
}

function onPointerDown(e: PointerEvent): void {
  if (e.button === 1) {
    startPan(e);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  featureCache = null;
  drillId = null;
  pointClick = null;
  pointMarquee = false;
  svg.setPointerCapture(e.pointerId);
  const st = getState();
  const world = pointerWorld(e);

  // Manual double-click detection: the overlay is re-rendered on every state change, so the
  // browser's own click/dblclick events are unreliable for anything drawn there.
  const nowMs = performance.now();
  const isDouble =
    nowMs - lastDown.t < 400 &&
    Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) <
      (e.pointerType === "touch" ? 24 : 6);
  lastDown = { t: isDouble ? 0 : nowMs, x: e.clientX, y: e.clientY };

  if (st.spacePan) {
    startPan(e);
    return;
  }

  // A guide, with the select tool: dragged to move it, dropped on its ruler or double-clicked
  // to take it away.
  const guideHit = (e.target as Element).closest?.("[data-guide-axis]");
  if (guideHit && st.tool === "select") {
    const axis = guideHit.getAttribute("data-guide-axis") as GuideAxis;
    const index = Number(guideHit.getAttribute("data-guide-index"));
    if (isDouble) {
      pushUndo();
      setState((s) => ({ ...s, guides: movedGuide(s.guides, axis, index, null) }));
      return;
    }
    arm(e, { type: "guide", axis, index });
    return;
  }

  const target = e.target as Element;
  const handle = target.closest?.("[data-handle-kind]");
  if (handle) {
    const h = hitHandle(handle);
    const path = h ? findElement(h.pathId) : undefined;
    // The pen keeps its own meaning for the path it is drawing: clicking the first anchor
    // closes it, clicking elsewhere adds a point. Any other path's handles are editable.
    const penOwns = st.tool === "pen" && h?.pathId === st.drawing?.activePathId;
    if (h && path?.type === "path" && !penOwns) {
      // Double-clicking a point makes it a curve or a corner; a curve handle, takes it off.
      if (isDouble) {
        if (h.kind === "anchor") togglePointCurve(h.pathId, h.index);
        else removePointHandle(h.pathId, h.index, h.kind);
        drag = null;
        return;
      }
      if (h.kind === "anchor" && pointGesture(e, st, { pathId: h.pathId, index: h.index }, world)) {
        return;
      }
      const p = path.points[h.index];
      const other = h.kind === "out" ? p?.hIn : h.kind === "in" ? p?.hOut : null;
      arm(e, {
        type: "handle",
        ...h,
        otherStart: other ? { x: other.x, y: other.y } : null,
        linked: !!p?.smooth,
        last: null,
      });
      // A handle belongs to its anchor, so grabbing one selects that point: the bar beside it
      // then offers to link or break the pair, which is how touch gets at a cusp, or to
      // remove the handle grabbed.
      setState({
        selection: onePoint(getState().selection, {
          pathId: h.pathId,
          index: h.index,
          ...(h.kind === "in" || h.kind === "out" ? { handle: h.kind } : {}),
        }),
      });
      return;
    }
  }

  const selHandle = target.closest?.("[data-selection-handle]");
  if (selHandle) {
    startSelectionDrag(e, selHandle.getAttribute("data-handle-role") ?? "", world);
    return;
  }

  const resizeHandle = target.closest?.("[data-handle-role]");
  const resizeTarget = resizeHandle
    ? findElement(resizeHandle.getAttribute("data-element-id"))
    : undefined;
  if (resizeHandle && resizeTarget) {
    const elementId = resizeTarget.id;
    const role = resizeHandle.getAttribute("data-handle-role") ?? "";
    if (role === "rotate") {
      const base = structuredClone(resizeTarget);
      startRotate(e, base.id, [base], base.rotation ?? 0, world);
      return;
    }
    const ptIndex = pointIndexForRole(role);
    if (
      !isDouble &&
      ptIndex != null &&
      pointGesture(e, st, { pathId: elementId, index: ptIndex }, world)
    ) {
      return;
    }
    if (isDouble && ptIndex != null) {
      togglePointCurve(elementId, ptIndex);
      drag = null;
      return;
    }
    arm(e, {
      type: "resize",
      elementId,
      role,
      base: structuredClone(resizeTarget),
      grab: role.startsWith("box-")
        ? boxGrab(resizeTarget, role, world)
        : grabOffset(resizeHandle, world),
    });
    setState({
      selection:
        ptIndex != null
          ? onePoint(getState().selection, { pathId: elementId, index: ptIndex })
          : selectOnly([elementId]),
    });
    return;
  }

  if (st.tool === "select") {
    const elId = hitElement(e.target);
    const el = findElement(elId);
    if (elId && el) {
      if (isDouble && handleDoubleClickOnShape(el, world, st)) {
        drag = null;
        return;
      }
      const additive = e.shiftKey || isSelectMore();
      const wasSelected = st.selection.elementIds.includes(elId);
      const members = clickTarget(st.elements, new Set(st.selection.elementIds), elId).ids;
      // Pressing a shape already selected keeps the selection, so it can be dragged; if the
      // press turns out to be a click, it steps into the group instead (see pointerup).
      drillId = !additive && wasSelected ? elId : null;
      setState((s) => {
        let ids = s.selection.elementIds;
        if (additive) {
          ids = members.every((m) => ids.includes(m))
            ? ids.filter((x) => !members.includes(x))
            : [...new Set([...ids, ...members])];
        } else if (!ids.includes(elId)) {
          ids = members;
        }
        return { ...s, selection: selectOnly(ids) };
      });
      // A locked shape selected from its row stays put while the others are dragged.
      const ids = getState().selection.elementIds.filter((id) => !findElement(id)?.locked);
      const bases: Record<string, SceneElement> = {};
      for (const id of ids) {
        const found = findElement(id);
        if (found) bases[id] = structuredClone(found);
      }
      arm(e, { type: "move-elements", start: world, ids, bases });
      return;
    }
    const marquee: DragState = {
      type: "marquee",
      x1: world.x,
      y1: world.y,
      x2: world.x,
      y2: world.y,
    };
    if (e.pointerType === "touch") {
      // One finger on empty canvas pans, which is what a hand tool was for. Holding still
      // for a moment switches to a marquee, so box-selection is reachable without one.
      const { panX, panY } = getState().viewport;
      arm(
        e,
        { type: "pan", startX: e.clientX, startY: e.clientY, panX, panY },
        { undo: false, grab: false }
      );
      holdTimer = window.setTimeout(() => {
        if (pending?.drag.type !== "pan") return;
        pending = { ...pending, drag: marquee };
        setState({ drawing: { marquee: { x1: world.x, y1: world.y, x2: world.x, y2: world.y } } });
      }, HOLD_MS);
    } else {
      arm(e, marquee, { undo: false, grab: false });
    }
    pointMarquee = !!st.selection.pathEdit;
    if (!e.shiftKey && !isSelectMore() && !pointMarquee) setState({ selection: selectOnly() });
    return;
  }

  if (st.tool === "pen") {
    handlePenDown(world, isDouble);
    return;
  }

  if (st.tool === "text") {
    // Empty, not "Text": the in-place field opens straight away, and tapping away without
    // typing anything leaves nothing behind rather than the word "Text".
    const el = createText(world.x, world.y, "");
    pushUndo();
    setState((s) => ({
      ...s,
      elements: [...s.elements, el],
      selection: selectOnly([el.id]),
      ui: { ...s.ui, expandedElementId: el.id },
      tool: "select",
      drawing: null,
    }));
    beginTextEdit(el.id);
    return;
  }

  if (st.tool === "rect" || st.tool === "ellipse") {
    handleShapeDown(st.tool, world, e);
  }
}

/** Double-click on a shape: edit text, or insert a vertex on the segment under the cursor. */
function handleDoubleClickOnShape(el: SceneElement, world: Point, st: EditorState): boolean {
  if (el.type === "text") {
    beginTextEdit(el.id);
    return true;
  }
  if (!["path", "line", "polyline", "polygon"].includes(el.type)) return false;
  const hit = nearestOnElement(el, world);
  if (!hit || hit.dist > Math.max(8 / st.viewport.zoom, el.strokeWidth)) return false;
  pushUndo();
  replaceElements([insertPointAt(el, hit.index, hit.t)], { selection: selectOnly([el.id]) });
  return true;
}

/** Arms a stretch or a turn of every selected shape at once, from their shared box's handles. */
function startSelectionDrag(e: PointerEvent, role: string, world: Point): void {
  const bases = selectedElements().map((el) => structuredClone(el));
  const box = unionBox(bases);
  if (!box) return;
  if (role === "rotate") {
    startRotate(e, SELECTION_HANDLE_ID, bases, 0, world);
    return;
  }
  const { corner } = boxCorners(box, role);
  arm(e, {
    type: "sel-scale",
    role,
    bases,
    grab: { x: corner.x - world.x, y: corner.y - world.y },
  });
}

/**
 * A press on a point that picks several: with Shift (or the add switch), and a point already
 * picked, it adds this one or takes it out; on one of several picked, it arms a drag of them
 * all, and a click narrows the pick to it. False leaves the press to pick the point alone.
 */
function pointGesture(e: PointerEvent, st: EditorState, ref: PointRef, world: Point): boolean {
  const sel = st.selection;
  const additive = e.shiftKey || isSelectMore();
  if (additive && sel.pathEdit && sel.elementIds.includes(ref.pathId)) {
    setState({ selection: togglePoint(sel, ref) });
    return true;
  }
  const picked = pickedPoints(sel);
  if (picked.length < 2 || !isPicked(sel, ref)) return false;
  const bases = new Map<string, SceneElement>();
  for (const id of byShape(picked).keys()) {
    const el = findElement(id);
    if (el) bases.set(id, structuredClone(el));
  }
  arm(e, { type: "points", start: world, refs: picked, bases });
  pointClick = ref;
  return true;
}

/** Arms a turn of `bases` about the centre of their box, from the handle `handleId`. */
function startRotate(
  e: PointerEvent,
  handleId: string,
  bases: SceneElement[],
  startDeg: number,
  world: Point
): void {
  const box = unionBox(bases);
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  arm(e, {
    type: "rotate",
    handleId,
    bases,
    cx,
    cy,
    startDeg,
    startAngle: Math.atan2(world.y - cy, world.x - cx),
    radius: Math.max(20, Math.hypot(world.x - cx, world.y - cy)),
    active: false,
    degrees: 0,
  });
}

/**
 * The pen: a press adds a point, a press on the first point closes the path, and the second press
 * of a double-click or double-tap finishes it - the first already placed the last point.
 */
function handlePenDown(world: Point, isDouble: boolean): void {
  if (isDouble) {
    finishPath();
    return;
  }
  const st = getState();
  const active = findElement(st.drawing?.activePathId);
  if (active?.type === "path") {
    const first = active.points[0];
    if (first && active.points.length >= 2 && dist(world, first) <= CLOSE_TOL / st.viewport.zoom) {
      closeAndFinishPath();
      return;
    }
  }
  pushUndo();
  const point = createPoint(world.x, world.y, false);
  let path: PathElement;
  if (active?.type === "path") {
    path = active;
    mutate(() => path.points.push(point));
  } else {
    path = createPath([point]);
    setState((s) => ({
      ...s,
      elements: [...s.elements, path],
      drawing: { activePathId: path.id, preview: null },
    }));
  }
  drag = { type: "pen-handle", pathId: path.id, index: path.points.length - 1 };
}

function handleShapeDown(tool: ShapeTool, world: Point, e: PointerEvent): void {
  const st = getState();
  if (st.drawing?.shapeStart) {
    finalizeShape(tool, st.drawing.shapeStart, world, e.shiftKey);
    clearDrawing();
    drag = null;
    return;
  }
  drag = { type: "shape-drag", tool, start: world, current: world };
  updateShapePreview(tool, world, world, e.shiftKey);
}

function onPointerMove(e: PointerEvent): void {
  if (!releaseArmed(e)) return;
  const world = pointerWorld(e);
  const st = getState();

  if (drag?.type === "pan") {
    const d = drag;
    setState((s) => ({
      ...s,
      viewport: {
        ...s.viewport,
        panX: d.panX + (e.clientX - d.startX),
        panY: d.panY + (e.clientY - d.startY),
      },
    }));
    return;
  }

  if (!drag) {
    const target = e.target as Element;
    const overHandle = !!target.closest?.("[data-handle-kind], [data-handle-role]");
    const hoverId = overHandle || st.tool !== "select" ? null : hitElement(e.target);
    wrap.classList.toggle("hover-target", overHandle || !!hoverId);
    if (getState().hoverId !== hoverId) setState({ hoverId });
  } else if (getState().hoverId) {
    setState({ hoverId: null });
  }

  if (drag?.type === "marquee") {
    drag.x2 = world.x;
    drag.y2 = world.y;
    setState({ drawing: { marquee: { x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 } } });
    return;
  }

  if (drag?.type === "move-elements") {
    const d = drag;
    let dx = world.x - d.start.x;
    let dy = world.y - d.start.y;
    if (st.grid.snap && !e.altKey && !isAlignSnap()) {
      // Snap the top-left of the first dragged shape to the grid.
      const firstBase = d.bases[d.ids[0] ?? ""];
      const first = firstBase ? elementBBox(firstBase) : null;
      if (first) {
        const step = Math.max(1, st.grid.step);
        dx = Math.round((first.x + dx) / step) * step - first.x;
        dy = Math.round((first.y + dy) / step) * step - first.y;
      }
    }
    // With snapping on, an edge or the centre of what is dragged lines up with a guide.
    if (st.grid.snap || e.altKey || isAlignSnap()) {
      const box = unionBox(Object.values(d.bases));
      if (box) {
        const fit = boxToGuides(
          { ...box, x: box.x + dx, y: box.y + dy },
          st.guides,
          ALIGN_TOL_PX / st.viewport.zoom
        );
        dx += fit.dx;
        dy += fit.dy;
      }
    }
    mutate(() => {
      for (const id of d.ids) {
        const el = findElement(id);
        const base = d.bases[id];
        if (!el || !base) continue;
        const copy = structuredClone(base);
        translateElement(copy, dx, dy);
        if (el.type === "path" && copy.type === "path") {
          el.points = copy.points;
          el.closed = copy.closed;
        } else {
          Object.assign(el, copy);
        }
      }
    });
    return;
  }

  if (drag?.type === "handle") {
    const d = drag;
    const path = findElement(d.pathId);
    if (path?.type !== "path") return;
    const p = path.points[d.index];
    if (!p) return;
    if (d.kind === "anchor") {
      const dx = world.x - p.x;
      const dy = world.y - p.y;
      mutate(() => {
        p.x = world.x;
        p.y = world.y;
        for (const h of [p.hIn, p.hOut]) {
          if (!h) continue;
          h.x += dx;
          h.y += dy;
        }
      });
    } else {
      d.last = world;
      mutate(() => applyHandleDrag(p, world, e.altKey));
    }
    setState({
      selection: onePoint(getState().selection, {
        pathId: d.pathId,
        index: d.index,
        ...(d.kind === "in" || d.kind === "out" ? { handle: d.kind } : {}),
      }),
    });
    showDropTarget(d.pathId, d.kind === "anchor" ? d.index : null);
    return;
  }

  if (drag?.type === "guide") {
    const d = drag;
    const raw = screenToWorld(e.clientX, e.clientY)[d.axis];
    const at = guideAt(d.axis, raw, e, (s) => [
      ...collectAlignPoints(s.elements, {}),
      ...features(s),
    ]);
    setState((s) => ({ ...s, guides: movedGuide(s.guides, d.axis, d.index, at) }));
    return;
  }

  if (drag?.type === "points") {
    const d = drag;
    replaceElements(movePoints(d.bases, d.refs, world.x - d.start.x, world.y - d.start.y));
    return;
  }

  if (drag?.type === "sel-scale") {
    const d = drag;
    const at = { x: world.x + d.grab.x, y: world.y + d.grab.y };
    replaceElements(scaleAllByCorner(d.bases, d.role, at, e.shiftKey));
    return;
  }

  if (drag?.type === "rotate") {
    const d = drag;
    let delta = Math.atan2(world.y - d.cy, world.x - d.cx) - d.startAngle;
    if (e.shiftKey) {
      const step = Math.PI / 12;
      delta = Math.round(delta / step) * step;
    } else if (e.pointerType !== "mouse") {
      delta = magnetTurn(delta, d.startDeg);
    }
    if (!d.active && Math.abs(delta) < 0.01) return;
    d.active = true;
    const a = d.startAngle + delta;
    d.degrees = (delta * 180) / Math.PI;
    replaceElements(rotateAll(d.bases, d.degrees, d.cx, d.cy), {
      drawing: {
        rotateHandle: {
          elementId: d.handleId,
          cx: d.cx,
          cy: d.cy,
          x: d.cx + Math.cos(a) * d.radius,
          y: d.cy + Math.sin(a) * d.radius,
        },
      },
    });
    return;
  }

  if (drag?.type === "resize") {
    const d = drag;
    const el = findElement(d.elementId);
    const at = { x: world.x + d.grab.x, y: world.y + d.grab.y };
    if (el) mutate(() => applyResize(el, d.role, at, d.base, e.altKey, e.shiftKey));
    showDropTarget(d.elementId, pointIndexForRole(d.role));
    return;
  }

  if (drag?.type === "pen-handle") {
    const d = drag;
    const path = findElement(d.pathId);
    if (path?.type !== "path") return;
    const p = path.points[d.index];
    if (p) {
      mutate(() => {
        p.smooth = true;
        p.hOut = { x: world.x, y: world.y };
        p.hIn = mirrorHandle(p, p.hOut);
      });
      updatePenPreview(path, world);
    }
    return;
  }

  if (drag?.type === "shape-drag") {
    drag.current = world;
    updateShapePreview(drag.tool, drag.start, world, e.shiftKey);
    return;
  }

  if (st.drawing?.activePathId) {
    const path = findElement(st.drawing.activePathId);
    if (path?.type === "path" && path.points.length) {
      updatePenPreview(path, world);
      showPenCloseTarget(path, world);
    }
  } else if (!drag && st.drawing?.shapeStart) {
    if (st.tool === "rect" || st.tool === "ellipse") {
      updateShapePreview(st.tool, st.drawing.shapeStart, world, e.shiftKey);
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  wrap.classList.remove("panning", "grabbing");
  // A press that never passed the slop threshold was a click: the selection it made stands,
  // but nothing moved and no undo step was spent.
  const heldMarquee = pending?.drag.type === "marquee";
  const clickedSelected = pending?.drag.type === "move-elements" ? drillId : null;
  const clickedPoint = pending?.drag.type === "points" ? pointClick : null;
  const clickedEmpty =
    pointMarquee && !!pending && (pending.drag.type === "marquee" || pending.drag.type === "pan");
  pending = null;
  drillId = null;
  pointClick = null;
  if (clickedPoint) {
    setState({
      selection: onePoint(getState().selection, {
        pathId: clickedPoint.pathId,
        index: clickedPoint.index,
      }),
    });
  }
  if (clickedEmpty && !e.shiftKey && !isSelectMore()) setState({ selection: selectOnly() });
  if (clickedSelected) {
    const s = getState();
    const inner = drillTarget(s.elements, new Set(s.selection.elementIds), clickedSelected);
    if (inner) setState({ selection: selectOnly(inner.ids) });
  }
  cancelHold();
  if (heldMarquee) clearDrawing();
  if (drag?.type === "pan") {
    drag = null;
    return;
  }
  const world = pointerWorld(e);
  const st = getState();
  setState({ align: { x: null, y: null }, dropTarget: null });

  if (drag?.type === "marquee") {
    // With a point picked, a marquee picks the points inside it, on the shapes selected; when
    // it holds none, it selects shapes as usual.
    const s0 = getState();
    const refs = pointMarquee
      ? pointsInMarquee(s0.elements, new Set(s0.selection.elementIds), drag)
      : [];
    if (refs.length) {
      const additive = e.shiftKey || isSelectMore();
      const next = additive ? [...pickedPoints(s0.selection), ...refs] : refs;
      setState({ selection: pickPoints(s0.selection, next) });
      clearDrawing();
      drag = null;
      return;
    }
    const ids = expandToGroups(s0.elements, elementsInMarquee(drag));
    setState((s) => ({
      ...s,
      selection: selectOnly(
        e.shiftKey || isSelectMore() ? [...new Set([...s.selection.elementIds, ...ids])] : ids
      ),
    }));
    clearDrawing();
    drag = null;
    return;
  }

  if (drag?.type === "handle" || drag?.type === "resize") {
    const d = drag;
    const idx =
      d.type === "handle" ? (d.kind === "anchor" ? d.index : null) : pointIndexForRole(d.role);
    const id = d.type === "handle" ? d.pathId : d.elementId;
    drag = null;
    const el = idx != null ? findElement(id) : undefined;
    if (el && idx != null) mergeDroppedEnd(el, idx, MERGE_REACH / st.viewport.zoom);
    return;
  }

  if (drag?.type === "guide") {
    const d = drag;
    drag = null;
    if (overRuler(d.axis, e)) {
      setState((s) => ({ ...s, guides: movedGuide(s.guides, d.axis, d.index, null) }));
    }
    return;
  }

  if (drag?.type === "rotate") {
    // A group's Rotate field counts what the handle turned, as it does what is typed there.
    if (drag.handleId === SELECTION_HANDLE_ID && drag.active) {
      addTurn(
        drag.bases.map((b) => b.id),
        drag.degrees
      );
    }
    drag = null;
    clearDrawing();
    return;
  }

  if (drag?.type === "shape-drag") {
    if (dist(drag.start, world) >= 3 / st.viewport.zoom) {
      finalizeShape(drag.tool, drag.start, world, e.shiftKey);
      clearDrawing();
    }
    // else: a plain click — leave drawing.shapeStart in place, waiting for a second click.
    drag = null;
    return;
  }

  drag = null;
}

export function bindInteraction(canvas: SVGSVGElement, canvasWrap: HTMLElement): void {
  svg = canvas;
  wrap = canvasWrap;
  window.addEventListener("keydown", onAltKey);
  window.addEventListener("keyup", onAltKey);

  // A second finger means pinch/pan: drop whatever one-finger drag had started.
  svg.addEventListener("pinch-start", () => {
    pending = null;
    cancelHold();
    if (drag && drag.type !== "pan") {
      drag = null;
      wrap.classList.remove("grabbing");
      clearDrawing();
      setState({ dropTarget: null });
    }
  });

  svg.addEventListener("pointerleave", () => {
    wrap.classList.remove("hover-target");
    setState((s) => ({
      ...s,
      hoverId: null,
      cursor: { ...s.cursor, snapActive: false },
      align: { x: null, y: null },
    }));
  });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 400;
      setState({ viewport: zoomAt(e.clientX, e.clientY, Math.exp(-delta * 0.002)) });
    },
    { passive: false }
  );
}

export function cancelOperation(): void {
  const st = getState();
  if (st.drawing?.activePathId && !st.drawing.shapeStart) endPath();
  clearDrawing();
}
