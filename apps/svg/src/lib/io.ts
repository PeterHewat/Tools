import {
  DEFAULT_STROKE,
  createPath,
  createLine,
  createRect,
  createEllipse,
  createPolyline,
  createPolygon,
  createText,
  hasMarkers,
  isGradient,
  gradientId,
  gradientStops,
  geometryOf,
  localBBox,
  toLocalPoint,
  PAINT_KEYS,
  PAINT_KINDS,
  type PaintKind,
  styleAttrs,
  hasTwoHandles,
  parseDash,
} from "./model.js";
import {
  ELEMENT_SELECTOR,
  cleanColor,
  cleanUnit,
  escapeAttr,
  escapeXml,
  isElementType,
  uid,
} from "./utils.js";
import { groupsOf, normalizeGroups, pruneGroups } from "./groups.js";
import { arcToCubics } from "./arc.js";
import { parseSvg } from "./parse-svg.js";
import {
  IDENTITY,
  applyMatrix,
  isIdentity,
  multiply,
  parseTransform,
  transformElement,
  type Matrix,
} from "./transform.js";
import { MAX_ARTBOARD, PROJECT_VERSION } from "./types.js";
import type {
  Anchor,
  BackgroundPaint,
  EditorState,
  GradientStop,
  MarkerShape,
  ProjectFile,
  Point,
  SceneElement,
  StyleCarrier,
} from "./types.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * The id the artboard background is exported under. It is a plain `<rect>` so the file opens
 * anywhere, and the id is what tells the importer - the live SVG panel, mostly - that this rect
 * is the document's background rather than a shape somebody drew.
 */
const BACKGROUND_ID = "background";

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
  elId?: string;
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

const AUTO_ID_SRC = "[a-f][0-9a-f]{7}";
const AUTO_ID = new RegExp(`^${AUTO_ID_SRC}$`);
const NAMED_ID = new RegExp(`^${AUTO_ID_SRC}_(.+)$`);

/** A user-facing name as it appears in an id: spaces become "_", invalid characters dropped. */
export function sanitizeName(name: string | undefined): string {
  return (name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "");
}

