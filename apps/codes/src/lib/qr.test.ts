import { expect, test } from "bun:test";
import jsQR from "jsqr";
import { capacity, encodeQr, qrSvg } from "./qr.js";
import { urlContent, wifiContent } from "./presets.js";

/** Independent decoder used only by tests; never imported by the app entry. */
function decode(text: string, level: "L" | "M" | "Q" | "H", version = 1, mask?: number): void {
  const qr = encodeQr(text, level, version, mask);
  const scale = 4,
    margin = 4,
    size = (qr.modules.length + 2 * margin) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i =
            ((y * scale + margin * scale + dy) * size + x * scale + margin * scale + dx) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
    })
  );
  const result = jsQR(pixels, size, size);
  expect(result).not.toBeNull();
  expect(result?.data).toBe(text);
}
test("an independent decoder reads Unicode across correction levels and all masks", () => {
  for (const level of ["L", "M", "Q", "H"] as const)
    for (let mask = 0; mask < 8; mask++) decode("Hello, 世界 🌍\n\u0000", level, 1, mask);
});
test("all 40 versions decode, including version information and unequal block lengths", () => {
  for (let version = 1; version <= 40; version++) decode(`Version ${version}`, "M", version);
  for (const level of ["L", "M", "Q", "H"] as const) decode("x".repeat(800), level);
});
test("capacity boundaries and SVG quiet zone", () => {
  expect(encodeQr("a".repeat(16), "L").version).toBe(1);
  expect(encodeQr("a".repeat(17), "L").version).toBe(2);
  const maximum = capacity(40, "L") - 4;
  expect(encodeQr("a".repeat(maximum), "L").version).toBe(40);
  expect(() => encodeQr("a".repeat(maximum + 1), "L")).toThrow("too long");
  expect(() => encodeQr("\ud800")).toThrow();
  expect(() => encodeQr("x", "M", 0)).toThrow();
  expect(() => encodeQr("x", "M", 1, 8)).toThrow();
  const svg = qrSvg(encodeQr("<script>"));
  expect(svg).toContain('viewBox="0 0 29 29"');
  expect(svg).not.toContain("script");
});
test("Wi-Fi escaping, open networks and URL validation", () => {
  const content = wifiContent('office;:"\\', "p,;\\", "WPA", true);
  expect(content).toBe('WIFI:T:WPA;S:office\\;\\:\\"\\\\;P:p\\,\\;\\\\;H:true;;');
  decode(content, "M");
  expect(wifiContent("guest", "ignored", "nopass", false)).toBe("WIFI:T:nopass;S:guest;H:false;;");
  expect(() => wifiContent("", "x", "WPA", false)).toThrow();
  expect(() => wifiContent("guest", "", "WPA", false)).toThrow();
  expect(urlContent(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
  expect(() => urlContent("javascript:alert(1)")).toThrow();
});
