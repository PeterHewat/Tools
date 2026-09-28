import { expect, test } from "bun:test";
import { lineCount, lineOf, lineStarts } from "./lines.js";

test("lineCount counts line breaks plus one", () => {
  expect(lineCount("")).toBe(1);
  expect(lineCount("a\nb\n")).toBe(3);
});

test("lineOf finds the line of any offset from lineStarts", () => {
  const t = "ab\n\ncd\n";
  const starts = lineStarts(t);
  expect(starts).toEqual([0, 3, 4, 7]);
  expect([0, 2, 3, 4, 6, 7].map((o) => lineOf(starts, o))).toEqual([1, 1, 2, 3, 3, 4]);
});
