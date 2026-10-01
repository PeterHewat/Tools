import { completeStyle, styleOf } from "./element-style.js";
export {
  DEFAULT_STROKE,
  completeStyle,
  styleOf,
  MARKER_TYPES,
  MARKER_SHAPES,
  PAINT_KEYS,
  PAINT_KINDS,
  gradientStops,
  isGradient,
  gradientId,
  hasMarkers,
  styleAttrs,
  parseDash,
} from "./element-style.js";
export type { AttrMap, PaintKind } from "./element-style.js";
import {
  closesBack,
  contours,
  cornerRadius,
  cornerRadiusY,
  geometryPoints,
  indexedSegments,
  isCompound,
  keepsRotation,
  neighbours,
  pathIsStraight,
  rotatePoint,
  rotationCentre,
  segmentInfo,
} from "./element-geometry.js";
export {
  keepsRotation,
  rotationCentre,
  toLocalPoint,
  toWorldPoint,
  cornerRadius,
  cornerRadiusY,
  contours,
  localBBox,
  cornersOf,
  elementBBox,
  geometryOf,
} from "./element-geometry.js";
export type { Geometry, Contour, Formatter } from "./element-geometry.js";
import { cubicAt, splitCubic } from "./cubic.js";
import { isDefaultName, uid } from "./utils.js";
import type {
  Anchor,
  ElementType,
  EllipseElement,
  LineElement,
  PathElement,
  Point,
  PointsElement,
  PolygonElement,
  PolylineElement,
  RectElement,
  ReferenceImage,
  SceneElement,
  StyleCarrier,
  StyleProps,
  TextElement,
} from "./types.js";

/** Identity plus a full style set, shared by every element constructor. */
function base<T extends ElementType>(
  type: T,
  style: StyleCarrier
): { id: string; type: T; name: string; groups?: string[] } & StyleProps {
  const { id, ...rest } = style;
  return {
    id: id ?? uid(type),
    type,
    name: "",
    ...structuredClone(rest),
    ...completeStyle(rest),
  } as { id: string; type: T; name: string; groups?: string[] } & StyleProps;
}

export function createPath(
  points: Anchor[] = [],
  closed = false,
  style: StyleCarrier = {}
): PathElement {
  return { ...base("path", style), points, closed };
}

export function createPoint(x: number, y: number, smooth = false): Anchor {
  return {
    x,
    y,
    smooth,
    hOut: smooth ? { x, y } : null,
    hIn: smooth ? { x, y } : null,
  };
}

export function mirrorHandle(anchor: Point, dragged: Point): Point {
  return { x: anchor.x + (anchor.x - dragged.x), y: anchor.y + (anchor.y - dragged.y) };
}

/**
 * Pulls a turn onto the nearest multiple of 15° once it comes within a few degrees of one: the
 * steps Shift gives a mouse, for a finger, without taking away the angles in between. `startDeg`
 * is the rotation the shape already carries, so the magnet works on the angle you see.
 */
export function magnetTurn(delta: number, startDeg = 0): number {
  const STEP = 15;
  const REACH = 3;
  const deg = startDeg + (delta * 180) / Math.PI;
  const near = Math.round(deg / STEP) * STEP;
  return Math.abs(deg - near) <= REACH ? ((near - startDeg) * Math.PI) / 180 : delta;
}

/** Whether a curve handle stands off its anchor, rather than on it (where it bends nothing). */
function standsOff(h: Point | null, p: Point): boolean {
  return !!h && (h.x !== p.x || h.y !== p.y);
}

/** Whether an anchor has two handles standing off it: the only case where linking them means anything. */
export function hasTwoHandles(p: Anchor): boolean {
  return standsOff(p.hIn, p) && standsOff(p.hOut, p);
}

/** Whether an anchor has the given curve handle, standing off the anchor rather than on it. */
export function hasHandle(p: Anchor, kind: "in" | "out"): boolean {
  return standsOff(kind === "in" ? p.hIn : p.hOut, p);
}

