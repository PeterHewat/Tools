import { expect, test } from "bun:test";
import { encodeQr } from "./qr.js";
import { encodeBarcode } from "./barcode.js";
import {
  DEFAULT_DESIGN,
  EYE_BALLS,
  EYE_FRAMES,
  FRAMES,
  GRADIENTS,
  LOGO_SHARE,
  MODULE_SHAPES,
  PathData,
  barcodeScene,
  colourWarnings,
  contrast,
  logoBox,
  qrScene,
} from "./design.js";
import type { Design, Scene } from "./design.js";
import { SIZES, exportSize, sceneSvg } from "./render.js";
import type { SizeName } from "./render.js";

const qr = encodeQr("https://example.com/", "M");
const size = qr.modules.length;
const svg = (scene: Scene, name: SizeName = "m") => sceneSvg(scene, exportSize(scene, name));

test("the default design is the plain code: one unit a module, square everything", () => {
  const scene = qrScene(qr, DEFAULT_DESIGN);
  expect([scene.unit, scene.width, scene.height]).toEqual([1, size + 8, size + 8]);
  const [modules, frames, balls] = scene.layers;
  expect(modules.crisp && frames.crisp && balls.crisp).toBe(true);
  // The corner squares are drawn as eyes, never as modules: a frame, its hole, three times.
  expect(frames.d).toBe(
    `M4 4h7v7h-7zm1 1h5v5h-5zm${size - 8}-1h7v7h-7zm1 1h5v5h-5zm${6 - size} ${size - 8}h7v7h-7zm1 1h5v5h-5z`
  );
  expect(balls.d.startsWith("M6 6h3v3h-3z")).toBe(true);
  const out = svg(scene);
  expect(out).not.toContain("<defs>");
  expect(out).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
});

test("paths are relative and in whole units", () => {
  expect(String(new PathData(10).rect(0, 0, 1, 1, [0.5, 0, 0, 0]))).toBe(
    "M5 0h5v10h-10v-5a5 5 0 0 1 5-5z"
  );
  expect(String(new PathData(10).rect(1, 1, 0.8, 0.8, 0.4).rect(2, 1, 0.8, 0.8, 0.4))).toBe(
    "M14 10a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4zm10 0a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4z"
  );
});

test("every shape, eye and frame writes an SVG with no decimals", () => {
  for (const modules of MODULE_SHAPES)
    for (const eyeFrame of EYE_FRAMES)
      for (const eyeBall of EYE_BALLS)
        for (const frame of FRAMES) {
          const scene = qrScene(qr, { ...DEFAULT_DESIGN, modules, eyeFrame, eyeBall, frame });
          const out = svg(scene);
          expect(out).toStartWith("<svg");
          expect(out).not.toMatch(/\d\.\d|NaN|undefined/);
          expect(scene.width % scene.unit).toBe(0);
          expect(scene.height % scene.unit).toBe(0);
        }
  const styled = qrScene(qr, {
    ...DEFAULT_DESIGN,
    modules: "dots",
    gradient: { to: "#0000ff", kind: "radial" },
    logo: { href: "data:image/png;base64,AA==", width: 3, height: 2 },
  });
  expect(styled.unit).toBe(10);
  expect(svg(styled)).not.toMatch(/\d\.\d/);
});

test("each export size is a whole number of pixels a module, near its target", () => {
  for (const scene of [
    qrScene(qr, DEFAULT_DESIGN),
    qrScene(qr, { ...DEFAULT_DESIGN, frame: "below" }),
    barcodeScene(encodeBarcode("x".repeat(80), "code128"), DEFAULT_DESIGN),
  ])
    for (const name of Object.keys(SIZES) as SizeName[]) {
      const modules = scene.width / scene.unit;
      const size = exportSize(scene, name);
      expect(Number.isInteger(size.perModule) && size.perModule >= 1).toBe(true);
      expect(size.width).toBe(size.perModule * modules);
      expect(size.height).toBe((size.perModule * scene.height) / scene.unit);
      if (size.perModule > 1)
        expect(Math.abs(size.width - SIZES[name])).toBeLessThanOrEqual(modules / 2);
    }
});

test("rounded modules round only the corners with no dark neighbour", () => {
  const scene = qrScene(qr, { ...DEFAULT_DESIGN, modules: "rounded" });
  expect(scene.layers[0].d).toContain("a5 5 0 0 1");
  expect(scene.layers[0].crisp).toBe(false);
});

