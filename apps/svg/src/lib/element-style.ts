import { cleanColor, cleanUnit } from "./utils.js";
import type { ElementType, GradientStop, SceneElement, StyleCarrier, StyleProps } from "./types.js";

export const DEFAULT_STROKE: StyleProps = {
  stroke: "#000000",
  strokeOpacity: 1,
  strokeWidth: 2,
  strokeType: "solid",
  strokeStops: [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 1 },
  ],
  strokeFrom: { x: 0, y: 0.5 },
  strokeTo: { x: 1, y: 0.5 },
  linecap: "round",
  linejoin: "round",
  fillEnabled: false,
  fillType: "solid",
  fill: "#000000",
  fillOpacity: 1,
  fillStops: [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 1 },
  ],
  fillFrom: { x: 0, y: 0.5 },
  fillTo: { x: 1, y: 0.5 },
  markerStart: "none",
  markerEnd: "none",
};

/** Complete, owned style data at construction and file boundaries; readers need no defaults. */
export function completeStyle(style: Partial<StyleProps>): StyleProps {
  const input = style as Record<string, unknown>;
  const out = structuredClone(
    Object.fromEntries(
      Object.entries(DEFAULT_STROKE).map(([key, fallback]) => [key, input[key] ?? fallback])
    )
  ) as unknown as StyleProps;
  for (const kind of PAINT_KINDS) {
    const k = PAINT_KEYS[kind];
    out[k.color] = cleanColor(out[k.color]);
    out[k.opacity] = cleanUnit(out[k.opacity]);
    if (!["solid", "linear", "radial"].includes(out[k.type])) out[k.type] = "solid";
    const stops = Array.isArray(out[k.stops])
      ? out[k.stops]
          .filter((s) => s && Number.isFinite(s.offset))
          .map((s) => ({
            offset: cleanUnit(s.offset, 0),
            color: cleanColor(s.color),
            opacity: cleanUnit(s.opacity),
          }))
      : [];
    out[k.stops] =
      stops.length >= 2
        ? stops.sort((a, b) => a.offset - b.offset)
        : [
            { offset: 0, color: out[k.color], opacity: out[k.opacity] },
            { offset: 1, color: "#ffffff", opacity: 1 },
          ];
    for (const key of [k.from, k.to]) {
      const p = out[key];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
        out[key] = { ...DEFAULT_STROKE[key] };
    }
  }
  for (const key of ["markerStart", "markerEnd"] as const) {
    if (!MARKER_SHAPES.includes(out[key])) out[key] = "none";
  }
  if (!["round", "butt", "square"].includes(out.linecap)) out.linecap = DEFAULT_STROKE.linecap;
  if (!["round", "miter", "bevel"].includes(out.linejoin)) out.linejoin = DEFAULT_STROKE.linejoin;
  out.strokeWidth = Number.isFinite(out.strokeWidth)
    ? Math.max(0, out.strokeWidth)
    : DEFAULT_STROKE.strokeWidth;
  out.fillEnabled = out.fillEnabled === true;
  return out;
}

/** Keys copied when an element is converted from one type to another: identity plus every style. */
const STYLE_KEYS: readonly string[] = [
  "name",
  "groups",
  "hidden",
  "fillRule",
  "dash",
  "locked",
  ...Object.keys(DEFAULT_STROKE),
];

export function styleOf(el: SceneElement): StyleCarrier {
  const src = el as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) if (src[k] !== undefined) out[k] = structuredClone(src[k]);
  return out as StyleCarrier;
}

export const MARKER_TYPES: readonly ElementType[] = ["line", "polyline", "path"];
export const MARKER_SHAPES = ["none", "arrow", "dot", "square", "diamond"] as const;

export type AttrMap = Record<string, string | number | null | undefined>;

/* ---------- Paints: the fill and the stroke ---------- */

/** Which of a shape's two paints. */
export type PaintKind = "fill" | "stroke";

/** The fields that hold each paint, so code that handles a paint handles either. */
export const PAINT_KEYS = {
  fill: {
    type: "fillType",
    color: "fill",
    opacity: "fillOpacity",
    stops: "fillStops",
    from: "fillFrom",
    to: "fillTo",
  },
  stroke: {
    type: "strokeType",
    color: "stroke",
    opacity: "strokeOpacity",
    stops: "strokeStops",
    from: "strokeFrom",
    to: "strokeTo",
  },
} as const satisfies Record<PaintKind, Record<string, keyof StyleProps>>;