/** The generated-id part of an exported id (`abc12345_name` -> `abc12345`), or null. */
export function elementIdFromSvgId(svgId: string | null | undefined): string | null {
  const m = (svgId || "").match(new RegExp(`^(${AUTO_ID_SRC})(?:_.*)?$`));
  return m ? m[1]! : null;
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

/** A group id as the app writes it, optionally followed by "_" and the group's name. */
const GROUP_ID = /^(group-[A-Za-z0-9-]+)(?:_(.+))?$/;

/** The group id in an exported `<g id>` (`group-57cc1c37_top_view` -> `group-57cc1c37`). */
export function groupIdFromSvgId(svgId: string | null | undefined): string | null {
  return (svgId || "").match(GROUP_ID)?.[1] ?? null;
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
  let i = start;
  while (i < end) {
    const gid = groupsOf(els[i])[depth];
    if (gid) {
      let j = i;
      while (j < end && groupsOf(els[j])[depth] === gid) j++;
      lines.push({ indent, text: `<g id="${groupExportId(gid, groupNames)}">` });
      emitRange(els, i, j, depth + 1, indent + 1, lines, ids, groupNames);
      lines.push({ indent, text: "</g>" });
      i = j;
    } else {
      const el = els[i]!;
      const text = elementToSvgMarkup(el, ids.get(el.id));
      if (text) lines.push({ indent, text, elId: el.id });
      i++;
    }
  }
}

export function formatExportSvg(state: ExportDoc, pretty = false): string {
  const lines = buildSvgLines(state);
  if (pretty) return lines.map((l) => "  ".repeat(l.indent) + l.text).join("\n");
  return lines.map((l) => l.text).join("");
}

export function serializeProject(state: EditorState): ProjectFile {
  return {
    version: PROJECT_VERSION,
    artboard: state.artboard,
    background: state.background,
    grid: state.grid,
    images: state.images,
    elements: state.elements,
    ...optional("groupNames", ofGroupsInUse(state.elements, state.groupNames)),
    ...optional("groupHues", ofGroupsInUse(state.elements, state.groupHues)),
    ...(state.guides.x.length || state.guides.y.length ? { guides: state.guides } : {}),
    tool: state.tool,
    finalOnly: state.finalOnly,
  };
}

/** The entries, by group id, of groups that still exist and have a value (a name, a hue). */
function ofGroupsInUse<T extends string | number>(
  elements: readonly SceneElement[],
  byGroup: Readonly<Record<string, T>>
): Record<string, T> {
  const used = new Set(elements.flatMap((e) => groupsOf(e)));
  return Object.fromEntries(
    Object.entries(byGroup).filter(([gid, v]) => used.has(gid) && v !== "")
  );
}

/** `{ [key]: record }` when the record has anything in it, else nothing: an optional field. */
function optional<K extends string, T>(key: K, record: Record<string, T>) {
  return Object.keys(record).length ? ({ [key]: record } as Record<K, Record<string, T>>) : {};
}

/** Keys whose strings are the person's own words, escaped wherever they are shown. */
const FREE_TEXT = new Set(["name", "text", "fileName", "fontFamily"]);
const MARKUP = /[<>"&]/;

/**
 * Whether data read from outside - a document file, pasted shapes - holds only plain values.
 * Colours, ids and numbers are written into markup in more places than it is sensible to escape
 * each of them, and a file this app wrote never has markup characters in them; one that does was
 * made to break out of an attribute. Free text may hold anything: it is always escaped.
 */
export function isInert(value: unknown, key = ""): boolean {
  if (typeof value === "string") return FREE_TEXT.has(key) || !MARKUP.test(value);
  // IndexedDB keeps undefined properties and NaN, where JSON would not: neither is markup.
  if (value == null || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every((v) => isInert(v, key));
  if (typeof value !== "object") return false;
  // A group's name is keyed by the group's id, which is checked like any other id.
  const inner = (k: string) => (key === "groupNames" ? "name" : k);
  return Object.entries(value).every(([k, v]) => !MARKUP.test(k) && isInert(v, inner(k)));
}

/** What a reference image may point at: pixels carried in the document, never the network. */
const IMAGE_URL = /^data:image\/[\w.+-]+[;,]/;
/** Element, group and image ids as the app writes them. */
const PLAIN_ID = /^[A-Za-z][\w-]*$/;

/**
 * An element from outside, made safe to draw: its colours are `#rrggbb` and its opacities run
 * 0..1, so neither can carry CSS or a URL into a style or a paint, and a style it lacks is the
 * default one, as every element holds a complete set. Null when its id or type is not one the
 * app writes.
 */
export function cleanElement(el: SceneElement): SceneElement | null {
  if (!el || !PLAIN_ID.test(el.id) || !isElementType(el.type)) return null;
  const out = { ...structuredClone(DEFAULT_STROKE), ...el };
  out.stroke = cleanColor(el.stroke);
  out.fill = cleanColor(el.fill);
  out.strokeOpacity = cleanUnit(el.strokeOpacity);
  out.fillOpacity = cleanUnit(el.fillOpacity);
  for (const kind of PAINT_KINDS) {
    const stops = el[PAINT_KEYS[kind].stops];
    if (!Array.isArray(stops)) continue;
    out[PAINT_KEYS[kind].stops] = stops.map((s) => ({
      ...s,
      color: cleanColor(s?.color),
      opacity: cleanUnit(s?.opacity),
    }));
  }
  if (el.groups) out.groups = el.groups.filter((g) => PLAIN_ID.test(g));
  return out;
}

/**
 * A stored document, checked and made safe to draw (see `cleanElement`); reference images must
 * be `data:` images. The fields a file may leave out come back filled in. Throws on something that is not a document, on one written by a newer
 * version of the app than this one, and on one with markup hidden in it or nothing usable left.
 */
export function readProject(raw: unknown): Required<ProjectFile> {
  const json = raw as Partial<ProjectFile> | null;
  const version = json?.version;
  const positive = (n: unknown) => typeof n === "number" && n > 0 && Number.isFinite(n);
  if (
    !json ||
    typeof version !== "number" ||
    version < 1 ||
    !positive(json.artboard?.width) ||
    !positive(json.artboard?.height) ||
    !json.grid ||
    !json.background ||
    !Array.isArray(json.elements) ||
    !Array.isArray(json.images)
  ) {
    throw new Error("This is not an SVG app document.");
  }
  if (version > PROJECT_VERSION) {
    throw new Error(
      "This document was saved by a newer version of this app. Reload the page to update, then open it again."
    );
  }
  const damaged = () => new Error("This document is damaged and cannot be opened.");
  if (!isInert(json)) throw damaged();
  const doc = json as ProjectFile;
  const elements = doc.elements.map(cleanElement).filter((e): e is SceneElement => !!e);
  const images = doc.images
    .filter((img) => PLAIN_ID.test(img?.id) && IMAGE_URL.test(img?.dataUrl))
    .map((img) => ({ ...img, opacity: cleanUnit(img.opacity) }));
  if ((doc.elements.length || doc.images.length) && !elements.length && !images.length) {
    throw damaged();
  }
  return {
    ...doc,
    artboard: {
      width: Math.min(doc.artboard.width, MAX_ARTBOARD),
      height: Math.min(doc.artboard.height, MAX_ARTBOARD),
    },
    background: {
      color: cleanColor(doc.background.color),
      opacity: cleanUnit(doc.background.opacity, 0),
    },
    elements,
    images,
    groupNames: doc.groupNames ?? {},
    groupHues: doc.groupHues ?? {},
    guides: doc.guides ?? { x: [], y: [] },
  };
}

/* ---------- Import ---------- */

/**
 * Parses a path's `d` into anchors with cubic handles, which is the only curve the model has.
 *
 * Everything else is converted: quadratics (Q/T) have an exact cubic equivalent, arcs (A) are
 * approximated by up to four cubics per quarter turn, and the shorthands (S/T) reflect the
 * previous control point. Commands also repeat implicitly - `L 1 1 2 2` is two line segments,
 * and a repeated `M` continues as `L` - which is how most tools write their output.
 */
function parsePathD(d: string): { points: Anchor[]; closed: boolean }[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Anchor[] = [];
  // Each subpath - each M - is an outline of its own: where it starts, and whether a Z closed it.
  const outlines: { start: number; closed: boolean }[] = [];
  // After a Z, drawing on without an M starts a new subpath at the one just closed.
  let afterClose = false;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let subStart: Point | null = null;
  let command = "";
  let relative = false;
  // The control point the smooth shorthands reflect, and which curve kind set it.
  let lastControl: Point | null = null;
  let lastCurve: "cubic" | "quad" | "" = "";

  const readNum = () => parseFloat(tokens[i++] ?? "0");
  const last = (): Anchor | undefined => points[points.length - 1];
  const isCommand = (t: string | undefined) => !!t && /^[a-zA-Z]$/.test(t);

  /** Starts a new outline when the current one is closed, as a drawing command after Z does. */
  const reopen = () => {
    if (!afterClose) return;
    afterClose = false;
    outlines.push({ start: points.length, closed: false });
    const at = subStart ?? { x: cx, y: cy };
    points.push({ x: at.x, y: at.y, smooth: false, hIn: null, hOut: null });
  };

  const corner = (x: number, y: number) => {
    reopen();
    points.push({ x, y, smooth: false, hIn: null, hOut: null });
    lastControl = null;
    lastCurve = "";
  };

  /** Appends a cubic segment from the current point to (x, y). */
  const cubic = (c1: Point, c2: Point, x: number, y: number, kind: "cubic" | "quad") => {
    reopen();
    const from = last();
    if (from) {
      from.hOut = { x: c1.x, y: c1.y };
      from.smooth = true;
    }
    points.push({ x, y, smooth: true, hIn: { x: c2.x, y: c2.y }, hOut: { x, y } });
    lastControl = c2;
    lastCurve = kind;
  };

  /** A quadratic control point becomes the two cubic ones that draw the same curve. */
  const quadToCubic = (q: Point, x: number, y: number) => {
    const from = last() ?? { x: cx, y: cy };
    cubic(
      { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
      { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
      x,
      y,
      "quad"
    );
  };

  /** The reflection of the previous control point, or the current point when there is none. */
  const reflected = (kind: "cubic" | "quad"): Point => {
    const from = last();
    if (!from) return { x: cx, y: cy };
    if (!lastControl || lastCurve !== kind) return { x: from.x, y: from.y };
    return { x: 2 * from.x - lastControl.x, y: 2 * from.y - lastControl.y };
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i++]!;
      relative = command === command.toLowerCase();
      // A repeated moveto draws lines, per the SVG grammar.
    } else if (!command) {
      i++;
      continue;
    } else if (command === "M" || command === "m") {
      command = relative ? "l" : "L";
    }

    const c = command.toUpperCase();
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;

    if (c === "M") {
      cx = readNum() + ox;
      cy = readNum() + oy;
      subStart = { x: cx, y: cy };
      afterClose = false;
      // A move with nothing drawn since the last one replaces it rather than leaving a stray point.
      const open = outlines[outlines.length - 1];
      if (open && open.start === points.length - 1 && !open.closed) points.pop();
      else outlines.push({ start: points.length, closed: false });
      corner(cx, cy);
    } else if (c === "L") {
      cx = readNum() + ox;
      cy = readNum() + oy;
      corner(cx, cy);
    } else if (c === "H") {
      cx = readNum() + ox;
      corner(cx, cy);
    } else if (c === "V") {
      cy = readNum() + oy;
      corner(cx, cy);
    } else if (c === "C" || c === "S") {
      const c1 = c === "C" ? { x: readNum() + ox, y: readNum() + oy } : reflected("cubic");
      const c2 = { x: readNum() + ox, y: readNum() + oy };
      const x = readNum() + ox;
      const y = readNum() + oy;
      cubic(c1, c2, x, y, "cubic");
      cx = x;
      cy = y;
    } else if (c === "Q" || c === "T") {
      const q = c === "Q" ? { x: readNum() + ox, y: readNum() + oy } : reflected("quad");
      const x = readNum() + ox;
      const y = readNum() + oy;
      quadToCubic(q, x, y);
      cx = x;
      cy = y;
    } else if (c === "A") {
      const rx = readNum();
      const ry = readNum();
      const rot = readNum();
      const largeArc = readNum() !== 0;
      const sweep = readNum() !== 0;
      const x = readNum() + ox;
      const y = readNum() + oy;
      for (const seg of arcToCubics({ x: cx, y: cy }, rx, ry, rot, largeArc, sweep, { x, y })) {
        cubic(seg.c1, seg.c2, seg.to.x, seg.to.y, "cubic");
      }
      cx = x;
      cy = y;
    } else if (c === "Z") {
      const outline = outlines[outlines.length - 1];
      const first = outline ? points[outline.start] : undefined;
      const end = last();
      if (subStart && first && end && end !== first && end.x === first.x && end.y === first.y) {
        // A closing curve drawn back onto the start ends on the first anchor. It is that anchor,
        // arriving: keep its incoming handle and drop the copy, or every re-import grows one.
        first.hIn = end.hIn;
        first.smooth = first.smooth || end.smooth;
        points.pop();
      }
      // Otherwise Z is a straight line back to the start, which `closed` already draws: an
      // anchor put there would duplicate the first, and the next import would drop it again.
      cx = subStart?.x ?? cx;
      cy = subStart?.y ?? cy;
      lastControl = null;
      lastCurve = "";
      if (outline && !afterClose) outline.closed = true;
      afterClose = true;
    } else {
      // An unrecognised command: skip its numbers rather than reading them as coordinates.
      while (i < tokens.length && !isCommand(tokens[i])) i++;
    }
  }
  for (const p of points) if (hasTwoHandles(p)) p.smooth = handlesInLine(p);
  return outlines
    .map((o, k) => ({
      points: points.slice(o.start, outlines[k + 1]?.start ?? points.length),
      closed: o.closed,
    }))
    .filter((o) => o.points.length);
}

/**
 * Whether a point's two handles lie on one line through it, pointing away from each other:
 * a smooth point, whose pair should mirror when dragged. Anything else is a cusp, and dragging
 * one of its handles must not swing the other round. The slack allows for coordinates that
 * were rounded to whole units on export, which bends a short handle by a visible angle.
 */
function handlesInLine(p: Anchor): boolean {
  const ax = p.hIn!.x - p.x;
  const ay = p.hIn!.y - p.y;
  const bx = p.hOut!.x - p.x;
  const by = p.hOut!.y - p.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (ax * bx + ay * by >= 0) return false;
  return Math.abs(ax * by - ay * bx) <= 0.05 * la * lb + 0.75 * (la + lb);
}

let colorCtx: CanvasRenderingContext2D | null = null;

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/**
 * Turns any CSS color into #rrggbb; falls back to black.
 *
 * `#rrggbb`, `#rgb` and `rgb()/rgba()` cover what real SVG files contain and are handled here,
 * so import does not depend on a canvas being available. Anything more exotic (named colors,
 * `hsl()`, …) is handed to the browser's own parser.
 */
function normalizeColor(c: string | null): string {
  if (!c) return "#000000";
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short)
    return `#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`.toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (rgb) return `#${hex2(+rgb[1]!)}${hex2(+rgb[2]!)}${hex2(+rgb[3]!)}`;

  if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d");
  if (!colorCtx) return "#000000";
  colorCtx.fillStyle = "#000000";
  colorCtx.fillStyle = s;
  const out = colorCtx.fillStyle;
  return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : "#000000";
}

/**
 * A colour as a file writes it, with its alpha: `#rgb`, `#rrggbbaa`, `rgb()` and `hsl()` with or
 * without one, a name, `transparent`, or `currentColor` (the inherited `color`).
 */
function colorOf(raw: string, node: Element): { color: string; alpha: number } {
  let s = raw.trim();
  if (/^currentcolor$/i.test(s)) s = inheritedProp(node, "color") ?? "#000000";
  if (/^transparent$/i.test(s)) return { color: "#000000", alpha: 0 };
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = hex[1]!;
    const short = h.length === 4;
    const alpha = parseInt(short ? h[3]! + h[3]! : h.slice(6), 16) / 255;
    return { color: normalizeColor(`#${h.slice(0, short ? 3 : 6)}`), alpha };
  }
  const fn = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(s);
  if (fn) {
    const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
    const a = parts[3];
    const alpha = a == null ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    return {
      color: normalizeColor(`${fn[1]}(${parts.slice(0, 3).join(", ")})`),
      alpha: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
    };
  }
  return { color: normalizeColor(s), alpha: 1 };
}

/**
 * A property as the element itself sets it: in its `style` attribute - where the last declaration
 * wins, as the file's stylesheets are written there first (see `applyStylesheets`) - or else as
 * a presentation attribute.
 */
function ownProp(node: Element, name: string): string | null {
  let found: string | null = null;
  const style = node.getAttribute("style");
  if (style) {
    for (const decl of style.split(";")) {
      const i = decl.indexOf(":");
      if (i > 0 && decl.slice(0, i).trim() === name) {
        found = decl
          .slice(i + 1)
          .replace(/!important\s*$/i, "")
          .trim();
      }
    }
  }
  return found ?? node.getAttribute(name);
}

/** As `ownProp`, but walking up to the SVG root so inherited presentation attributes apply. */
function inheritedProp(node: Node | null, name: string): string | null {
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) {
    const v = ownProp(n as Element, name);
    if (v != null) return v;
  }
  return null;
}