/**
 * Takes one handle off an anchor, so the curve leaves it straight on that side while the other
 * side keeps its curve. With one handle there is no pair left to link.
 */
export function removeHandle(p: Anchor, kind: "in" | "out"): void {
  if (kind === "in") p.hIn = null;
  else p.hOut = null;
  p.smooth = false;
}

/**
 * Links an anchor's two handles, so dragging one mirrors the other, or breaks them into a cusp
 * whose handles move on their own. `smooth` is that link. Linking mirrors the in-handle off the
 * out one straight away, so what you see is what the next drag keeps.
 */
export function setHandlesLinked(p: Anchor, linked: boolean): void {
  p.smooth = linked;
  if (linked && p.hOut) p.hIn = mirrorHandle(p, p.hOut);
}

export function createLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: StyleCarrier = {}
): LineElement {
  return { ...base("line", style), x1, y1, x2, y2 };
}

export function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
  style: StyleCarrier = {}
): RectElement {
  return { ...base("rect", style), x, y, width, height, rx: 0 };
}

export function createText(
  x: number,
  y: number,
  text = "Text",
  style: StyleCarrier = {}
): TextElement {
  return {
    ...base("text", { fillEnabled: true, strokeWidth: 0, ...style }),
    x,
    y,
    text,
    fontSize: 48,
    fontFamily: "sans-serif",
    anchor: "start",
  };
}

export function createEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: StyleCarrier = {}
): EllipseElement {
  return { ...base("ellipse", style), cx, cy, rx, ry };
}

export function createPolyline(points: Point[], style: StyleCarrier = {}): PolylineElement {
  return { ...base("polyline", style), points };
}

export function createPolygon(points: Point[], style: StyleCarrier = {}): PolygonElement {
  return { ...base("polygon", style), points };
}

export function createImage(dataUrl: string, name: string): ReferenceImage {
  return {
    id: uid("img"),
    name,
    fileName: name,
    dataUrl,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 0.5,
    visible: true,
  };
}

/* ---------- Transforms ---------- */

export function translateElement(el: SceneElement, dx: number, dy: number): void {
  switch (el.type) {
    case "path":
    case "polyline":
    case "polygon":
      for (const p of geometryPoints(el)) {
        p.x += dx;
        p.y += dy;
      }
      break;
    case "line":
      el.x1 += dx;
      el.y1 += dy;
      el.x2 += dx;
      el.y2 += dy;
      break;
    case "rect":
    case "text":
      el.x += dx;
      el.y += dy;
      break;
    case "ellipse":
      el.cx += dx;
      el.cy += dy;
      break;
  }
}

/**
 * Moves one point of a shape rather than the shape: point `index` of a path, polyline or polygon,
 * or end `index` of a line. On a path, `handle` moves that curve handle instead of its anchor,
 * and a linked pair keeps mirroring, as it does under a drag; an anchor takes its handles along.
 * Does nothing when the shape has no such point (see `hasPoint`).
 */
export function translatePoint(
  el: SceneElement,
  index: number,
  dx: number,
  dy: number,
  handle?: "in" | "out"
): void {
  if (!hasPoint(el, index)) return;
  if (el.type === "line") {
    if (index === 0) {
      el.x1 += dx;
      el.y1 += dy;
    } else {
      el.x2 += dx;
      el.y2 += dy;
    }
    return;
  }
  if (el.type === "polyline" || el.type === "polygon") {
    el.points[index]!.x += dx;
    el.points[index]!.y += dy;
    return;
  }
  if (el.type !== "path") return;
  const p = el.points[index]!;
  const h = handle === "in" ? p.hIn : handle === "out" ? p.hOut : null;
  if (h) {
    h.x += dx;
    h.y += dy;
    const other = handle === "in" ? "hOut" : "hIn";
    if (p.smooth && p[other]) p[other] = mirrorHandle(p, h);
    return;
  }
  p.x += dx;
  p.y += dy;
  for (const c of [p.hIn, p.hOut]) {
    if (!c) continue;
    c.x += dx;
    c.y += dy;
  }
}

