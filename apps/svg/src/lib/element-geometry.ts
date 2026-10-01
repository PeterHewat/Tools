import type {
  Anchor,
  BBox,
  PathElement,
  Point,
  RectElement,
  SceneElement,
  TextElement,
} from "./types.js";
import type { AttrMap } from "./element-style.js";

export interface Geometry {
  tag: string;
  attrs: AttrMap;
  text?: string;
}

/**
 * The shapes whose rotation is stored rather than baked in: their SVG element cannot express
 * one in its own coordinates, and baking it in would turn a rect into a polygon and an ellipse
 * into a path. Keeping the angle keeps the shape editable as what it is.
 */
export function keepsRotation(el: SceneElement): boolean {
  return el.type === "rect" || el.type === "ellipse" || el.type === "text";
}

/**
 * The point a stored rotation turns about. A box or ellipse turns about its own centre; text
 * turns about its anchor, which is where the SVG `rotate()` on a `<text>` has always put it.
 */
export function rotationCentre(el: SceneElement): Point {
  if (el.type === "rect") return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  if (el.type === "ellipse") return { x: el.cx, y: el.cy };
  if (el.type === "text") return { x: el.x, y: el.y };
  const box = localBBox(el);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 0, y: 0 };
}

/** Turns `p` about (cx, cy) by `deg` degrees. */
export function rotatePoint(p: Point, cx: number, cy: number, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** A world point in the element's own unrotated frame, which is where its geometry lives. */
export function toLocalPoint(el: SceneElement, p: Point): Point {
  const c = rotationCentre(el);
  return rotatePoint(p, c.x, c.y, -(el.rotation ?? 0));
}

/** The reverse of `toLocalPoint`: an unrotated coordinate back to where it is drawn. */
export function toWorldPoint(el: SceneElement, p: Point): Point {
  const c = rotationCentre(el);
  return rotatePoint(p, c.x, c.y, el.rotation ?? 0);
}

/** Corner radius clamped so it can never exceed half the rect's shorter side. */
export function cornerRadius(el: RectElement): number {
  const limit = el.ry === undefined ? Math.min(el.width, el.height) / 2 : el.width / 2;
  return Math.max(0, Math.min(el.rx, limit));
}

/** Vertical corner radius; follows the horizontal one until it is set separately. */
export function cornerRadiusY(el: RectElement): number {
  if (el.ry === undefined) return cornerRadius(el);
  return Math.max(0, Math.min(el.ry, el.height / 2));
}

/* ---------- Segments and path geometry ---------- */

interface SegmentInfo {
  curved: boolean;
  c1: Point;
  c2: Point;
}

/** The segment from `a` to `b`: whether it curves, and the two cubic control points. */
export function segmentInfo(a: Anchor, b: Anchor): SegmentInfo {
  return {
    curved:
      !!(a.hOut && (a.hOut.x !== a.x || a.hOut.y !== a.y)) ||
      !!(b.hIn && (b.hIn.x !== b.x || b.hIn.y !== b.y)),
    c1: a.hOut ?? a,
    c2: b.hIn ?? b,
  };
}

/**
 * Whether a path draws a segment from its last anchor back to its first. Two anchors are
 * enough: two curves between the same two points is how a heart or a lens is drawn.
 */
export function closesBack(path: PathElement): boolean {
  return path.closed && path.points.length >= 2;
}

/** A run of `points`, `start` to `end` exclusive: one outline of a path. */
export interface Contour {
  start: number;
  end: number;
}

/** The outlines of a path, in order: one for an ordinary path, more for a shape with holes. */
export function contours(path: PathElement): Contour[] {
  const n = path.points.length;
  const starts = [0, ...(path.subpaths ?? []).filter((i) => i > 0 && i < n)];
  return starts.map((start, k) => ({ start, end: starts[k + 1] ?? n }));
}

/** Whether a path is made of more than one outline. */
export function isCompound(el: SceneElement): boolean {
  return el.type === "path" && !!el.subpaths?.length;
}

/** The outline holding point `i`. */
function contourOf(path: PathElement, i: number): Contour {
  return contours(path).find((c) => i >= c.start && i < c.end) ?? { start: 0, end: 0 };
}

/** The points before and after `i` along its own outline, wrapping round a closed one. */
export function neighbours(
  path: PathElement,
  i: number
): { prev?: Anchor; next?: Anchor; count: number } {
  const { start, end } = contourOf(path, i);
  const count = end - start;
  const wrap = path.closed && count >= 2;
  const prev = i > start ? path.points[i - 1] : wrap ? path.points[end - 1] : undefined;
  const next = i < end - 1 ? path.points[i + 1] : wrap ? path.points[start] : undefined;
  return { prev, next, count };
}

/**
 * Every drawn segment, including each outline's closing one on a closed path. `from` is the
 * index of the segment's first anchor.
 */
export function indexedSegments(path: PathElement): { from: number; a: Anchor; b: Anchor }[] {
  const pts = path.points;
  const segs: { from: number; a: Anchor; b: Anchor }[] = [];
  for (const { start, end } of contours(path)) {
    for (let i = start; i < end - 1; i++) segs.push({ from: i, a: pts[i]!, b: pts[i + 1]! });
    if (path.closed && end - start >= 2) {
      segs.push({ from: end - 1, a: pts[end - 1]!, b: pts[start]! });
    }
  }
  return segs;
}

export type Formatter = (n: number) => number;

/** `fmt` formats each coordinate (identity for live rendering, Math.round for export). */
function pathToD(path: PathElement, fmt: Formatter = (n) => n): string {
  const pts = path.points;
  if (!pts.length) return "";
  const draw = (a: Anchor, b: Anchor) => {
    const { curved, c1, c2 } = segmentInfo(a, b);
    return curved
      ? ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`
      : ` L ${fmt(b.x)} ${fmt(b.y)}`;
  };
  // Each outline is a subpath of its own: a move to its first point, and a Z when closed.
  return contours(path)
    .filter(({ start, end }) => end > start)
    .map(({ start, end }) => {
      let d = `M ${fmt(pts[start]!.x)} ${fmt(pts[start]!.y)}`;
      for (let i = start; i < end - 1; i++) d += draw(pts[i]!, pts[i + 1]!);
      if (path.closed && end - start >= 2) {
        const last = pts[end - 1]!;
        // A straight closing segment is implied by Z; only a curved one needs its own command.
        if (segmentInfo(last, pts[start]!).curved) d += draw(last, pts[start]!);
        d += " Z";
      }
      return d;
    })
    .join(" ");
}

/** True if every segment of `path` is a straight line (no Bezier curvature). */
export function pathIsStraight(path: PathElement): boolean {
  return indexedSegments(path).every(({ a, b }) => !segmentInfo(a, b).curved);
}

/**
 * Every point that defines a shape's geometry: anchors, plus Bezier handles for paths.
 * For paths/polylines/polygons the returned objects are the live ones (so they can be moved);
 * `skipIndex` drops one anchor and its handles.
 */
export function geometryPoints(el: SceneElement, skipIndex = -1): Point[] {
  switch (el.type) {
    case "path": {
      const out: Point[] = [];
      el.points.forEach((p, i) => {
        if (i === skipIndex) return;
        out.push(p);
        if (p.hIn) out.push(p.hIn);
        if (p.hOut) out.push(p.hOut);
      });
      return out;
    }
    case "polyline":
    case "polygon":
      return el.points.filter((_, i) => i !== skipIndex);
    case "line":
      return [
        { x: el.x1, y: el.y1 },
        { x: el.x2, y: el.y2 },
      ];
    case "rect": {
      // Perimeter order (TL, TR, BR, BL) so tracing these as a path gives the rectangle back.
      const corners = [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
        { x: el.x, y: el.y + el.height },
      ];
      return el.rotation ? corners.map((p) => toWorldPoint(el, p)) : corners;
    }
    case "ellipse":
      return [{ x: el.cx, y: el.cy }];
    case "text":
      return [{ x: el.x, y: el.y }];
  }
}

function boundsOf(points: readonly Point[]): BBox | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* ---------- Rendering / export geometry ---------- */

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(el: TextElement): number {
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  const fontSize = el.fontSize;
  if (!measureCtx) return el.text.length * fontSize * 0.6;
  measureCtx.font = `${fontSize}px ${el.fontFamily}`;
  return measureCtx.measureText(el.text).width;
}

/** A shape's box before any rotation: where its handles and its geometry actually live. */
export function localBBox(el: SceneElement): BBox | null {
  switch (el.type) {
    case "rect":
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case "ellipse":
      return { x: el.cx - el.rx, y: el.cy - el.ry, width: el.rx * 2, height: el.ry * 2 };
    case "text": {
      const w = textWidth(el);
      const h = el.fontSize * 1.1;
      const x = el.anchor === "middle" ? el.x - w / 2 : el.anchor === "end" ? el.x - w : el.x;
      return { x, y: el.y - el.fontSize * 0.85, width: w, height: h };
    }
    default:
      return boundsOf(geometryPoints(el));
  }
}

/** The corners of the local box, turned into where they are actually drawn. */
export function cornersOf(el: SceneElement): Point[] {
  const box = localBBox(el);
  if (!box) return [];
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((p) => toWorldPoint(el, p));
}

/** The axis-aligned box the shape occupies on the artboard, rotation included. */
export function elementBBox(el: SceneElement): BBox | null {
  const box = localBBox(el);
  if (!box || !el.rotation) return box;
  // An ellipse's rotated extent is not its rotated corner box, so it gets the exact formula.
  if (el.type === "ellipse") {
    const { rx, ry } = el;
    const a = (el.rotation * Math.PI) / 180;
    const hw = Math.hypot(rx * Math.cos(a), ry * Math.sin(a));
    const hh = Math.hypot(rx * Math.sin(a), ry * Math.cos(a));
    return { x: el.cx - hw, y: el.cy - hh, width: hw * 2, height: hh * 2 };
  }
  return boundsOf(cornersOf(el));
}

/** `rotate(a cx cy)` for a shape that carries an angle, or null when it does not. */
function rotateAttr(el: SceneElement, fmt: Formatter): string | null {
  const angle = el.rotation ?? 0;
  if (!angle) return null;
  const c = rotationCentre(el);
  return `rotate(${Math.round(angle * 10) / 10} ${fmt(c.x)} ${fmt(c.y)})`;
}

/**
 * Tag and geometry attributes for an element, shared by the canvas renderer and the SVG
 * exporter so the two can never drift. `fmt` formats coordinates (identity on canvas,
 * Math.round for export); `text` is present only for `<text>`. Null attributes are dropped.
 */
export function geometryOf(el: SceneElement, fmt: Formatter = (n) => n): Geometry | null {
  switch (el.type) {
    case "path":
      return { tag: "path", attrs: { d: pathToD(el, fmt) } };
    case "line":
      return {
        tag: "line",
        attrs: { x1: fmt(el.x1), y1: fmt(el.y1), x2: fmt(el.x2), y2: fmt(el.y2) },
      };
    case "rect": {
      const rx = fmt(cornerRadius(el));
      const ry = fmt(cornerRadiusY(el));
      const rounded = rx > 0 || ry > 0;
      return {
        tag: "rect",
        attrs: {
          x: fmt(el.x),
          y: fmt(el.y),
          width: fmt(el.width),
          height: fmt(el.height),
          rx: rounded ? rx : null,
          // `rx` alone already implies an equal `ry`.
          ry: rounded && ry !== rx ? ry : null,
          transform: rotateAttr(el, fmt),
        },
      };
    }
    case "ellipse": {
      const rx = fmt(el.rx);
      const ry = fmt(el.ry);
      // An ellipse whose radii have come out equal is a circle, and says so in the markup.
      // There is no circle tool; the diagonal handle on an ellipse is how you draw one.
      const transform = rotateAttr(el, fmt);
      if (rx === ry) {
        return { tag: "circle", attrs: { cx: fmt(el.cx), cy: fmt(el.cy), r: rx, transform } };
      }
      return { tag: "ellipse", attrs: { cx: fmt(el.cx), cy: fmt(el.cy), rx, ry, transform } };
    }
    case "polyline":
    case "polygon":
      return {
        tag: el.type,
        attrs: { points: el.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ") },
      };
    case "text":
      return {
        tag: "text",
        attrs: {
          x: fmt(el.x),
          y: fmt(el.y),
          "font-family": el.fontFamily,
          "font-size": fmt(el.fontSize),
          "text-anchor": el.anchor !== "start" ? el.anchor : null,
          transform: rotateAttr(el, fmt),
        },
        text: el.text,
      };
    default:
      return null;
  }
}
