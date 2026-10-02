/**
 * How a code looks, as a scene of filled paths: the same scene is written as SVG and drawn on a
 * canvas for PNG (`render.ts`), so both exports match.
 *
 * Every coordinate is a whole number of units, `unit` of them to a module (a QR module, a
 * barcode's narrowest bar), quiet zone included: one unit for a plain code, ten when shapes,
 * a logo or a frame need tenths of a module. Paths move relative to the last subpath, so the
 * SVG is short and has no decimals, and every edge on a module line lands on whole pixels.
 */
import { QUIET_ZONE } from "./qr.js";
import type { QrCode } from "./qr.js";
import type { Barcode, BarcodeKind } from "./barcode.js";
import { contrast, flatten, luminance, parseHex } from "@tools/ui";

export const MODULE_SHAPES = [
  "square",
  "rounded",
  "soft",
  "dots",
  "diamond",
  "vertical",
  "horizontal",
] as const;
export const EYE_FRAMES = ["square", "rounded", "circle", "leaf"] as const;
export const EYE_BALLS = ["square", "rounded", "circle", "diamond", "leaf"] as const;
export const GRADIENTS = ["diagonal", "horizontal", "vertical", "radial"] as const;
export const FRAMES = ["none", "below", "above", "outline"] as const;
export type ModuleShape = (typeof MODULE_SHAPES)[number];
export type EyeFrame = (typeof EYE_FRAMES)[number];
export type EyeBall = (typeof EYE_BALLS)[number];
export type GradientKind = (typeof GRADIENTS)[number];
export type FrameStyle = (typeof FRAMES)[number];

/** A logo: an image (a data: URL), or SVG markup drawn in a box of its width and height. */
export interface Logo {
  href?: string;
  markup?: string;
  /** Natural size, for its aspect ratio (and the markup's box). */
  width: number;
  height: number;
}
/** Every colour is "#rrggbb", or "#rrggbbaa" when not fully opaque. */
export interface Design {
  foreground: string;
  /** Transparent at alpha 0. */
  background: string;
  /** The code's colour runs from `foreground` to `to`. */
  gradient?: { to: string; kind: GradientKind };
  /** The three corner squares in a colour of their own. */
  eyeColor?: string;
  modules: ModuleShape;
  eyeFrame: EyeFrame;
  eyeBall: EyeBall;
  logo?: Logo;
  frame: FrameStyle;
  caption: string;
  captionColor: string;
  frameColor: string;
}
export const DEFAULT_DESIGN: Design = {
  foreground: "#000000",
  background: "#ffffff",
  modules: "square",
  eyeFrame: "square",
  eyeBall: "square",
  frame: "none",
  caption: "SCAN ME",
  captionColor: "#ffffff",
  frameColor: "#000000",
};
/**
 * A logo's width as a share of the code's: as large as error correction H recovers from
 * comfortably (a ninth of the modules covered), so every logo is drawn this size.
 */
export const LOGO_SHARE = 0.3;

/**
 * The code a new tab starts with, and the one on the index card (scripts/codes-art.ts): the
 * site's own address, in its colours, with a link logo and a caption.
 */
export const EXAMPLE = {
  link: "https://peterhewat.github.io/Tools/",
  logo: "link",
  design: {
    ...DEFAULT_DESIGN,
    foreground: "#4f86e8",
    gradient: { to: "#8a5cf0", kind: "radial" },
    modules: "rounded",
    eyeFrame: "leaf",
    eyeBall: "leaf",
    frame: "below",
    frameColor: "#5b6fe6",
  },
} as const satisfies { link: string; logo: string; design: Design };