/** Whether `index` names a point of `el` that `translatePoint` can move. */
export function hasPoint(el: SceneElement, index: number): boolean {
  if (el.type === "line") return index === 0 || index === 1;
  if (el.type === "path" || el.type === "polyline" || el.type === "polygon") {
    return index >= 0 && index < el.points.length;
  }
  return false;
}

export interface AlignOptions {
  excludeElementIds?: Set<string>;
  excludePoint?: { elementId: string; index: number };
}

/**
 * Candidate points for Alt-key alignment snapping. `excludeElementIds` drops whole elements
 * (e.g. the ones being dragged); `excludePoint` drops a single anchor (the one being dragged).
 */
export function collectAlignPoints(
  elements: readonly SceneElement[],
  opts: AlignOptions = {}
): Point[] {
  const pts: Point[] = [];
  for (const el of elements) {
    if (el.hidden || opts.excludeElementIds?.has(el.id)) continue;
    const skip = opts.excludePoint?.elementId === el.id ? opts.excludePoint.index : -1;
    for (const p of geometryPoints(el, skip)) pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

interface AlignResult extends Point {
  guideX: number | null;
  guideY: number | null;
}

/**
 * Snaps `p` to the nearest x and/or y among `points` if within `tol` (world units),
 * independently per axis. Returns the adjusted point plus the matched guide coordinates.
 */
export function alignToPoints(p: Point, points: readonly Point[], tol: number): AlignResult {
  let x = p.x;
  let y = p.y;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestDx = tol;
  let bestDy = tol;
  for (const pt of points) {
    const dx = Math.abs(pt.x - p.x);
    if (dx < bestDx) {
      bestDx = dx;
      x = pt.x;
      guideX = pt.x;
    }
    const dy = Math.abs(pt.y - p.y);
    if (dy < bestDy) {
      bestDy = dy;
      y = pt.y;
      guideY = pt.y;
    }
  }
  return { x, y, guideX, guideY };
}

/**
 * When a freshly drawn path turns out to have no curves, replace it with the more specific
 * primitive it's equivalent to: a 2-point open path becomes a line, a straight closed path a
 * polygon, any other straight open path a polyline. Keeps the same id so selection/undo
 * references stay valid.
 */
export function simplifyPathIfStraight(path: SceneElement): SceneElement {
  if (path.type !== "path" || path.points.length < 2 || !pathIsStraight(path)) return path;
  // Several outlines are one shape only as a path: a polygon has room for one.
  if (isCompound(path)) return path;
  // Closed on two points it is a lens waiting for its curves: a line would forget it was closed.
  if (path.closed && path.points.length < 3) return path;
  const pts = path.points.map((p) => ({ x: p.x, y: p.y }));
  const style = { ...styleOf(path), id: path.id };
  if (path.closed && pts.length >= 3) return createPolygon(pts, style);
  if (pts.length === 2) return createLine(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y, style);
  return createPolyline(pts, style);
}

const KAPPA = 0.5522847498;

function ellipseToPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: StyleCarrier
): PathElement {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const mk = (x: number, y: number, hIn: Point, hOut: Point): Anchor => ({
    x,
    y,
    smooth: true,
    hIn,
    hOut,
  });
  return createPath(
    [
      mk(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      mk(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      mk(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      mk(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
    ],
    true,
    style
  );
}

/**
 * A rounded rectangle as a path: each corner a quarter ellipse, drawn with the same cubic
 * approximation as an ellipse, clockwise from the top edge. A corner whose radius takes a whole
 * side meets the next corner at one point.
 */
function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
  style: StyleCarrier
): PathElement {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const at = (px: number, py: number, hIn: Point | null, hOut: Point | null): Anchor => ({
    x: px,
    y: py,
    smooth: !!hIn && !!hOut,
    hIn,
    hOut,
  });
  const right = x + w;
  const bottom = y + h;
  // Each corner is two anchors: where the straight side ends and where the next one starts.
  const pts: Anchor[] = [
    at(x + rx, y, { x: x + rx - kx, y }, null),
    at(right - rx, y, null, { x: right - rx + kx, y }),
    at(right, y + ry, { x: right, y: y + ry - ky }, null),
    at(right, bottom - ry, null, { x: right, y: bottom - ry + ky }),
    at(right - rx, bottom, { x: right - rx + kx, y: bottom }, null),
    at(x + rx, bottom, null, { x: x + rx - kx, y: bottom }),
    at(x, bottom - ry, { x, y: bottom - ry + ky }, null),
    at(x, y + ry, null, { x, y: y + ry - ky }),
  ];
  // Sides the radius used up entirely leave two anchors on one spot: keep one, with both handles.
  const merged: Anchor[] = [];
  for (const p of pts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) {
      prev.hOut = p.hOut;
      prev.smooth = true;
    } else merged.push(p);
  }
  const first = merged[0]!;
  const last = merged[merged.length - 1]!;
  if (merged.length > 1 && first.x === last.x && first.y === last.y) {
    first.hIn = last.hIn;
    first.smooth = true;
    merged.pop();
  }
  return createPath(merged, true, style);
}

/** Converts any geometric primitive to an equivalent editable path (same id and style). */
export function toPathElement(el: SceneElement): SceneElement {
  if (el.type === "path") return el;
  // A path has no angle to carry, so a stored rotation is baked into the points here.
  if (el.rotation) {
    const centre = rotationCentre(el);
    const upright = structuredClone(el);
    delete upright.rotation;
    const angle = (el.rotation * Math.PI) / 180;
    return rotateElementCopy(toPathElement(upright), angle, centre.x, centre.y);
  }
  const style = { ...styleOf(el), id: el.id };
  const corner = (p: Point) => createPoint(p.x, p.y, false);
  switch (el.type) {
    case "line":
      return createPath(
        [corner({ x: el.x1, y: el.y1 }), corner({ x: el.x2, y: el.y2 })],
        false,
        style
      );
    case "polyline":
      return createPath(el.points.map(corner), false, style);
    case "polygon":
      return createPath(el.points.map(corner), true, style);
    case "rect": {
      const rx = cornerRadius(el);
      const ry = cornerRadiusY(el);
      if (!rx || !ry) return createPath(geometryPoints(el).map(corner), true, style);
      return roundedRectPath(el.x, el.y, el.width, el.height, rx, ry, style);
    }
    case "ellipse":
      return ellipseToPath(el.cx, el.cy, el.rx, el.ry, style);
    default:
      return el;
  }
}

/** Returns a rotated deep copy of `src` (a path/line/polyline/polygon/text) about (cx, cy). */
export function rotateElementCopy(
  src: SceneElement,
  angle: number,
  cx: number,
  cy: number
): SceneElement {
  const c = structuredClone(src);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rot = (p: Point) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    p.x = cx + dx * cos - dy * sin;
    p.y = cy + dx * sin + dy * cos;
  };
  if (keepsRotation(c)) {
    // The angle is stored, so only the centre has to move - and when the drag turns about the
    // shape's own centre, as the rotate handle does, it does not move at all.
    const centre = rotationCentre(c);
    const moved = rotatePoint(centre, cx, cy, (angle * 180) / Math.PI);
    translateElement(c, moved.x - centre.x, moved.y - centre.y);
    const prev = src.rotation ?? 0;
    c.rotation = (((prev + (angle * 180) / Math.PI) % 360) + 360) % 360;
    if (!c.rotation) delete c.rotation;
  } else if (c.type === "line") {
    const a = { x: c.x1, y: c.y1 };
    const b = { x: c.x2, y: c.y2 };
    rot(a);
    rot(b);
    c.x1 = a.x;
    c.y1 = a.y;
    c.x2 = b.x;
    c.y2 = b.y;
  } else {
    geometryPoints(c).forEach(rot);
  }
  return c;
}

/* ---------- Point editing ---------- */

export interface NearestHit {
  index: number;
  t: number;
  dist: number;
}

/**
 * Finds the closest point on a path/line/polyline/polygon outline to `p`.
 * Returns {index, t, dist}: the segment from points[index] to points[index+1]
 * (wrapping for closed shapes) and the parameter along it.
 */
export function nearestOnElement(el: SceneElement, p: Point): NearestHit | null {
  const segs: { i: number; a: Point; b: Point }[] = [];
  if (el.type === "line") {
    segs.push({ i: 0, a: { x: el.x1, y: el.y1 }, b: { x: el.x2, y: el.y2 } });
  } else if (el.type === "path") {
    for (const { from, a, b } of indexedSegments(el)) segs.push({ i: from, a, b });
  } else if ("points" in el) {
    const pts: Point[] = el.points;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) segs.push({ i, a: pts[i]!, b: pts[i + 1]! });
    if (el.type === "polygon" && n > 1) segs.push({ i: n - 1, a: pts[n - 1]!, b: pts[0]! });
  }
  let best: NearestHit | null = null;
  const consider = (i: number, t: number, d: number) => {
    if (!best || d < best.dist) best = { index: i, t, dist: d };
  };
  for (const s of segs) {
    const info =
      el.type === "path"
        ? segmentInfo(s.a as Anchor, s.b as Anchor)
        : { curved: false, c1: s.a, c2: s.b };
    if (!info.curved) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      consider(s.i, t, Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t)));
    } else {
      const N = 48;
      const distAt = (t: number) => {
        const q = cubicAt({ a: s.a, c1: info.c1, c2: info.c2, b: s.b }, t);
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      let bt = 0;
      let bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const d = distAt(k / N);
        if (d < bd) {
          bd = d;
          bt = k / N;
        }
      }
      let lo = Math.max(0, bt - 1 / N);
      let hi = Math.min(1, bt + 1 / N);
      for (let it = 0; it < 14; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (distAt(m1) < distAt(m2)) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      consider(s.i, t, distAt(t));
    }
  }
  return best;
}

