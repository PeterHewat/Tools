import { contours, toPathElement } from "./model.js";
import { cubicAt, cubicHull, boxesOverlap, type OutlineSegment } from "./cubic.js";
import { segmentHits } from "./intersections.js";
import type { BBox, PathElement, Point, SceneElement } from "./types.js";
/* ---------- Points worth snapping to ---------- */

/** A shape's outline as segments, closing ones only where the shape is closed. */
function outlineSegments(el: SceneElement): OutlineSegment[] {
  if (el.type === "text") return [];
  const path = toPathElement(el) as PathElement;
  if (path.type !== "path") return [];
  const pts = path.points;
  const out: OutlineSegment[] = [];
  for (const { start, end } of contours(path)) {
    const last = path.closed && end - start >= 2 ? end : end - 1;
    for (let i = start; i < last; i++) {
      const p = pts[i]!;
      const q = pts[i + 1 < end ? i + 1 : start]!;
      const c1 = p.hOut ?? p;
      const c2 = q.hIn ?? q;
      const line = c1.x === p.x && c1.y === p.y && c2.x === q.x && c2.y === q.y;
      out.push({ a: p, c1, c2, b: q, line });
    }
  }
  return out;
}

/**
 * Points a drawing lines up with besides the shapes' own: the middle of every segment, and
 * every place two different shapes cross. Crossings are left out past `maxSegments` segments,
 * where finding them would slow every move of the pointer.
 */
export function snapFeatures(
  elements: readonly SceneElement[],
  exclude: ReadonlySet<string>,
  maxSegments = 600
): Point[] {
  const shapes = elements
    .filter((el) => !el.hidden && !exclude.has(el.id))
    .map((el) => outlineSegments(el));
  const out: Point[] = [];
  for (const segs of shapes) for (const s of segs) out.push(cubicAt(s, 0.5));
  const total = shapes.reduce((n, segs) => n + segs.length, 0);
  if (total > maxSegments) return out;
  let box: BBox | null = null;
  for (const segs of shapes) {
    for (const s of segs) {
      const h = cubicHull(s);
      if (!box) box = { ...h };
      else {
        const x = Math.min(box.x, h.x);
        const y = Math.min(box.y, h.y);
        box = {
          x,
          y,
          width: Math.max(box.x + box.width, h.x + h.width) - x,
          height: Math.max(box.y + box.height, h.y + h.height) - y,
        };
      }
    }
  }
  if (!box) return out;
  const tol = Math.max(box.width, box.height, 1e-6) * 1e-7;
  const hulls = shapes.map((segs) => segs.map(cubicHull));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      shapes[i]!.forEach((s, si) => {
        shapes[j]!.forEach((r, ri) => {
          if (!boxesOverlap(hulls[i]![si]!, hulls[j]![ri]!, tol)) return;
          const hits = segmentHits(s, r, tol);
          for (const h of hits) out.push(h.p);
        });
      });
    }
  }
  return out;
}
