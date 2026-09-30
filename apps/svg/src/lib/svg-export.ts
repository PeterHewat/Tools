import {
  hasMarkers,
  isGradient,
  gradientId,
  gradientStops,
  geometryOf,
  localBBox,
  PAINT_KEYS,
  PAINT_KINDS,
  type PaintKind,
  styleAttrs,
} from "./model.js";
import { escapeAttr, escapeXml } from "./utils.js";
import { childBlocks, groupsOf } from "./groups.js";

import type { BackgroundPaint, EditorState, Point, SceneElement } from "./types.js";

import { BACKGROUND_ID, sanitizeName } from "./svg-names.js";

const NS = "http://www.w3.org/2000/svg";

/* ---------- Export ---------- */

const n3 = (n: number) => String(+Number(n).toFixed(3));

interface MarkerDef {
  /** Where on the marker the line's end point falls, in its 10-unit box. */
  refX: number | ((cap: SceneElement["linecap"]) => number);
  markup: (fill: string) => string;
}

/**
 * The arrow's tip goes past the end point far enough to cover the line's cap: the head is four
 * stroke widths long and wide (2.5 box units to a width), so the stroke under it is hidden only
 * where the head is wider than the line. A round cap is a half disc of half a width, covered from
 * 1.12 widths back from the tip (1.2 taken); a butt end needs 1 width; a square cap, reaching half
 * a width further, 1.5.
 */
const ARROW_REF_X: Record<SceneElement["linecap"], number> = { round: 7, butt: 7.5, square: 6.25 };

const MARKER_SHAPE_DEFS: Record<string, MarkerDef> = {
  arrow: {
    refX: (cap) => ARROW_REF_X[cap] ?? 7,
    markup: (f) => `<path d="M0,0 L10,5 L0,10 z" ${f}/>`,
  },
  dot: { refX: 5, markup: (f) => `<circle cx="5" cy="5" r="5" ${f}/>` },
  square: { refX: 5, markup: (f) => `<rect width="10" height="10" ${f}/>` },
  diamond: { refX: 5, markup: (f) => `<path d="M5,0 L10,5 L5,10 L0,5 z" ${f}/>` },
};

/**
 * Geometry is stored as floats internally (needed for smooth dragging and Alt-align), but the
 * exported/previewed SVG reads as clean integers. Only coordinates are rounded; style values
 * like stroke-width stay as the user set them.
 */
export function elementToSvgMarkup(el: SceneElement, exportId: string = el.id): string {
  const g = geometryOf(el, Math.round);
  if (!g) return "";
  const attrs = { id: exportId, ...g.attrs, ...styleAttrs(el) };
  const open = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  return g.text !== undefined
    ? `<${g.tag} ${open}>${escapeXml(g.text)}</${g.tag}>`
    : `<${g.tag} ${open}/>`;
}

interface Line {
  indent: number;
  text: string;
}

/** Gradient and marker definitions needed by the elements. */
function buildDefsLines(elements: readonly SceneElement[]): Line[] {
  const lines: Line[] = [];
  for (const el of elements) {
    for (const kind of PAINT_KINDS)
      if (isGradient(el, kind)) lines.push(...gradientLines(el, kind));
    if (hasMarkers(el)) {
      for (const end of ["start", "end"] as const) {
        const shape = MARKER_SHAPE_DEFS[end === "start" ? el.markerStart : el.markerEnd];
        if (!shape) continue;
        const opacity = el.strokeOpacity !== 1 ? ` fill-opacity="${el.strokeOpacity}"` : "";
        lines.push({
          indent: 0,
          text: `<marker id="mk-${escapeAttr(el.id)}-${end}" viewBox="0 0 10 10" refX="${typeof shape.refX === "number" ? shape.refX : shape.refX(el.linecap)}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">`,
        });
        lines.push({ indent: 1, text: shape.markup(`fill="${escapeAttr(el.stroke)}"${opacity}`) });
        lines.push({ indent: 0, text: "</marker>" });
      }
    }
  }
  return lines;
}

/**
 * One paint's gradient. The fill's runs in fractions of the shape's box (`objectBoundingBox`),
 * as it is stored. The stroke's is written in the shape's own coordinates (`userSpaceOnUse`):
 * a box-relative gradient on a shape with no height - a horizontal line - is not drawn at all,
 * and a line is exactly what a stroke is most often.
 */