/**
 * Inserts a vertex on segment `index` at parameter `t`. Curved path segments are split so the
 * shape doesn't change. A line becomes a 3-point polyline (returned as a replacement element);
 * other types are edited in place.
 */
export function insertPointAt(el: SceneElement, index: number, t: number): SceneElement {
  if (el.type === "line") {
    const mid = { x: el.x1 + (el.x2 - el.x1) * t, y: el.y1 + (el.y2 - el.y1) * t };
    return createPolyline([{ x: el.x1, y: el.y1 }, mid, { x: el.x2, y: el.y2 }], {
      ...styleOf(el),
      id: el.id,
    });
  }
  if (el.type === "polyline" || el.type === "polygon") {
    const n = el.points.length;
    const a = el.points[index]!;
    const b = el.points[(index + 1) % n]!;
    el.points.splice(index + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    return el;
  }
  if (el.type === "path") {
    const pts = el.points;
    const a = pts[index]!;
    const b = neighbours(el, index).next;
    if (!b) return el;
    // The new point goes after `index`, in its outline: every later outline starts one further on.
    if (el.subpaths) el.subpaths = el.subpaths.map((s) => (s > index ? s + 1 : s));
    const info = segmentInfo(a, b);
    if (!info.curved) {
      pts.splice(index + 1, 0, createPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, false));
      return el;
    }
    const [left, right] = splitCubic({ a, c1: info.c1, c2: info.c2, b }, t);
    a.hOut = left.c1;
    b.hIn = right.c2;
    pts.splice(index + 1, 0, {
      x: left.b.x,
      y: left.b.y,
      smooth: true,
      hIn: left.c2,
      hOut: right.c1,
    });
  }
  return el;
}