export interface Gradient {
  kind: "linear" | "radial";
  from: string;
  to: string;
  /** Linear: from (x1, y1) to (x2, y2). Radial: centred on (x1, y1), out to radius r. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}
export type Paint = string | Gradient;
export interface Layer {
  d: string;
  paint: Paint;
  evenOdd?: boolean;
  /** Edges on whole modules: drawn without anti-aliasing in SVG. */
  crisp?: boolean;
}
export interface Caption {
  text: string;
  /** Centre of the text, and its baseline. */
  x: number;
  y: number;
  size: number;
  color: string;
  font: string;
  weight: number;
}
export interface Scene {
  /** Units to a module. */
  unit: number;
  /** In units: always a whole number of modules. */
  width: number;
  height: number;
  /** Fills everything behind an unframed code; none for a fully transparent background. */
  background?: string;
  layers: Layer[];
  /** The logo, placed: its image or markup, and the markup's own box. */
  image?: { logo: Logo; x: number; y: number; width: number; height: number };
  caption?: Caption;
}
/** How wide a text is at a font size, in the same units: a canvas measures it in the page. */
export type Measure = (text: string, size: number, font: string, weight: number) => number;
export const estimateText: Measure = (text, size) => [...text].length * size * 0.62;

export const CAPTION_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Numbers in path data: a space between them, none before a minus sign. */
const numbers = (...values: number[]) =>
  values.map((value, i) => (i && value >= 0 ? " " : "") + value).join("");

/**
 * Path data in whole units, from coordinates in modules. Each subpath starts with a move
 * relative to the start of the one before (where the last "z" left the pen); its segments are
 * relative too, so the numbers stay small.
 */
export class PathData {
  private out = "";
  private x = 0;
  private y = 0;
  constructor(readonly unit: number) {}
  private u(value: number): number {
    return Math.round(value * this.unit);
  }
  move(x: number, y: number): this {
    const ux = this.u(x),
      uy = this.u(y);
    this.out += this.out ? "m" + numbers(ux - this.x, uy - this.y) : "M" + numbers(ux, uy);
    this.x = ux;
    this.y = uy;
    return this;
  }
  h(dx: number): this {
    if (this.u(dx)) this.out += "h" + this.u(dx);
    return this;
  }
  v(dy: number): this {
    if (this.u(dy)) this.out += "v" + this.u(dy);
    return this;
  }
  line(dx: number, dy: number): this {
    this.out += "l" + numbers(this.u(dx), this.u(dy));
    return this;
  }
  arc(r: number, dx: number, dy: number): this {
    if (r) this.out += "a" + numbers(this.u(r), this.u(r), 0, 0, 1, this.u(dx), this.u(dy));
    return this;
  }
  close(): this {
    this.out += "z";
    return this;
  }
  /** A rectangle with each corner's own radius (top-left, top-right, bottom-right, bottom-left). */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: readonly [number, number, number, number] | number = 0
  ): this {
    const [tl, tr, br, bl] = typeof radii === "number" ? [radii, radii, radii, radii] : radii;
    this.move(x + tl, y)
      .h(w - tl - tr)
      .arc(tr, tr, tr)
      .v(h - tr - br)
      .arc(br, -br, br)
      .h(-(w - br - bl))
      .arc(bl, -bl, -bl);
    // With a square top-left corner, "z" draws the last side.
    if (tl) this.v(-(h - bl - tl)).arc(tl, tl, -tl);
    return this.close();
  }
  /** A diamond with its corners at the middle of each side of the square. */
  diamond(x: number, y: number, side: number): this {
    const half = side / 2;
    return this.move(x + half, y)
      .line(half, half)
      .line(-half, half)
      .line(-half, -half)
      .close();
  }
  toString(): string {
    return this.out;
  }
}

export type Corner = "tl" | "tr" | "bl";
/** The radii of a leaf: every corner rounded but the one that faces the middle of the code. */
const leaf = (corner: Corner, r: number): [number, number, number, number] =>
  corner === "tl" ? [r, r, 0, r] : corner === "tr" ? [r, r, r, 0] : [r, 0, r, r];