export const PAINT_KINDS: readonly PaintKind[] = ["fill", "stroke"];

/** Whether the paint is drawn at all: a fill switched on, a stroke with a width. */
function paintShown(el: SceneElement, kind: PaintKind): boolean {
  return kind === "fill" ? !!el.fillEnabled : el.strokeWidth > 0;
}

/** A paint's stops, in offset order, always at least two so a gradient is well formed. */
export function gradientStops(el: SceneElement, kind: PaintKind = "fill"): GradientStop[] {
  const k = PAINT_KEYS[kind];
  return [...el[k.stops]].sort((a, b) => a.offset - b.offset);
}

/** Whether a paint is drawn as a gradient. */
export function isGradient(el: SceneElement, kind: PaintKind = "fill"): boolean {
  const type = el[PAINT_KEYS[kind].type];
  return paintShown(el, kind) && (type === "linear" || type === "radial");
}

/** The id of a paint's gradient in the markup: the fill's is `grad-<id>`, the stroke's too, with `-stroke`. */
export function gradientId(el: SceneElement, kind: PaintKind): string {
  return kind === "fill" ? `grad-${el.id}` : `grad-${el.id}-stroke`;
}

/** Value for the SVG `fill` or `stroke` attribute: none, a solid color, or a gradient reference. */
function paintValue(el: SceneElement, kind: PaintKind): string {
  if (!paintShown(el, kind)) return "none";
  if (isGradient(el, kind)) return `url(#${gradientId(el, kind)})`;
  return el[PAINT_KEYS[kind].color];
}

/**
 * Whether line ends are drawn. A marker is sized in stroke widths, and with no stroke the SVG
 * falls back to a width of 1 - so without this, a line of width 0 would still show its arrows.
 */
export function hasMarkers(el: SceneElement): boolean {
  return MARKER_TYPES.includes(el.type) && el.strokeWidth > 0;
}

/**
 * Presentation attributes, shared by the canvas renderer and the SVG exporter. Opacity is
 * emitted only when not fully opaque, and a zero-width stroke exports as `stroke="none"`,
 * so the markup stays minimal and the canvas matches the file.
 */
export function styleAttrs(el: SceneElement): AttrMap {
  const attrs: AttrMap = {};
  // The canvas renders from these same attributes, so this hides it there and in the file alike.
  if (el.hidden) attrs.display = "none";
  attrs.stroke = paintValue(el, "stroke");
  if (paintShown(el, "stroke")) {
    attrs["stroke-width"] = el.strokeWidth;
    attrs["stroke-linecap"] = el.linecap;
    attrs["stroke-linejoin"] = el.linejoin;
    // A gradient carries its opacity in its stops.
    if (!isGradient(el, "stroke") && el.strokeOpacity !== 1) {
      attrs["stroke-opacity"] = el.strokeOpacity;
    }
    if (el.dash?.length) attrs["stroke-dasharray"] = el.dash.join(" ");
  }
  attrs.fill = paintValue(el, "fill");
  if (el.fillRule === "evenodd") attrs["fill-rule"] = "evenodd";
  if (el.fillEnabled && !isGradient(el) && el.fillOpacity !== 1) {
    attrs["fill-opacity"] = el.fillOpacity;
  }
  if (hasMarkers(el)) {
    if (el.markerStart !== "none") {
      attrs["marker-start"] = `url(#mk-${el.id}-start)`;
    }
    if (el.markerEnd !== "none") {
      attrs["marker-end"] = `url(#mk-${el.id}-end)`;
    }
  }
  return attrs;
}

/**
 * A dash pattern from what someone typed or a file said: lengths separated by spaces or commas.
 * Absent for a solid line - nothing to read, "none", a negative length, or nothing but zeros,
 * which SVG draws solid as well.
 */
export function parseDash(raw: string | null | undefined): number[] | undefined {
  const text = (raw ?? "").trim();
  if (!text || text === "none") return undefined;
  const parts = text.split(/[\s,]+/).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.every((n) => n === 0)) {
    return undefined;
  }
  return parts;
}
