import { expect, test } from "bun:test";
import { lineOf, lineStarts, positionAt } from "./lines.js";

test("positionAt gives a 1-based line and column", () => {
  const t = "ab\ncd";
  expect(positionAt(t, 0)).toEqual({ offset: 0, line: 1, column: 1 });
  expect(positionAt(t, 2)).toEqual({ offset: 2, line: 1, column: 3 });
  expect(positionAt(t, 3)).toEqual({ offset: 3, line: 2, column: 1 });
  expect(positionAt(t, 5)).toEqual({ offset: 5, line: 2, column: 3 });
});

test("lineOf finds the line of any offset from lineStarts", () => {
  const t = "ab\n\ncd\n";
  const starts = lineStarts(t);
  expect(starts).toEqual([0, 3, 4, 7]);
  expect([0, 2, 3, 4, 6, 7].map((o) => lineOf(starts, o))).toEqual([1, 1, 2, 3, 3, 4]);
});