/** A corner square's 7 × 7 frame, its hole as a second subpath (drawn even-odd). */
export function eyeFrame(path: PathData, style: EyeFrame, corner: Corner, x: number, y: number) {
  const [outer, inner] =
    style === "square"
      ? [0, 0]
      : style === "rounded"
        ? [2.2, 1.3]
        : style === "circle"
          ? [3.5, 2.5]
          : ([leaf(corner, 3), leaf(corner, 2)] as const);
  path.rect(x, y, 7, 7, outer).rect(x + 1, y + 1, 5, 5, inner);
}
/** A corner square's 3 × 3 centre, its top-left corner at (x, y). */
export function eyeBall(path: PathData, style: EyeBall, corner: Corner, x: number, y: number) {
  if (style === "diamond") {
    path.diamond(x - 0.2, y - 0.2, 3.4);
    return;
  }
  const radii =
    style === "square"
      ? 0
      : style === "rounded"
        ? 0.9
        : style === "circle"
          ? 1.5
          : leaf(corner, 1.4);
  path.rect(x, y, 3, 3, radii);
}

/** The dark modules in a shape; `on` says which are drawn (false off the grid). */
export function modulesPath(
  path: PathData,
  size: number,
  on: (x: number, y: number) => boolean,
  shape: ModuleShape,
  ox: number,
  oy: number
): PathData {
  if (shape === "square" || shape === "horizontal" || shape === "vertical") {
    // Runs of dark modules in a row (or a column), each one rectangle or pill.
    const across = shape !== "vertical";
    for (let a = 0; a < size; a++)
      for (let b = 0; b < size; b++) {
        const at = (i: number) => (across ? on(i, a) : on(a, i));
        if (!at(b)) continue;
        const start = b;
        while (b + 1 < size && at(b + 1)) b++;
        const length = b - start + 1;
        if (shape === "square")
          if (across)
            path
              .move(ox + start, oy + a)
              .h(length)
              .v(1)
              .h(-length)
              .close();
          else
            path
              .move(ox + a, oy + start)
              .h(1)
              .v(length)
              .h(-1)
              .close();
        else if (across) path.rect(ox + start, oy + a + 0.1, length, 0.8, 0.4);
        else path.rect(ox + a + 0.1, oy + start, 0.8, length, 0.4);
      }
    return path;
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!on(x, y)) continue;
      const px = ox + x,
        py = oy + y;
      if (shape === "dots") path.rect(px + 0.1, py + 0.1, 0.8, 0.8, 0.4);
      else if (shape === "soft") path.rect(px + 0.1, py + 0.1, 0.8, 0.8, 0.3);
      else if (shape === "diamond") path.diamond(px, py, 1);
      else {
        // Rounded: a corner rounds where neither of the modules beside it is dark.
        const n = on(x, y - 1),
          s = on(x, y + 1),
          w = on(x - 1, y),
          e = on(x + 1, y);
        const r = (round: boolean) => (round ? 0.5 : 0);
        path.rect(px, py, 1, 1, [r(!n && !w), r(!n && !e), r(!s && !e), r(!s && !w)]);
      }
    }
  return path;
}

/** The code's paint, across its modules (x, y, w, h in modules) and written in units. */
function gradientPaint(
  design: Design,
  unit: number,
  x: number,
  y: number,
  w: number,
  h: number
): Paint {
  if (!design.gradient) return design.foreground;
  const { kind, to } = design.gradient;
  const u = (value: number) => Math.round(value * unit);
  if (kind === "radial")
    return {
      kind: "radial",
      from: design.foreground,
      to,
      x1: u(x + w / 2),
      y1: u(y + h / 2),
      x2: 0,
      y2: 0,
      r: u(Math.max(w, h) * 0.75),
    };
  return {
    kind: "linear",
    from: design.foreground,
    to,
    x1: u(x),
    y1: u(y),
    x2: u(kind === "vertical" ? x : x + w),
    y2: u(kind === "horizontal" ? y : y + h),
    r: 0,
  };
}

/**
 * The frame around a code and its caption, in whole modules: the panel the code sits on, and
 * the size of the whole.
 */