/** Toggles a path anchor between corner (no handles) and smooth (symmetric generated handles). */
export function togglePointSmooth(path: SceneElement, i: number): void {
  if (path.type !== "path") return;
  const p = path.points[i];
  if (!p) return;
  if (standsOff(p.hIn, p) || standsOff(p.hOut, p)) {
    p.hIn = null;
    p.hOut = null;
    p.smooth = false;
    return;
  }
  const { prev, next, count } = neighbours(path, i);
  let tx: number;
  let ty: number;
  let len: number;
  const other = count === 2 ? (next ?? prev) : undefined;
  if (other) {
    // Two points have only the line between them to follow, and handles along it leave it
    // straight: they stand square to it instead, so the curve bulges - a lens when closed.
    tx = -(other.y - p.y);
    ty = other.x - p.x;
    len = Math.hypot(tx, ty) / 3;
  } else if (prev && next) {
    tx = next.x - prev.x;
    ty = next.y - prev.y;
    len =
      Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(next.x - p.x, next.y - p.y)) / 3;
  } else if (next) {
    tx = next.x - p.x;
    ty = next.y - p.y;
    len = Math.hypot(tx, ty) / 3;
  } else if (prev) {
    tx = p.x - prev.x;
    ty = p.y - prev.y;
    len = Math.hypot(tx, ty) / 3;
  } else {
    return;
  }
  const m = Math.hypot(tx, ty) || 1;
  const ux = tx / m;
  const uy = ty / m;
  p.smooth = true;
  p.hOut = next ? { x: p.x + ux * len, y: p.y + uy * len } : { x: p.x, y: p.y };
  p.hIn = prev ? { x: p.x - ux * len, y: p.y - uy * len } : { x: p.x, y: p.y };
}

