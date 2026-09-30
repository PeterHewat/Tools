import type { BBox, Point } from "./types.js";

export interface Cubic {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
}
export interface OutlineSegment extends Cubic {
  line: boolean;
}

export function cubicAt(s: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.a.x + b * s.c1.x + c * s.c2.x + d * s.b.x,
    y: a * s.a.y + b * s.c1.y + c * s.c2.y + d * s.b.y,
  };
}

export const lerpPoint = (p: Point, q: Point, t: number): Point => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

export function splitCubic<T extends Cubic>(s: T, t: number): [T, T] {
  const p01 = lerpPoint(s.a, s.c1, t);
  const p12 = lerpPoint(s.c1, s.c2, t);
  const p23 = lerpPoint(s.c2, s.b, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const m = lerpPoint(p012, p123, t);
  return [
    { ...s, a: s.a, c1: p01, c2: p012, b: m },
    { ...s, a: m, c1: p123, c2: p23, b: s.b },
  ];
}

export function cubicHull(s: Cubic): BBox {
  const xs = [s.a.x, s.c1.x, s.c2.x, s.b.x];
  const ys = [s.a.y, s.c1.y, s.c2.y, s.b.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function boxesOverlap(p: BBox, q: BBox, pad: number): boolean {
  return (
    p.x <= q.x + q.width + pad &&
    q.x <= p.x + p.width + pad &&
    p.y <= q.y + q.height + pad &&
    q.y <= p.y + p.height + pad
  );
}