function framed(
  side: number,
  design: Design,
  unit: number,
  measure: Measure
): {
  width: number;
  height: number;
  panel: { x: number; y: number };
  layers: Layer[];
  caption?: Caption;
} {
  if (design.frame === "none")
    return { width: side, height: side, panel: { x: 0, y: 0 }, layers: [] };
  const text = design.caption.trim();
  const outline = design.frame === "outline",
    above = design.frame === "above";
  // A band of the frame's colour around the panel; an outline is a thin line a module out.
  const border = outline ? 1 : Math.max(1, Math.round(side * 0.04));
  const band = text ? Math.round(side * (outline ? 0.18 : 0.2)) : outline ? 0 : border;
  const width = side + 2 * border;
  const height = side + border + band + (outline ? border : 0);
  const panel = { x: border, y: above ? band : border };
  const frame = new PathData(unit);
  if (outline) {
    const line = 0.4,
      boxHeight = side + 2 * border;
    frame
      .rect(0, 0, width, boxHeight, 1.2)
      .rect(line, line, width - 2 * line, boxHeight - 2 * line, 0.8);
  } else frame.rect(0, 0, width, height, 2 * border).rect(panel.x, panel.y, side, side, border);
  const layers: Layer[] = [{ d: String(frame), paint: design.frameColor, evenOdd: true }];
  if (!text) return { width, height, panel, layers };
  let size = band * (outline ? 0.6 : 0.55);
  const fit = side * 0.9;
  const textWidth = measure(text, size, CAPTION_FONT, 700);
  if (textWidth > fit) size *= fit / textWidth;
  const middle = outline ? side + 2 * border + band / 2 : above ? band / 2 : height - band / 2;
  return {
    width,
    height,
    panel,
    layers,
    caption: {
      text,
      x: Math.round((width / 2) * unit),
      y: Math.round((middle + size * 0.36) * unit),
      size: Math.max(1, Math.round(size * unit)),
      color: design.captionColor,
      font: CAPTION_FONT,
      weight: 700,
    },
  };
}

/** The logo's square, in modules from the code's corner, kept clear of the corner squares. */
export function logoBox(size: number, share: number): { from: number; to: number } {
  const pad = 0.5;
  const side = Math.max(0, Math.min(size * share, size - 17));
  return { from: (size - side) / 2 - pad, to: (size + side) / 2 + pad };
}

/** A plain code is drawn on whole modules; anything with shapes needs tenths of one. */
export function unitFor(design: Design): number {
  return design.modules === "square" &&
    design.eyeFrame === "square" &&
    design.eyeBall === "square" &&
    !design.logo &&
    design.frame === "none"
    ? 1
    : 10;
}

export function qrScene(qr: QrCode, design: Design, measure: Measure = estimateText): Scene {
  const unit = unitFor(design);
  const size = qr.modules.length,
    side = size + 2 * QUIET_ZONE;
  const frame = framed(side, design, unit, measure);
  const ox = frame.panel.x + QUIET_ZONE,
    oy = frame.panel.y + QUIET_ZONE;
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const box = design.logo ? logoBox(size, LOGO_SHARE) : undefined;
  const covered = (x: number, y: number) =>
    box !== undefined && x + 1 > box.from && x < box.to && y + 1 > box.from && y < box.to;
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && qr.modules[y][x] && !finder(x, y) && !covered(x, y);
  const paint = gradientPaint(design, unit, ox, oy, size, size);
  const eyePaint = design.eyeColor ?? paint;
  const corners: [Corner, number, number][] = [
    ["tl", ox, oy],
    ["tr", ox + size - 7, oy],
    ["bl", ox, oy + size - 7],
  ];
  const frames = new PathData(unit),
    balls = new PathData(unit);
  for (const [corner, x, y] of corners) {
    eyeFrame(frames, design.eyeFrame, corner, x, y);
    eyeBall(balls, design.eyeBall, corner, x + 2, y + 2);
  }
  const squareEyes = design.eyeFrame === "square" && design.eyeBall === "square";
  const layers: Layer[] = [
    ...frame.layers,
    // A frame's panel takes the background, the frame around it the frame's colour: what is
    // outside the frame's rounded corners stays clear.
    ...(design.frame === "none" || !visible(design.background)
      ? []
      : [
          {
            d: String(new PathData(unit).rect(frame.panel.x, frame.panel.y, side, side)),
            paint: design.background,
          },
        ]),
    {
      d: String(modulesPath(new PathData(unit), size, on, design.modules, ox, oy)),
      paint,
      crisp: design.modules === "square",
    },
    { d: String(frames), paint: eyePaint, evenOdd: true, crisp: squareEyes },
    { d: String(balls), paint: eyePaint, crisp: squareEyes },
  ];
  let image: Scene["image"];
  if (design.logo && box) {
    const { width, height } = design.logo;
    const inner = box.to - box.from - 1,
      aspect = width / height || 1;
    const w = inner * Math.min(1, aspect),
      h = inner * Math.min(1, 1 / aspect);
    const u = (value: number) => Math.round(value * unit);
    image = {
      logo: design.logo,
      x: u(ox + (size - w) / 2),
      y: u(oy + (size - h) / 2),
      width: u(w),
      height: u(h),
    };
  }
  return {
    unit,
    width: frame.width * unit,
    height: frame.height * unit,
    ...(design.frame === "none" && visible(design.background)
      ? { background: design.background }
      : {}),
    layers,
    ...(image ? { image } : {}),
    ...(frame.caption ? { caption: frame.caption } : {}),
  };
}