const cloneHandle = (h: Point | null | undefined): Point | null => (h ? { x: h.x, y: h.y } : null);

/* ---------- Topology ---------- */

/** Whether an element is a polyline/polygon/path whose closed state can be changed. */
export function canToggleClosed(el: SceneElement): el is PointsElement {
  return el.type === "path" || el.type === "polyline" || el.type === "polygon";
}

export function isClosedShape(el: SceneElement): boolean {
  return el.type === "polygon" || (el.type === "path" && !!el.closed);
}

/** Closes or opens a shape (polyline <-> polygon, path.closed). Returns the replacement element. */
export function setClosed(el: SceneElement, closed: boolean): SceneElement {
  if (!canToggleClosed(el) || isClosedShape(el) === closed) return el;
  const n = el.points.length;
  // Two points close into a lens once either segment curves; straight, they need a third.
  if (closed && n < (el.type === "path" ? 2 : 3)) return el;
  if (el.type === "path") {
    el.closed = closed;
    return el;
  }
  const pts = el.points.map((p) => ({ x: p.x, y: p.y }));
  const style = { ...styleOf(el), id: el.id };
  return closed ? createPolygon(pts, style) : createPolyline(pts, style);
}

/**
 * The opposite end that the end `index` of an open shape would close onto if dropped where it
 * is, or null. What `closeByMerge` checks, without changing anything, so a drag can show it.
 */
export function closingEnd(el: SceneElement, index: number, tol: number): Point | null {
  if (el.type !== "path" && el.type !== "polyline") return null;
  if (isCompound(el)) return null;
  if (el.type === "path" && el.closed) return null;
  const n = el.points.length;
  if (n < 4 && !(el.type === "path" && n >= 3)) return null;
  if (index !== 0 && index !== n - 1) return null;
  const a = el.points[index]!;
  const b = el.points[index === 0 ? n - 1 : 0]!;
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol ? b : null;
}