function findById(svg: Element, tags: string, id: string): Element | null {
  return [...svg.querySelectorAll(tags)].find((g) => g.getAttribute("id") === id) ?? null;
}

function markerFromRef(svg: Element, ref: string | null): MarkerShape {
  if (!ref || ref === "none") return "none";
  const m = ref.match(/^url\(#([^)]+)\)$/);
  if (!m) return "none";
  const marker = findById(svg, "marker", m[1]!);
  const child = marker?.firstElementChild;
  if (!child) return "arrow";
  const tag = child.tagName.toLowerCase();
  if (tag === "circle") return "dot";
  if (tag === "rect") return "square";
  if (tag === "path" && /L5,10/.test(child.getAttribute("d") ?? "")) return "diamond";
  return "arrow";
}

const GRADIENTS = "linearGradient,radialGradient";

/** A gradient as the importer reads it, before it is placed on a shape. */
interface GradientRead {
  type: "linear" | "radial";
  stops: GradientStop[];
  from: Point;
  to: Point;
  /** In the file's coordinates, rather than in fractions of the shape's box. */
  userSpace: boolean;
}

/**
 * A gradient and the ones it inherits from through `href`, nearest first: Inkscape keeps the
 * stops on one gradient and the geometry on another that points at it.
 */
function gradientChain(svg: Element, id: string): Element[] {
  const chain: Element[] = [];
  for (let g = findById(svg, GRADIENTS, id); g && chain.length < 16 && !chain.includes(g);) {
    chain.push(g);
    const href = hrefOf(g)?.match(/^#(.+)$/);
    g = href ? findById(svg, GRADIENTS, href[1]!) : null;
  }
  return chain;
}

/**
 * The gradient `url(#id)` names, seen through `opacity` (the paint's own and its groups'), which
 * is folded into its stops. Null when there is none, or it has no stops to draw with.
 */
function gradientPaint(svg: Element, id: string, opacity: number): GradientRead | null {
  const chain = gradientChain(svg, id);
  const first = chain[0];
  if (!first) return null;
  const attr = (name: string) =>
    chain.find((g) => g.hasAttribute(name))?.getAttribute(name) ?? null;
  const stopNodes =
    chain
      .map((g) => [...g.children].filter((c) => c.tagName.toLowerCase() === "stop"))
      .find((s) => s.length) ?? [];
  if (!stopNodes.length) return null;
  const stops = stopNodes.map((stop, i) => {
    const { color, alpha } = colorOf(ownProp(stop, "stop-color") ?? "#000000", stop);
    return {
      offset: parseFractional(stop.getAttribute("offset"), i / Math.max(1, stopNodes.length - 1)),
      color,
      opacity: parseFractional(ownProp(stop, "stop-opacity"), 1) * alpha * opacity,
    };
  });
  const radial = first.tagName.toLowerCase() === "radialgradient";
  const num = (a: string, d: number) => parseFractional(attr(a), d);
  let from: Point;
  let to: Point;
  if (radial) {
    const cx = num("cx", 0.5);
    const cy = num("cy", 0.5);
    from = { x: cx, y: cy };
    to = { x: cx + num("r", 0.5), y: cy };
  } else {
    from = { x: num("x1", 0), y: num("y1", 0) };
    to = { x: num("x2", 1), y: num("y2", 0) };
  }
  // A gradientTransform moves the gradient in its own units. Its ends are moved with it, which is
  // exact for the turns, shifts and even scales files use it for; a skew is approximated.
  const gt = parseTransform(attr("gradientTransform"));
  if (!isIdentity(gt)) {
    from = applyMatrix(gt, from);
    to = applyMatrix(gt, to);
  }
  const userSpace = attr("gradientUnits") === "userSpaceOnUse";
  return { type: radial ? "radial" : "linear", stops, from, to, userSpace };
}

/** A gradient coordinate or offset: a plain number, or a percentage. */
function parseFractional(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const value = parseFloat(raw.replace("%", ""));
  if (Number.isNaN(value)) return fallback;
  return raw.includes("%") ? value / 100 : value;
}

/** An element's style as read, and which of its paints still have to be placed on it. */
interface NodeStyle {
  style: StyleCarrier;
  /** Paints whose gradient is in the file's coordinates: see `toBoundingBoxUnits`. */
  userSpace: PaintKind[];
}

/** `opacity` on the element and on every group around it, multiplied. */
function throughOpacity(node: Element, svg: Element): number {
  let o = 1;
  for (let n: Node | null = node; n && n.nodeType === 1; n = n === svg ? null : n.parentNode) {
    o *= parseFractional(ownProp(n as Element, "opacity"), 1);
  }
  return Math.min(1, Math.max(0, o));
}

/**
 * The style an element is drawn with. `opacity` - the element's and its groups' - and a colour's
 * own alpha are folded into each paint's opacity: the same picture wherever fill and stroke do
 * not overlap, and the only way to keep it with no opacity on groups to put it in.
 */
function styleFromNode(node: Element, svg: Element, skipped: Skipped): NodeStyle {
  const through = throughOpacity(node, svg);
  const strokeRaw = inheritedProp(node, "stroke");
  const fillRaw = inheritedProp(node, "fill");
  const hasStroke = strokeRaw != null && strokeRaw !== "none";
  const style: StyleCarrier = {
    stroke: "#000000",
    strokeOpacity: 1,
    strokeWidth: hasStroke ? parseFloat(inheritedProp(node, "stroke-width") || "1") : 0,
    strokeType: "solid",
    linecap: (inheritedProp(node, "stroke-linecap") as StyleCarrier["linecap"]) || "round",
    linejoin: (inheritedProp(node, "stroke-linejoin") as StyleCarrier["linejoin"]) || "round",
    fillEnabled: false,
    fillType: "solid",
    fill: "#000000",
    fillOpacity: through,
  };
  const userSpace: PaintKind[] = [];
  /** Reads one paint into the style; false when it turns out to paint nothing. */
  const paint = (kind: PaintKind, value: string): boolean => {
    const k = PAINT_KEYS[kind];
    const opacity = parseFractional(inheritedProp(node, `${kind}-opacity`), 1) * through;
    let raw = value;
    const ref = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(raw);
    if (ref) {
      const read = gradientPaint(svg, ref[1]!, opacity);
      if (read) {
        const [first] = read.stops;
        Object.assign(style, {
          [k.type]: read.type,
          [k.stops]: read.stops,
          [k.from]: read.from,
          [k.to]: read.to,
          // The first stop doubles as the solid colour, so turning the gradient off keeps something.
          [k.color]: first!.color,
          [k.opacity]: first!.opacity,
        });
        if (read.userSpace) userSpace.push(kind);
        return true;
      }
      if (elementById(svg, ref[1]!)?.tagName.toLowerCase() === "pattern") {
        skip(skipped, "pattern paint");
      }
      // What the file gives to paint instead when the reference cannot be, if anything.
      raw = ref[2]!.trim();
      if (!raw || raw === "none") return false;
    }
    const { color, alpha } = colorOf(raw, node);
    Object.assign(style, { [k.color]: color, [k.opacity]: opacity * alpha });
    return true;
  };
  if (hasStroke && !paint("stroke", strokeRaw)) style.strokeWidth = 0;
  // No fill attribute anywhere and no stroke: SVG's default (black fill) is all that is visible.
  if (fillRaw == null && !hasStroke) style.fillEnabled = true;
  else if (fillRaw != null && fillRaw !== "none") style.fillEnabled = paint("fill", fillRaw);
  if (inheritedProp(node, "display") === "none") style.hidden = true;
  if (inheritedProp(node, "fill-rule") === "evenodd") style.fillRule = "evenodd";
  const dash = parseDash(inheritedProp(node, "stroke-dasharray"));
  if (dash) style.dash = dash;
  const ms = inheritedProp(node, "marker-start");
  const me = inheritedProp(node, "marker-end");
  if (ms) style.markerStart = markerFromRef(svg, ms);
  if (me) style.markerEnd = markerFromRef(svg, me);
  return { style, userSpace };
}

const NON_RENDERED = [
  "defs",
  "marker",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "lineargradient",
  "radialgradient",
];

function insideNonRendered(node: Element, svg: Element): boolean {
  for (let n = node.parentNode; n && n !== svg; n = n.parentNode) {
    const tag = (n as Element).tagName?.toLowerCase();
    if (tag && NON_RENDERED.includes(tag)) return true;
  }
  return false;
}

function parsePoints(str: string | null): Point[] {
  const nums = (str ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i]!, y: nums[i + 1]! });
  return points;
}

/** Name for an imported node: a <title>, the name half of one of our ids, or a foreign id. */
function nameFromNode(node: Element, nodeId: string | null): string | null {
  const titleText = node.querySelector(":scope > title")?.textContent?.trim();
  if (titleText) return titleText;
  if (!nodeId) return null;
  const m = nodeId.match(NAMED_ID);
  if (m) return m[1]!;
  return AUTO_ID.test(nodeId) ? null : nodeId;
}

/**
 * The outlines of one `<path>` as elements: one path holding them all when they are all closed or
 * all open, which is how a shape with holes is drawn. The model closes a path's outlines together,
 * so a `d` that mixes open and closed outlines becomes one path of each kind, side by side.
 */
function pathsFromOutlines(
  outlines: readonly { points: Anchor[]; closed: boolean }[],
  style: StyleCarrier
): SceneElement | SceneElement[] | null {
  if (!outlines.length) return null;
  const build = (group: readonly { points: Anchor[] }[], closed: boolean, id?: string) => {
    const points: Anchor[] = [];
    const subpaths: number[] = [];
    for (const o of group) {
      if (points.length) subpaths.push(points.length);
      points.push(...o.points);
    }
    const path = createPath(points, closed, id ? style : { ...style, id: undefined });
    if (subpaths.length) path.subpaths = subpaths;
    return path;
  };
  const closed = outlines.filter((o) => o.closed);
  const open = outlines.filter((o) => !o.closed);
  if (!open.length || !closed.length) return build(outlines, !!closed.length, style.id);
  return [build(closed, true, style.id), build(open, false)];
}

function elementFromNode(
  node: Element,
  tag: string,
  style: StyleCarrier
): SceneElement | SceneElement[] | null {
  const num = (a: string) => parseFloat(node.getAttribute(a) ?? "");
  switch (tag) {
    case "path": {
      return pathsFromOutlines(parsePathD(node.getAttribute("d") ?? ""), style);
    }
    case "line":
      return createLine(num("x1"), num("y1"), num("x2"), num("y2"), style);
    case "rect": {
      const el = createRect(num("x") || 0, num("y") || 0, num("width"), num("height"), style);
      const rx = num("rx");
      const ry = num("ry");
      el.rx = rx || ry || 0;
      if (rx && ry && rx !== ry) el.ry = ry;
      return el;
    }
    case "circle":
      return createEllipse(num("cx"), num("cy"), num("r"), num("r"), style);
    case "ellipse":
      return createEllipse(num("cx"), num("cy"), num("rx"), num("ry"), style);
    case "polyline":
      return createPolyline(parsePoints(node.getAttribute("points")), style);
    case "polygon":
      return createPolygon(parsePoints(node.getAttribute("points")), style);
    case "text": {
      const el = createText(num("x") || 0, num("y") || 0, node.textContent?.trim() ?? "", style);
      el.fontSize = parseFloat(inheritedProp(node, "font-size") || "48") || 48;
      el.fontFamily = inheritedProp(node, "font-family") || "sans-serif";
      el.anchor = (inheritedProp(node, "text-anchor") as typeof el.anchor) || "start";
      return el;
    }
    default:
      return null;
  }
}

/**
 * Turns a paint's gradient from the file's coordinates into fractions of the shape's own box, as
 * it is stored. `own` placed the shape - its transform and every group's above it - and the
 * gradient with it; a shape that keeps a stored angle has its box in its own unturned frame.
 */
function toBoundingBoxUnits(el: SceneElement, kind: PaintKind, own: Matrix): void {
  const k = PAINT_KEYS[kind];
  const box = localBBox(el);
  if (!box) return;
  const w = box.width || 1;
  const h = box.height || 1;
  const map = (p: Point): Point => {
    const q = toLocalPoint(el, applyMatrix(own, p));
    return { x: (q.x - box.x) / w, y: (q.y - box.y) / h };
  };
  el[k.from] = map(el[k.from]);
  el[k.to] = map(el[k.to]);
}

/* ---------- Before the shapes are read: stylesheets, nested viewports, copies ---------- */

const XLINK = "http://www.w3.org/1999/xlink";

/** Where an element points with `href` (or the older `xlink:href`). */
function hrefOf(el: Element): string | null {
  return (
    el.getAttribute("href") ?? el.getAttributeNS(XLINK, "href") ?? el.getAttribute("xlink:href")
  );
}

function elementById(svg: Element, id: string): Element | null {
  return [...svg.querySelectorAll("[id]")].find((el) => el.getAttribute("id") === id) ?? null;
}

/**
 * What an import left out, counted by what it is: singular, or "one|many" where adding an "s"
 * does not make the plural.
 */
type Skipped = Map<string, number>;

function skip(skipped: Skipped, what: string, n = 1): void {
  if (n > 0) skipped.set(what, (skipped.get(what) ?? 0) + n);
}

/** "2 clip paths", "1 filter": the report, in the order things were met. */
function skippedList(skipped: Skipped): string[] {
  return [...skipped].map(([what, n]) => {
    const [one, many = `${one}s`] = what.split("|");
    return `${n} ${n === 1 ? one : many}`;
  });
}

/** The rules of a stylesheet, @-rules (media queries, fonts, imports) left out. */
function cssRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  for (let i = 0; i < css.length;) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css
      .slice(i, open)
      .replace(/@[^{};]*;/g, "")
      .trim();
    // The block's end, counting nested braces: an @media block holds rules of its own.
    let depth = 1;
    let j = open + 1;
    for (; j < css.length && depth; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
    }
    if (head && !head.startsWith("@"))
      rules.push({ selector: head, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return rules;
}

/** A selector's weight, as CSS ranks it: ids over classes (and attributes) over tags. */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (
    selector
      .replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, " ")
      .match(/[a-z][\w-]*/gi) ?? []
  ).length;
  return ids * 10_000 + classes * 100 + tags;
}

