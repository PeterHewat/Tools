/**
 * How a code looks, as a scene of filled paths: the same scene is written as SVG and drawn on a
 * canvas for PNG (`render.ts`), so both exports match. Coordinates are in modules (a QR
 * module, a barcode's narrowest bar), with the quiet zone included.
 */
import { QUIET_ZONE } from "./qr.js";
import type { QrCode } from "./qr.js";
import type { Barcode, BarcodeKind } from "./barcode.js";

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

export interface Logo {
  /** An image URL the page and the export can both draw: a data: URL. */
  href: string;
  /** Natural size, for its aspect ratio. */
  width: number;
  height: number;
  /** Its width as a share of the code's, 0.1 to 0.3. */
  size: number;
}
export interface Design {
  foreground: string;
  background: string;
  transparent: boolean;
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
  frameColor: string;
}
export const DEFAULT_DESIGN: Design = {
  foreground: "#000000",
  background: "#ffffff",
  transparent: false,
  modules: "square",
  eyeFrame: "square",
  eyeBall: "square",
  frame: "none",
  caption: "SCAN ME",
  frameColor: "#000000",
};
export const LOGO_SIZE = { min: 0.1, max: 0.3, default: 0.22 };

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
  width: number;
  height: number;
  /** Fills everything behind the code; none for a transparent background. */
  background?: string;
  layers: Layer[];
  image?: { href: string; x: number; y: number; width: number; height: number };
  caption?: Caption;
}
/** How wide a text is at a font size, in the same units: a canvas measures it in the page. */
export type Measure = (text: string, size: number, font: string, weight: number) => number;
export const estimateText: Measure = (text, size) => [...text].length * size * 0.62;

export const CAPTION_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const n3 = (value: number) => String(Math.round(value * 1000) / 1000);

/** A rectangle with each corner's own radius (top-left, top-right, bottom-right, bottom-left). */
export function roundRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: readonly [number, number, number, number] | number = 0
): string {
  const [tl, tr, br, bl] = typeof radii === "number" ? [radii, radii, radii, radii] : radii;
  const arc = (r: number, ex: number, ey: number) =>
    r ? `A${n3(r)} ${n3(r)} 0 0 1 ${n3(ex)} ${n3(ey)}` : "";
  return (
    `M${n3(x + tl)} ${n3(y)}H${n3(x + w - tr)}${arc(tr, x + w, y + tr)}` +
    `V${n3(y + h - br)}${arc(br, x + w - br, y + h)}` +
    `H${n3(x + bl)}${arc(bl, x, y + h - bl)}` +
    `V${n3(y + tl)}${arc(tl, x + tl, y)}Z`
  );
}

export type Corner = "tl" | "tr" | "bl";
/** The radii of a leaf: every corner rounded but the one that faces the middle of the code. */
const leaf = (corner: Corner, r: number): [number, number, number, number] =>
  corner === "tl" ? [r, r, 0, r] : corner === "tr" ? [r, r, r, 0] : [r, 0, r, r];

export function eyeFramePath(style: EyeFrame, corner: Corner, x: number, y: number): string {
  const [outer, inner] =
    style === "square"
      ? [0, 0]
      : style === "rounded"
        ? [2.2, 1.3]
        : style === "circle"
          ? [3.5, 2.5]
          : ([leaf(corner, 3), leaf(corner, 2)] as const);
  return roundRect(x, y, 7, 7, outer) + roundRect(x + 1, y + 1, 5, 5, inner);
}
export function eyeBallPath(style: EyeBall, corner: Corner, x: number, y: number): string {
  if (style === "diamond")
    return `M${x + 1.5} ${y - 0.2}L${x + 3.2} ${y + 1.5}L${x + 1.5} ${y + 3.2}L${x - 0.2} ${y + 1.5}Z`;
  const radii =
    style === "square"
      ? 0
      : style === "rounded"
        ? 0.9
        : style === "circle"
          ? 1.5
          : leaf(corner, 1.4);
  return roundRect(x, y, 3, 3, radii);
}

/** The dark modules as one path, in a shape; `on` says which are drawn (false off the grid). */
export function modulesPath(
  size: number,
  on: (x: number, y: number) => boolean,
  shape: ModuleShape,
  ox: number,
  oy: number
): string {
  const out: string[] = [];
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
          out.push(
            across
              ? `M${ox + start} ${oy + a}h${length}v1h${-length}z`
              : `M${ox + a} ${oy + start}h1v${length}h-1z`
          );
        else
          out.push(
            across
              ? roundRect(ox + start, oy + a + 0.1, length, 0.8, 0.4)
              : roundRect(ox + a + 0.1, oy + start, 0.8, length, 0.4)
          );
      }
    return out.join("");
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!on(x, y)) continue;
      const px = ox + x,
        py = oy + y;
      if (shape === "dots") out.push(roundRect(px + 0.08, py + 0.08, 0.84, 0.84, 0.42));
      else if (shape === "soft") out.push(roundRect(px + 0.05, py + 0.05, 0.9, 0.9, 0.3));
      else if (shape === "diamond")
        out.push(
          `M${px + 0.5} ${py}L${px + 1} ${py + 0.5}L${px + 0.5} ${py + 1}L${px} ${py + 0.5}Z`
        );
      else {
        // Rounded: a corner rounds where neither of the modules beside it is dark.
        const n = on(x, y - 1),
          s = on(x, y + 1),
          w = on(x - 1, y),
          e = on(x + 1, y);
        const r = (round: boolean) => (round ? 0.5 : 0);
        out.push(roundRect(px, py, 1, 1, [r(!n && !w), r(!n && !e), r(!s && !e), r(!s && !w)]));
      }
    }
  return out.join("");
}

