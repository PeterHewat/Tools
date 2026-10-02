import { expect, test } from "bun:test";
import { encodeQr } from "./qr.js";
import { encodeBarcode } from "./barcode.js";
import {
  DEFAULT_DESIGN,
  EYE_BALLS,
  EYE_FRAMES,
  FRAMES,
  GRADIENTS,
  MODULE_SHAPES,
  barcodeScene,
  colourWarnings,
  contrast,
  logoBox,
  qrScene,
  roundRect,
} from "./design.js";
import type { Design } from "./design.js";
import { exportSize, sceneSvg } from "./render.js";

const qr = encodeQr("https://example.com/", "M");
const size = qr.modules.length;

test("the default design is the plain code: square modules, square eyes, no frame", () => {
  const scene = qrScene(qr, DEFAULT_DESIGN);
  expect([scene.width, scene.height, scene.background]).toEqual([size + 8, size + 8, "#ffffff"]);
  const [modules, frames, balls] = scene.layers;
  expect(modules.crisp && frames.crisp && balls.crisp).toBe(true);
  // The corner squares are drawn as eyes, never as modules.
  expect(modules.d).not.toContain("M4 4h");
  expect(frames.d.startsWith("M4 4H11")).toBe(true);
  const svg = sceneSvg(scene, 512);
  expect(svg).not.toContain("<defs>");
  expect(svg).toContain('width="512" height="512"');
});

test("every shape, eye and frame makes a scene that writes to SVG", () => {
  for (const modules of MODULE_SHAPES)
    for (const eyeFrame of EYE_FRAMES)
      for (const eyeBall of EYE_BALLS)
        for (const frame of FRAMES) {
          const scene = qrScene(qr, { ...DEFAULT_DESIGN, modules, eyeFrame, eyeBall, frame });
          expect(scene.layers.every((layer) => !/NaN|undefined/.test(layer.d))).toBe(true);
          expect(sceneSvg(scene, 1024)).toStartWith("<svg");
        }
});

test("rounded modules round only the corners with no dark neighbour", () => {
  expect(roundRect(0, 0, 1, 1, [0.5, 0, 0, 0])).toBe("M0.5 0H1V1H0V0.5A0.5 0.5 0 0 1 0.5 0Z");
  const scene = qrScene(qr, { ...DEFAULT_DESIGN, modules: "rounded" });
  expect(scene.layers[0].d).toContain("A0.5 0.5");
  expect(scene.layers[0].crisp).toBe(false);
});

test("gradients and corner colours paint the modules and the eyes", () => {
  for (const kind of GRADIENTS) {
    const design: Design = { ...DEFAULT_DESIGN, gradient: { to: "#0000ff", kind } };
    const svg = sceneSvg(qrScene(qr, design), 512);
    expect(svg).toContain(kind === "radial" ? "<radialGradient" : "<linearGradient");
    expect(svg).toContain('fill="url(#g0)"');
  }
  const eyes = qrScene(qr, { ...DEFAULT_DESIGN, eyeColor: "#ff0000" });
  expect(eyes.layers[1].paint).toBe("#ff0000");
  expect(eyes.layers[0].paint).toBe("#000000");
});

test("a logo clears the modules under it and stays clear of the corner squares", () => {
  expect(logoBox(21, 0.3)).toEqual({ from: 8, to: 13 });
  const big = encodeQr("x".repeat(200), "H");
  const box = logoBox(big.modules.length, 0.22);
  expect(box.to - box.from).toBeCloseTo(big.modules.length * 0.22 + 1);
  const logo = { href: "data:image/png;base64,AA==", width: 200, height: 100, size: 0.22 };
  const plain = qrScene(big, DEFAULT_DESIGN),
    marked = qrScene(big, { ...DEFAULT_DESIGN, logo });
  expect(marked.layers[0].d.length).toBeLessThan(plain.layers[0].d.length);
  // Wide images fit the width, centred.
  expect(marked.image!.width).toBeCloseTo(2 * marked.image!.height);
  expect(marked.image!.x + marked.image!.width / 2).toBeCloseTo(marked.width / 2);
  expect(sceneSvg(marked, 1024)).toContain('xlink:href="data:image/png;base64,AA=="');
});

test("frames add a captioned band, and long captions shrink to fit", () => {
  const below = qrScene(qr, { ...DEFAULT_DESIGN, frame: "below" });
  expect(below.height).toBeGreaterThan(below.width);
  expect(below.caption).toMatchObject({ text: "SCAN ME", color: "#ffffff" });
  expect(below.caption!.y).toBeGreaterThan(below.width);
  const above = qrScene(qr, { ...DEFAULT_DESIGN, frame: "above" });
  expect(above.caption!.y).toBeLessThan(above.height - above.width);
  const long = qrScene(qr, { ...DEFAULT_DESIGN, frame: "below", caption: "x".repeat(80) });
  expect(long.caption!.size).toBeLessThan(below.caption!.size);
  expect(
    sceneSvg(qrScene(qr, { ...DEFAULT_DESIGN, frame: "outline", caption: "<b>" }), 512)
  ).toContain(">&lt;b&gt;</text>");
  expect(exportSize(below, 500).height).toBe(Math.round((500 * below.height) / below.width));
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
  expect(scene.layers[0].d.startsWith("M11 4h1")).toBe(true);
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