function gradientLines(el: SceneElement, kind: PaintKind): Line[] {
  const k = PAINT_KEYS[kind];
  let from = el[k.from];
  let to = el[k.to];
  let units = "";
  if (kind === "stroke") {
    const box = localBBox(el) ?? { x: 0, y: 0, width: 1, height: 1 };
    const at = (p: Point): Point => ({
      x: box.x + p.x * (box.width || 1),
      y: box.y + p.y * (box.height || 1),
    });
    from = at(from);
    to = at(to);
    units = ' gradientUnits="userSpaceOnUse"';
  }
  const id = escapeAttr(gradientId(el, kind));
  const radial = el[k.type] === "radial";
  const open = radial
    ? `<radialGradient id="${id}"${units} cx="${n3(from.x)}" cy="${n3(from.y)}" r="${n3(Math.hypot(to.x - from.x, to.y - from.y) || 0.5)}">`
    : `<linearGradient id="${id}"${units} x1="${n3(from.x)}" y1="${n3(from.y)}" x2="${n3(to.x)}" y2="${n3(to.y)}">`;
  return [
    { indent: 0, text: open },
    ...gradientStops(el, kind).map((stop) => ({
      indent: 1,
      text: `<stop offset="${n3(stop.offset)}" stop-color="${escapeAttr(stop.color)}" stop-opacity="${n3(stop.opacity)}"/>`,
    })),
    { indent: 0, text: radial ? "</radialGradient>" : "</linearGradient>" },
  ];
}

/** Compact (single-line) defs markup, used for the live canvas. */
export function buildDefsMarkup(elements: readonly SceneElement[]): string {
  return buildDefsLines(elements)
    .map((l) => l.text)
    .join("");
}

/**
 * Exported id per element: the generated id (always kept, unique) followed by "_" and the
 * user's name. Only the first "_" separates the two, so names may contain underscores.
 */
function exportIds(elements: readonly SceneElement[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of elements) {
    const base = sanitizeName(el.name);
    out.set(el.id, base ? `${el.id}_${base}` : el.id);
  }
  return out;
}

/** What export needs from the document: no selection, no viewport, nothing live. */
export type ExportDoc = Pick<EditorState, "artboard" | "elements"> & {
  background?: BackgroundPaint | null;
  groupNames?: Readonly<Record<string, string>>;
};

/** A group's id in the file: its own id, then "_" and its name when it has one. */
function groupExportId(gid: string, names: Readonly<Record<string, string>> = {}): string {
  const name = sanitizeName(names[gid]);
  return name ? `${gid}_${name}` : gid;
}

function buildSvgLines(state: ExportDoc): Line[] {
  const ids = exportIds(state.elements);
  const width = Math.round(state.artboard.width);
  const height = Math.round(state.artboard.height);
  const lines: Line[] = [
    {
      indent: 0,
      text: `<svg xmlns="${NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    },
  ];
  const defs = buildDefsLines(state.elements);
  if (defs.length) {
    lines.push({ indent: 1, text: "<defs>" });
    defs.forEach((d) => lines.push({ indent: 2 + d.indent, text: d.text }));
    lines.push({ indent: 1, text: "</defs>" });
  }
  const bg = state.background;
  if (bg && bg.opacity > 0) {
    const alpha = bg.opacity < 1 ? ` fill-opacity="${n3(bg.opacity)}"` : "";
    lines.push({
      indent: 1,
      text: `<rect id="${BACKGROUND_ID}" width="${width}" height="${height}" fill="${bg.color}"${alpha}/>`,
    });
  }
  emitRange(state.elements, 0, state.elements.length, 0, 1, lines, ids, state.groupNames ?? {});
  lines.push({ indent: 0, text: "</svg>" });
  return lines;
}

/**
 * Writes one level of the document, opening a `<g>` for each run of elements that share a group
 * at this depth and recursing into it. Members of a group are contiguous (see groups.ts), so a
 * group is always exactly one `<g>`.
 */
function emitRange(
  els: readonly SceneElement[],
  start: number,
  end: number,
  depth: number,
  indent: number,
  lines: Line[],
  ids: Map<string, string>,
  groupNames: Readonly<Record<string, string>>
): void {
  for (const block of childBlocks(els, { start, end }, depth)) {
    const gid = groupsOf(els[block.start])[depth];
    if (gid) {
      lines.push({ indent, text: `<g id="${groupExportId(gid, groupNames)}">` });
      emitRange(els, block.start, block.end, depth + 1, indent + 1, lines, ids, groupNames);
      lines.push({ indent, text: "</g>" });
    } else {
      const el = els[block.start]!;
      const text = elementToSvgMarkup(el, ids.get(el.id));
      if (text) lines.push({ indent, text });
    }
  }
}

export function formatExportSvg(state: ExportDoc, pretty = false): string {
  const lines = buildSvgLines(state);
  if (pretty) return lines.map((l) => "  ".repeat(l.indent) + l.text).join("\n");
  return lines.map((l) => l.text).join("");
}
