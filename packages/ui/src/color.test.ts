import { expect, test } from "bun:test";
import { contrast, flatten, parseHex, splitAlpha, toHex } from "./color.js";

test("hex colours read and write, with alpha only when it is not opaque", () => {
  expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  expect(parseHex("336699")).toEqual({ r: 51, g: 102, b: 153, a: 1 });
  expect(parseHex("#33669980")?.a).toBeCloseTo(0.502, 3);
  expect(parseHex("#12345")).toBeUndefined();
  expect(parseHex("red")).toBeUndefined();
  expect(toHex({ r: 51, g: 102, b: 153 })).toBe("#336699");
  expect(toHex({ r: 51, g: 102, b: 153, a: 0.5 })).toBe("#33669980");
  expect(toHex({ r: 51, g: 102, b: 153, a: 0 })).toBe("#33669900");
  expect(splitAlpha("#ffffff00")).toEqual({ color: "#ffffff", alpha: 0 });
  expect(splitAlpha("nonsense")).toEqual({ color: "#000000", alpha: 1 });
});

test("contrast of colours as seen, a translucent one over what is under it", () => {
  expect(contrast(flatten("#000000", "#ffffff"), flatten("#ffffff", "#ffffff"))).toBeCloseTo(21);
  expect(flatten("#00000000", "#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  const half = flatten("#00000080", "#ffffff");
  expect(half.r).toBeCloseTo(127, 0);
  expect(contrast(half, { r: 255, g: 255, b: 255 })).toBeLessThan(5);
});