/**
 * When the endpoint `index` of an open shape has been dragged onto its opposite endpoint,
 * merges the two into one point and closes the shape. Returns the replacement element or null.
 */
export function closeByMerge(el: SceneElement, index: number, tol: number): SceneElement | null {
  if (!closingEnd(el, index, tol) || (el.type !== "path" && el.type !== "polyline")) return null;
  const n = el.points.length;
  if (el.type === "polyline") {
    const rest = el.points.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
    return createPolygon(rest, { ...styleOf(el), id: el.id });
  }
  const pts = el.points;
  if (index === n - 1) {
    const first = pts[0]!;
    const last = pts[n - 1]!;
    if (last.hIn) first.hIn = cloneHandle(last.hIn);
    first.smooth = first.smooth || last.smooth;
    pts.pop();
  } else {
    const first = pts[0]!;
    const last = pts[n - 1]!;
    if (first.hOut) last.hOut = cloneHandle(first.hOut);
    last.smooth = last.smooth || first.smooth;
    pts.shift();
  }
  el.closed = true;
  return el;
}

/** Whether `splitAt` cuts the shape at point `i`: anywhere on a closed one, between the ends of an open one. */
export function canSplitAt(el: SceneElement, i: number): boolean {
  if (!canToggleClosed(el) || isCompound(el)) return false;
  const n = el.points.length;
  return isClosedShape(el) ? n >= 2 : i > 0 && i < n - 1;
}

/**
 * Cuts a shape at anchor `i`. A closed shape becomes one open path that starts and ends at the
 * cut; an open shape becomes two paths. Returns the replacement elements (first keeps the id),
 * or null if the cut is not possible (endpoints, lines, too few points).
 */
export function splitAt(el: SceneElement, i: number): SceneElement[] | null {
  if (!canToggleClosed(el) || isCompound(el)) return null;
  const path = el.type === "path" ? el : (toPathElement(el) as PathElement);
  const pts = path.points;
  const n = pts.length;
  const closed = closesBack(path);
  const style = { ...styleOf(path) };
  const copy = (p: Anchor, hIn: Point | null, hOut: Point | null): Anchor => ({
    x: p.x,
    y: p.y,
    smooth: p.smooth,
    hIn: cloneHandle(hIn),
    hOut: cloneHandle(hOut),
  });
  if (closed) {
    const ordered: Anchor[] = [];
    for (let k = 0; k < n; k++) ordered.push(pts[(i + k) % n]!);
    const out = ordered.map((p) => copy(p, p.hIn, p.hOut));
    out[0]!.hIn = null;
    out.push(copy(pts[i]!, pts[i]!.hIn, null));
    return [simplifyPathIfStraight(createPath(out, false, { ...style, id: el.id }))];
  }
  if (i <= 0 || i >= n - 1) return null;
  const a = pts.slice(0, i + 1).map((p) => copy(p, p.hIn, p.hOut));
  a[a.length - 1]!.hOut = null;
  const b = pts.slice(i).map((p) => copy(p, p.hIn, p.hOut));
  b[0]!.hIn = null;
  return [
    simplifyPathIfStraight(createPath(a, false, { ...style, id: el.id })),
    simplifyPathIfStraight(createPath(b, false, style)),
  ];
}

/**
 * The shape left once the points at `indices` are deleted, each neighbour pair rejoined, or null
 * when too little is left to draw. An outline down to one point goes, taking its place in the
 * path with it; a line or a polyline down to two points becomes a line, and a line losing either
 * end is gone.
 */