/**
 * The file's `<style>` sheets, applied: every element a rule matches gets the rule's declarations
 * in its own `style`, weakest first and its own `style` last, so reading a property from there
 * (`ownProp`, last one wins) sees what the browser would. Illustrator styles every shape this way,
 * by class. The selectors are the browser's own, through `querySelectorAll`; one it cannot read
 * is passed over.
 */
function applyStylesheets(svg: Element): void {
  const css = [...svg.querySelectorAll("style")]
    .map((s) => s.textContent ?? "")
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (!css.trim()) return;
  const matched = new Map<Element, { rank: number; body: string }[]>();
  let order = 0;
  for (const { selector, body } of cssRules(css)) {
    for (const sel of selector.split(",").map((s) => s.trim())) {
      let hits: Element[];
      try {
        hits = sel ? [...svg.querySelectorAll(sel)] : [];
      } catch {
        continue;
      }
      // Weight first, then the order the rules come in; below 100 000 rules, the two never mix.
      const rank = specificity(sel) * 100_000 + order++;
      for (const el of hits) matched.set(el, [...(matched.get(el) ?? []), { rank, body }]);
    }
  }
  for (const [el, rules] of matched) {
    rules.sort((a, b) => a.rank - b.rank);
    el.setAttribute(
      "style",
      [...rules.map((r) => r.body), el.getAttribute("style") ?? ""].join(";")
    );
  }
}