/**
 * The clear space each barcode needs before and after its bars, in modules: EAN-13 11 and 7
 * (GS1), UPC-A 9 and 9, Code 128 10 and 10 (ISO/IEC 15417).
 */
export const BARCODE_QUIET: Record<BarcodeKind, readonly [left: number, right: number]> = {
  code128: [10, 10],
  ean13: [11, 7],
  upca: [9, 9],
};
/** Bars from 4 to 64 in a symbol 80 high, the text under them. Colours apply; shapes do not. */
export function barcodeScene(code: Barcode, design: Design): Scene {
  const [left, right] = BARCODE_QUIET[code.kind];
  const width = code.modules.length + left + right;
  const bars = new PathData(1);
  for (let x = 0; x < code.modules.length; x++) {
    if (!code.modules[x]) continue;
    const start = x;
    while (x + 1 < code.modules.length && code.modules[x + 1]) x++;
    const length = x - start + 1;
    bars
      .move(start + left, 4)
      .h(length)
      .v(60)
      .h(-length)
      .close();
  }
  return {
    unit: 1,
    width,
    height: 80,
    ...(visible(design.background) ? { background: design.background } : {}),
    layers: [
      {
        d: String(bars),
        paint: gradientPaint(design, 1, left, 4, code.modules.length, 60),
        crisp: true,
      },
    ],
    caption: {
      text: code.text,
      x: Math.round(width / 2),
      y: 75,
      size: 7,
      color: design.foreground,
      font: "ui-monospace, Menlo, Consolas, monospace",
      weight: 400,
    },
  };
}

/** Whether a colour shows at all: not at alpha 0. */
export const visible = (color: string) => (parseHex(color)?.a ?? 1) > 0;

/** What about the colours may stop a code from scanning, worst first. */
export function colourWarnings(design: Design, qr: boolean): string[] {
  // A translucent background is seen over whatever is under it: white, at best.
  const background = flatten(design.background, "#ffffff");
  const inks = [
    design.foreground,
    ...(design.gradient ? [design.gradient.to] : []),
    ...(qr && design.eyeColor ? [design.eyeColor] : []),
  ].map((ink) => flatten(ink, design.background));
  const warnings: string[] = [];
  if (inks.some((ink) => contrast(ink, background) < 4))
    warnings.push(
      "Low contrast: the code may not scan. Use a darker colour or a lighter background."
    );
  if (inks.some((ink) => luminance(ink) > luminance(background)))
    warnings.push("Light on dark: some scanners read only dark codes on a light background.");
  if ((parseHex(design.background)?.a ?? 1) < 1)
    warnings.push("Transparent: place the code on a light, plain background.");
  return warnings;
}