export function deletePoints(el: SceneElement, indices: readonly number[]): SceneElement | null {
  const doomed = new Set(indices);
  if (el.type === "line") return doomed.has(0) || doomed.has(1) ? null : el;
  if (el.type === "polyline" || el.type === "polygon") {
    const kept = el.points.filter((_, i) => !doomed.has(i)).map((p) => ({ x: p.x, y: p.y }));
    if (kept.length < 2) return null;
    const style = { ...styleOf(el), id: el.id };
    const next = el.type === "polygon" ? createPolygon(kept, style) : createPolyline(kept, style);
    return kept.length === 2 ? simplifyPathIfStraight(toPathElement(next)) : next;
  }
  if (el.type !== "path") return el;
  const points: Anchor[] = [];
  const subpaths: number[] = [];
  for (const { start, end } of contours(el)) {
    const kept = el.points.slice(start, end).filter((_, k) => !doomed.has(start + k));
    if (kept.length < 2) continue;
    if (points.length) subpaths.push(points.length);
    points.push(...kept);
  }
  if (points.length < 2) return null;
  const next: PathElement = { ...el, points };
  if (subpaths.length) next.subpaths = subpaths;
  else delete next.subpaths;
  return next;
}

function reversedPoints(points: readonly Anchor[]): Anchor[] {
  return points
    .map((p) => ({ ...p, hIn: cloneHandle(p.hOut), hOut: cloneHandle(p.hIn) }))
    .reverse();
}

/** Open, single-subpath shapes that can be joined end to end (as paths). */
export function canJoin(el: SceneElement): boolean {
  if (el.type === "line" || el.type === "polyline") return true;
  return el.type === "path" && !el.closed && !isCompound(el);
}

/**
 * Joins the closest pair of end points of two open shapes into one path (style and id of `a`).
 * Ends within `mergeTol` become one point; farther ends get a straight segment between them.
 * Returns null if either shape is not joinable, or the closest ends are farther apart than `maxDist`.
 */
export function joinPaths(
  a: SceneElement,
  b: SceneElement,
  mergeTol = 0.5,
  maxDist = Infinity
): SceneElement | null {
  if (!canJoin(a) || !canJoin(b)) return null;
  const pa = (toPathElement(a) as PathElement).points.map((p) => ({ ...p }));
  const pb = (toPathElement(b) as PathElement).points.map((p) => ({ ...p }));
  if (!pa.length || !pb.length) return null;
  const ends = (pts: Anchor[]) => [pts[0]!, pts[pts.length - 1]!];
  let best: { d: number; aStart: boolean; bEnd: boolean } | null = null;
  ends(pa).forEach((p, i) =>
    ends(pb).forEach((q, j) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { d, aStart: i === 0, bEnd: j === 1 };
    })
  );
  if (!best) return null;
  const pick = best as { d: number; aStart: boolean; bEnd: boolean };
  if (pick.d > maxDist) return null;
  const first = pick.aStart ? reversedPoints(pa) : pa;
  const second = pick.bEnd ? reversedPoints(pb) : pb;
  const last = first[first.length - 1]!;
  const head = second[0]!;
  let points: Anchor[];
  if (pick.d <= mergeTol) {
    const mx = (last.x + head.x) / 2;
    const my = (last.y + head.y) / 2;
    const shift = (h: Point | null, from: Point) =>
      h ? { x: h.x + mx - from.x, y: h.y + my - from.y } : null;
    const merged: Anchor = {
      x: mx,
      y: my,
      smooth: !!(last.smooth || head.smooth),
      hIn: shift(last.hIn, last),
      hOut: shift(head.hOut, head),
    };
    points = [...first.slice(0, -1), merged, ...second.slice(1)];
  } else {
    points = [...first, ...second];
  }
  const path = createPath(points, false, { ...styleOf(a), id: a.id });
  // Joined shapes keep both custom names ("foo" + "bar" = "foo bar"); default names renumber.
  const names = [a.name, b.name].filter((n) => !isDefaultName(n));
  if (names.length) path.name = names.join(" ");
  return simplifyPathIfStraight(path);
}

export function duplicateElement(el: SceneElement): SceneElement {
  const copy = structuredClone(el);
  copy.id = uid(el.type);
  return copy;
}