/** A viewport's attributes, which its contents do not inherit. */
const VIEWPORT_ATTRS = new Set([
  "id",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "preserveAspectRatio",
]);

/**
 * The transform that fits a `<symbol>` or `<svg>`'s viewBox into the size `sized` gives it (the
 * `<use>`, or the nested `<svg>` itself), as preserveAspectRatio says: by default the whole
 * viewBox, scaled evenly and centred. Empty when there is no viewBox to fit.
 */
function viewBoxFit(viewport: Element, sized: Element): string {
  const vb = (viewport.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || !(vb[2]! > 0) || !(vb[3]! > 0)) return "";
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const size = (a: string) => parseFloat(sized.getAttribute(a) ?? viewport.getAttribute(a) ?? "");
  const w = size("width");
  const h = size("height");
  const scales = [w > 0 ? w / vw : NaN, h > 0 ? h / vh : NaN].filter(Number.isFinite);
  const even = scales.length ? Math.min(...scales) : 1;
  const stretch = /^none/.test(viewport.getAttribute("preserveAspectRatio") ?? "");
  const sx = stretch && w > 0 ? w / vw : even;
  const sy = stretch && h > 0 ? h / vh : even;
  const tx = w > 0 ? (w - vw * sx) / 2 : 0;
  const ty = h > 0 ? (h - vh * sy) / 2 : 0;
  return `translate(${tx - vx * sx} ${ty - vy * sy}) scale(${sx} ${sy})`;
}

