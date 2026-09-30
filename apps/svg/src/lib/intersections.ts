import {
  cubicAt,
  cubicHull,
  boxesOverlap,
  lerpPoint,
  splitCubic,
  type OutlineSegment,
} from "./cubic.js";
import type { BBox, Point } from "./types.js";

/** One place two segments meet: the parameter on each, and the one point both are cut at. */
interface Hit {
  ta: number;
  tb: number;
  p: Point;
}

function lineHits(s: OutlineSegment, r: OutlineSegment, tol: number): Hit[] {
  const d1 = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const d2 = { x: r.b.x - r.a.x, y: r.b.y - r.a.y };
  const cross = d1.x * d2.y - d1.y * d2.x;
  const len1 = Math.hypot(d1.x, d1.y);
  const len2 = Math.hypot(d2.x, d2.y);
  if (!len1 || !len2) return [];
  const w = { x: r.a.x - s.a.x, y: r.a.y - s.a.y };
  if (Math.abs(cross) <= 1e-12 * len1 * len2) {
    // Parallel: only lines on one line can meet, and then along a stretch - each is cut where
    // the other's ends fall on it.
    if (Math.abs(w.x * d1.y - w.y * d1.x) / len1 > tol) return [];
    const hits: Hit[] = [];
    const onS = (p: Point) => ((p.x - s.a.x) * d1.x + (p.y - s.a.y) * d1.y) / (len1 * len1);
    const onR = (p: Point) => ((p.x - r.a.x) * d2.x + (p.y - r.a.y) * d2.y) / (len2 * len2);
    for (const p of [r.a, r.b]) {
      const t = onS(p);
      if (t > -1e-9 && t < 1 + 1e-9) hits.push({ ta: t, tb: p === r.a ? 0 : 1, p });
    }
    for (const p of [s.a, s.b]) {
      const t = onR(p);
      if (t > -1e-9 && t < 1 + 1e-9) hits.push({ ta: p === s.a ? 0 : 1, tb: t, p });
    }
    return hits;
  }
  const ta = (w.x * d2.y - w.y * d2.x) / cross;
  const tb = (w.x * d1.y - w.y * d1.x) / cross;
  const eps = tol / Math.min(len1, len2);
  if (ta < -eps || ta > 1 + eps || tb < -eps || tb > 1 + eps) return [];
  return [{ ta, tb, p: lerpPoint(s.a, s.b, Math.max(0, Math.min(1, ta))) }];
}

/**
 * Where two segments meet, by halving both until the pieces that still overlap are smaller than
 * `tol`. Segments that run along each other overlap everywhere; the work is capped for them, and
 * the cut is made where the run of meeting points starts and ends.
 */
function curveHits(s: OutlineSegment, r: OutlineSegment, tol: number): Hit[] {
  const found: Hit[] = [];
  let budget = 4000;
  const walk = (
    p: OutlineSegment,
    pa: number,
    pb: number,
    q: OutlineSegment,
    qa: number,
    qb: number,
    depth: number
  ): void => {
    if (budget-- <= 0) return;
    const hp = cubicHull(p);
    const hq = cubicHull(q);
    if (!boxesOverlap(hp, hq, tol)) return;
    const small = (h: BBox) => Math.max(h.width, h.height) <= tol;
    if ((small(hp) && small(hq)) || depth > 50) {
      const ta = (pa + pb) / 2;
      const tb = (qa + qb) / 2;
      const m1 = cubicAt(s, ta);
      const m2 = cubicAt(r, tb);
      found.push({ ta, tb, p: { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 } });
      return;
    }
    const pm = (pa + pb) / 2;
    const qm = (qa + qb) / 2;
    const [p1, p2] = small(hp) ? [p, null] : splitCubic(p, 0.5);
    const [q1, q2] = small(hq) ? [q, null] : splitCubic(q, 0.5);
    const ps: [OutlineSegment, number, number][] = p2
      ? [
          [p1, pa, pm],
          [p2, pm, pb],
        ]
      : [[p1, pa, pb]];
    const qs: [OutlineSegment, number, number][] = q2
      ? [
          [q1, qa, qm],
          [q2, qm, qb],
        ]
      : [[q1, qa, qb]];
    for (const [pp, a0, a1] of ps)
      for (const [qq, b0, b1] of qs) walk(pp, a0, a1, qq, b0, b1, depth + 1);
  };
  walk(s, 0, 1, r, 0, 1, 0);
  if (!found.length) return [];
  // Close meeting points are one meeting; a long run of them is two curves on top of each other.
  found.sort((x, y) => x.ta - y.ta);
  const clusters: Hit[][] = [];
  for (const h of found) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && Math.hypot(h.p.x - prev.p.x, h.p.y - prev.p.y) <= tol * 4) last!.push(h);
    else clusters.push([h]);
  }
  return clusters.flatMap((c) =>
    c.length <= 2 ? [c[Math.floor(c.length / 2)]!] : [c[0]!, c[c.length - 1]!]
  );
}

export function segmentHits(a: OutlineSegment, b: OutlineSegment, tolerance: number): Hit[] {
  return a.line && b.line ? lineHits(a, b, tolerance) : curveHits(a, b, tolerance);
}