function gradientPaint(design: Design, x: number, y: number, w: number, h: number): Paint {
  if (!design.gradient) return design.foreground;
  const { kind, to } = design.gradient;
  if (kind === "radial")
    return {
      kind: "radial",
      from: design.foreground,
      to,
      x1: x + w / 2,
      y1: y + h / 2,
      x2: 0,
      y2: 0,
      r: Math.max(w, h) * 0.75,
    };
  return {
    kind: "linear",
    from: design.foreground,
    to,
    x1: x,
    y1: y,
    x2: kind === "vertical" ? x : x + w,
    y2: kind === "horizontal" ? y : y + h,
    r: 0,
  };
}

/** The frame around a code and its caption: the panel the code sits on, and the whole size. */
function framed(
  side: number,
  design: Design,
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
  const outline = design.frame === "outline";
  const border = outline ? Math.max(0.5, side * 0.015) : Math.max(1, Math.round(side * 0.04));
  const band = text ? Math.round(side * (outline ? 0.18 : 0.2)) : outline ? 0 : border;
  const width = side + 2 * border;
  const height = side + 2 * border + band - (outline ? 0 : border);
  const above = design.frame === "above";
  const panel = { x: border, y: above ? band : border };
  const radius = outline ? border * 3 : border * 2;
  const frameHeight = outline ? side + 2 * border : height;
  const layers: Layer[] = [
    {
      d:
        roundRect(0, 0, width, frameHeight, radius) +
        roundRect(panel.x, panel.y, side, side, Math.max(0, radius - border)),
      paint: design.frameColor,
      evenOdd: true,
    },
  ];
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
      x: width / 2,
      y: middle + size * 0.36,
      size,
      // On a band of the frame's colour, the text takes the background's.
      color: outline ? design.frameColor : design.transparent ? "#ffffff" : design.background,
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

export function qrScene(qr: QrCode, design: Design, measure: Measure = estimateText): Scene {
  const size = qr.modules.length,
    side = size + 2 * QUIET_ZONE;
  const frame = framed(side, design, measure);
  const ox = frame.panel.x + QUIET_ZONE,
    oy = frame.panel.y + QUIET_ZONE;
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const box = design.logo ? logoBox(size, design.logo.size) : undefined;
  const covered = (x: number, y: number) =>
    box !== undefined && x + 1 > box.from && x < box.to && y + 1 > box.from && y < box.to;
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && qr.modules[y][x] && !finder(x, y) && !covered(x, y);
  const paint = gradientPaint(design, ox, oy, size, size);
  const eyePaint = design.eyeColor ?? paint;
  const corners: [Corner, number, number][] = [
    ["tl", ox, oy],
    ["tr", ox + size - 7, oy],
    ["bl", ox, oy + size - 7],
  ];
  const squareEyes = design.eyeFrame === "square" && design.eyeBall === "square";
  const layers: Layer[] = [
    ...frame.layers,
    ...(design.transparent || design.frame === "none"
      ? []
      : [{ d: roundRect(frame.panel.x, frame.panel.y, side, side), paint: design.background }]),
    {
      d: modulesPath(size, on, design.modules, ox, oy),
      paint,
      crisp: design.modules === "square",
    },
    {
      d: corners.map(([corner, x, y]) => eyeFramePath(design.eyeFrame, corner, x, y)).join(""),
      paint: eyePaint,
      evenOdd: true,
      crisp: squareEyes,
    },
    {
      d: corners
        .map(([corner, x, y]) => eyeBallPath(design.eyeBall, corner, x + 2, y + 2))
        .join(""),
      paint: eyePaint,
      crisp: squareEyes,
    },
  ];
  let image: Scene["image"];
  if (design.logo && box) {
    const { href, width, height } = design.logo;
    const inner = box.to - box.from - 1,
      aspect = width / height || 1;
    const w = inner * Math.min(1, aspect),
      h = inner * Math.min(1, 1 / aspect);
    image = { href, x: ox + (size - w) / 2, y: oy + (size - h) / 2, width: w, height: h };
  }
  return {
    width: frame.width,
    height: frame.height,
    ...(design.transparent ? {} : { background: design.background }),
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
  let d = "";
  for (let x = 0; x < code.modules.length; x++) {
    if (!code.modules[x]) continue;
    const start = x;
    while (x + 1 < code.modules.length && code.modules[x + 1]) x++;
    d += `M${start + left} 4h${x - start + 1}v60h${-(x - start + 1)}z`;
  }
  return {
    width,
    height: 80,
    ...(design.transparent ? {} : { background: design.background }),
    layers: [{ d, paint: gradientPaint(design, left, 4, code.modules.length, 60), crisp: true }],
    caption: {
      text: code.text,
      x: width / 2,
      y: 75,
      size: 7,
      color: design.foreground,
      font: "ui-monospace, Menlo, Consolas, monospace",
      weight: 400,
    },
  };
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
/** What about the colours may stop a code from scanning, worst first. */
export function colourWarnings(design: Design, qr: boolean): string[] {
  const background = design.transparent ? "#ffffff" : design.background;
  const inks = [
    design.foreground,
    ...(design.gradient ? [design.gradient.to] : []),
    ...(qr && design.eyeColor ? [design.eyeColor] : []),
  ];
  const warnings: string[] = [];
  if (inks.some((ink) => contrast(ink, background) < 4))
    warnings.push(
      "Low contrast: the code may not scan. Use a darker colour or a lighter background."
    );
  if (inks.some((ink) => luminance(ink) > luminance(background)))
    warnings.push("Light on dark: some scanners read only dark codes on a light background.");
  if (design.transparent)
    warnings.push("Transparent: place the code on a light, plain background.");
  return warnings;
}