/**
 * A `<g>` in place of a viewport (a `<symbol>` copied by a `<use>`, or an `<svg>` inside the
 * file): its contents, placed and fitted where the viewport put them. What it does not keep is
 * the clipping to its edges.
 */
function viewportGroup(viewport: Element, sized: Element, extra: string): Element {
  const g = viewport.ownerDocument.createElementNS(NS, "g");
  for (const a of [...viewport.attributes]) {
    if (!VIEWPORT_ATTRS.has(a.localName)) g.setAttribute(a.name, a.value);
  }
  const transform = [extra, viewBoxFit(viewport, sized)].join(" ").trim();
  if (transform) g.setAttribute("transform", transform);
  for (const c of [...viewport.childNodes]) g.appendChild(c.cloneNode(true));
  return g;
}

/** Each `<svg>` inside the file becomes a group, placed and fitted as its viewport placed it. */
function flattenNestedSvgs(svg: Element): void {
  for (const inner of [...svg.querySelectorAll("svg")].reverse()) {
    const x = parseFloat(inner.getAttribute("x") ?? "") || 0;
    const y = parseFloat(inner.getAttribute("y") ?? "") || 0;
    const g = viewportGroup(inner, inner, x || y ? `translate(${x} ${y})` : "");
    const id = inner.getAttribute("id");
    if (id) g.setAttribute("id", id);
    inner.replaceWith(g);
  }
}