test("gradients and corner colours paint the modules and the eyes", () => {
  for (const kind of GRADIENTS) {
    const design: Design = { ...DEFAULT_DESIGN, gradient: { to: "#0000ff", kind } };
    const out = svg(qrScene(qr, design));
    expect(out).toContain(kind === "radial" ? "<radialGradient" : "<linearGradient");
    expect(out).toContain('fill="url(#g0)"');
  }
  const eyes = qrScene(qr, { ...DEFAULT_DESIGN, eyeColor: "#ff0000" });
  expect(eyes.layers[1].paint).toBe("#ff0000");
  expect(eyes.layers[0].paint).toBe("#000000");
});

test("a logo clears the modules under it and stays clear of the corner squares", () => {
  expect(logoBox(21, 0.3)).toEqual({ from: 8, to: 13 });
  const big = encodeQr("x".repeat(200), "H");
  const box = logoBox(big.modules.length, LOGO_SHARE);
  expect(box.to - box.from).toBeCloseTo(big.modules.length * LOGO_SHARE + 1);
  const logo = { href: "data:image/png;base64,AA==", width: 200, height: 100 };
  const plain = qrScene(big, { ...DEFAULT_DESIGN, modules: "soft" }),
    marked = qrScene(big, { ...DEFAULT_DESIGN, modules: "soft", logo });
  expect(marked.layers[0].d.length).toBeLessThan(plain.layers[0].d.length);
  // Wide images fit the width, centred.
  expect(Math.abs(marked.image!.width - 2 * marked.image!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(marked.image!.x + marked.image!.width / 2 - marked.width / 2)).toBeLessThan(1);
  expect(svg(marked)).toContain('xlink:href="data:image/png;base64,AA=="');
});

test("frames add a captioned band, and long captions shrink to fit", () => {
  const below = qrScene(qr, { ...DEFAULT_DESIGN, frame: "below" });
  expect(below.height).toBeGreaterThan(below.width);
  expect(below.caption).toMatchObject({ text: "SCAN ME", color: "#ffffff" });
  expect(
    qrScene(qr, { ...DEFAULT_DESIGN, frame: "outline", captionColor: "#ff0000" }).caption
  ).toMatchObject({ color: "#ff0000" });
  expect(below.caption!.y).toBeGreaterThan(below.width);
  const above = qrScene(qr, { ...DEFAULT_DESIGN, frame: "above" });
  expect(above.caption!.y).toBeLessThan(above.height - above.width);
  const long = qrScene(qr, { ...DEFAULT_DESIGN, frame: "below", caption: "x".repeat(80) });
  expect(long.caption!.size).toBeLessThan(below.caption!.size);
  expect(svg(qrScene(qr, { ...DEFAULT_DESIGN, frame: "outline", caption: "<b>" }))).toContain(
    ">&lt;b&gt;</text>"
  );
});

test("barcodes take the colours, and keep their quiet zones", () => {
  const scene = barcodeScene(encodeBarcode("400638133393", "ean13"), {
    ...DEFAULT_DESIGN,
    foreground: "#123456",
    transparent: true,
  });
  expect(scene.background).toBeUndefined();
  expect(scene.layers[0].paint).toBe("#123456");
  expect(scene.caption!.color).toBe("#123456");
  expect(scene.layers[0].d.startsWith("M11 4h1v60h-1z")).toBe(true);
});

test("colour warnings for contrast, light on dark and transparency", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  expect(colourWarnings(DEFAULT_DESIGN, true)).toEqual([]);
  expect(colourWarnings({ ...DEFAULT_DESIGN, foreground: "#999999" }, true)[0]).toContain(
    "Low contrast"
  );
  expect(
    colourWarnings({ ...DEFAULT_DESIGN, foreground: "#ffffff", background: "#000000" }, true)
  ).toEqual(["Light on dark: some scanners read only dark codes on a light background."]);
  expect(
    colourWarnings({ ...DEFAULT_DESIGN, gradient: { to: "#eeeeee", kind: "diagonal" } }, true)
  ).toHaveLength(1);
  expect(colourWarnings({ ...DEFAULT_DESIGN, eyeColor: "#eeeeee" }, false)).toEqual([]);
  expect(colourWarnings({ ...DEFAULT_DESIGN, transparent: true }, true)[0]).toContain(
    "Transparent"
  );
});