/** How many elements `<use>` may copy in all: a file of uses of uses could otherwise grow without end. */
const MAX_USE_COPIES = 20_000;

/** A `<use>`'s own attributes, which the copy it places does not take. */
const USE_OWN = new Set(["x", "y", "width", "height", "href", "transform"]);

/**
 * Every `<use>` replaced by a copy of what it points at, in a `<g>` that carries its position,
 * transform and styles, so the rest of the import sees plain shapes: a sprite's icons, a shape
 * drawn once and placed many times. Uses inside what is copied are expanded on the next pass.
 * One that points nowhere, into another file, or at something holding itself is dropped.
 */
function expandUses(svg: Element, skipped: Skipped): void {
  let budget = MAX_USE_COPIES;
  for (let pass = 0; pass < 8; pass++) {
    const uses = [...svg.querySelectorAll("use")].filter((u) => !insideNonRendered(u, svg));
    if (!uses.length) return;
    for (const use of uses) {
      const id = hrefOf(use)?.match(/^#(.+)$/)?.[1];
      const target = id ? elementById(svg, id) : null;
      const size = target ? target.getElementsByTagName("*").length + 1 : 0;
      if (!target || target.contains(use) || (budget -= size) < 0) {
        skip(skipped, "broken <use> reference");
        use.remove();
        continue;
      }
      const x = parseFloat(use.getAttribute("x") ?? "") || 0;
      const y = parseFloat(use.getAttribute("y") ?? "") || 0;
      const place = [use.getAttribute("transform") ?? "", x || y ? `translate(${x} ${y})` : ""]
        .join(" ")
        .trim();
      const g = use.ownerDocument.createElementNS(NS, "g");
      for (const a of [...use.attributes])
        if (!USE_OWN.has(a.localName)) g.setAttribute(a.name, a.value);
      if (place) g.setAttribute("transform", place);
      const tag = target.tagName.toLowerCase();
      g.appendChild(
        tag === "symbol" || tag === "svg" ? viewportGroup(target, use, "") : target.cloneNode(true)
      );
      use.replaceWith(g);
    }
  }
}

/** Counts, for the report, what the file uses that the app cannot hold. */
function noteSkipped(svg: Element, skipped: Skipped): void {
  const rendered = [...svg.querySelectorAll("*")].filter((el) => !insideNonRendered(el, svg));
  const using = (prop: string) =>
    rendered.filter((el) => /^url\(/.test(ownProp(el, prop)?.trim() ?? "")).length;
  const count = (tag: string) => rendered.filter((el) => el.tagName === tag).length;
  skip(skipped, "clip path", using("clip-path"));
  skip(skipped, "mask", using("mask"));
  skip(skipped, "filter", using("filter"));
  skip(skipped, "embedded image", count("image"));
  skip(skipped, "embedded HTML block", count("foreignObject"));
  skip(skipped, "text path", count("textPath"));
  skip(
    skipped,
    "separately placed text run",
    rendered.filter(
      (el) => el.tagName === "tspan" && ["x", "y", "dx", "dy"].some((a) => el.hasAttribute(a))
    ).length
  );
  skip(skipped, "mid-line marker", using("marker-mid"));
  // Markers the app did not write are shown as the nearest of its own shapes.
  const markers = new Set(
    rendered
      .flatMap((el) => ["marker-start", "marker-end"].map((p) => ownProp(el, p) ?? ""))
      .map((ref) => ref.match(/^url\(#([^)]+)\)/)?.[1])
      .filter((id): id is string => !!id && !id.startsWith("mk-"))
  );
  skip(
    skipped,
    "custom marker, drawn as the nearest built-in one|custom markers, drawn as the nearest built-in ones",
    markers.size
  );
  const animations = ["animate", "animateTransform", "animateMotion", "set"];
  skip(skipped, "animation", [...svg.querySelectorAll(animations.join(","))].length);
  skip(skipped, "script", svg.querySelectorAll("script").length);
}

export interface ImportResult {
  artboard: { width: number; height: number } | null;
  /** The background rect the file carried, or null when it has none: a transparent document. */
  background: BackgroundPaint | null;
  elements: SceneElement[];
  /** Group names read from `<g id>`s, by the group ids the elements carry. */
  groupNames: Record<string, string>;
  /** What the file uses that the app cannot hold, and so left out: "2 clip paths", "1 filter". */
  skipped: string[];
}

/** `keepIds` restores generated ids from the markup (used when editing the SVG text in place). */
export function importSvgFile(text: string, { keepIds = false } = {}): ImportResult {
  const doc = parseSvg(text);
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No SVG root found");
  const skipped: Skipped = new Map();
  applyStylesheets(svg);
  flattenNestedSvgs(svg);
  expandUses(svg, skipped);
  noteSkipped(svg, skipped);

  // The artboard is the viewBox's window, moved to the origin with everything in it; failing a
  // usable viewBox, a plain width and height ("100%" is not a size).
  const size = (w: number, h: number) =>
    w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)
      ? { width: Math.min(w, MAX_ARTBOARD), height: Math.min(h, MAX_ARTBOARD) }
      : null;
  const box = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  let artboard = box.length === 4 ? size(box[2]!, box[3]!) : null;
  const origin: Matrix = artboard ? [1, 0, 0, 1, -box[0]! || 0, -box[1]! || 0] : IDENTITY;
  if (!artboard) {
    const plain = (a: string) => {
      const v = (svg.getAttribute(a) ?? "").trim();
      return /^[\d.]+(px)?$/.test(v) ? parseFloat(v) : NaN;
    };
    artboard = size(plain("width"), plain("height"));
  }

  // The background is a rect like any other; only its id says it is the document's, and it is
  // read here rather than swept up as a shape.
  const bgNode = [...svg.children].find(
    (c) => c.tagName.toLowerCase() === "rect" && c.getAttribute("id") === BACKGROUND_ID
  );
  const background: BackgroundPaint | null = bgNode
    ? {
        color: normalizeColor(bgNode.getAttribute("fill")),
        opacity: parseFractional(bgNode.getAttribute("fill-opacity"), 1),
      }
    : null;

  const imported: SceneElement[] = [];
  const groupIds = new Map<Element, string>();
  const groupNames: Record<string, string> = {};
  const usedIds = new Set<string>();
  svg.querySelectorAll(ELEMENT_SELECTOR).forEach((node) => {
    if (node === bgNode) return;
    if (insideNonRendered(node, svg)) return;
    const { style, userSpace } = styleFromNode(node, svg, skipped);
    const nodeId = node.getAttribute("id");
    const name = nameFromNode(node, nodeId);
    if (name) style.name = name;
    const { chain, matrix } = ancestry(node, svg, groupIds, groupNames, keepIds);
    if (chain.length) style.groups = chain;
    const made = elementFromNode(node, node.tagName.toLowerCase(), style);
    if (!made) return;
    const own = multiply(origin, multiply(matrix, parseTransform(node.getAttribute("transform"))));
    (Array.isArray(made) ? made : [made]).forEach((el, k) => {
      // The id the markup names goes to the first element it became.
      if (keepIds && k === 0) {
        const rid = elementIdFromSvgId(nodeId);
        if (rid && !usedIds.has(rid)) el.id = rid;
        usedIds.add(el.id);
      }
      // An element's own transform, and every <g transform> above it, are baked into the
      // coordinates here: the scene graph has no transform of its own.
      const placed = isIdentity(own) ? el : transformElement(el, own);
      for (const kind of userSpace) toBoundingBoxUnits(placed, kind, own);
      imported.push(placed);
    });
  });

  const elements = normalizeGroups(pruneGroups(imported));
  // Names only for the groups that survived pruning (a group of one is no group).
  return {
    artboard,
    background,
    elements,
    groupNames: ofGroupsInUse(elements, groupNames),
    skipped: skippedList(skipped),
  };
}

/**
 * Walks from the SVG root down to `node`: the chain of groups it belongs to (outermost first)
 * and the transform those groups apply to it.
 */
function ancestry(
  node: Element,
  svg: Element,
  groupIds: Map<Element, string>,
  groupNames: Record<string, string>,
  keepIds: boolean
): { chain: string[]; matrix: Matrix } {
  const groups: Element[] = [];
  for (let g = node.parentNode; g && g !== svg; g = g.parentNode) {
    const gEl = g as Element;
    if (gEl.tagName?.toLowerCase() === "g") groups.unshift(gEl);
  }
  const chain: string[] = [];
  let matrix: Matrix = IDENTITY;
  for (const gEl of groups) {
    if (!groupIds.has(gEl)) {
      // Our own ids carry the group's name after the first "_"; any other id is itself a name,
      // the way a foreign id on a shape is.
      const raw = gEl.getAttribute("id") ?? "";
      const own = raw.match(GROUP_ID);
      const gid = keepIds && own ? own[1]! : uid("group");
      const name = own ? own[2] : raw;
      groupIds.set(gEl, gid);
      if (name) groupNames[gid] = name;
    }
    chain.push(groupIds.get(gEl)!);
    matrix = multiply(matrix, parseTransform(gEl.getAttribute("transform")));
  }
  return { chain, matrix };
}
