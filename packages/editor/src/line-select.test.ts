import { expect, test } from "bun:test";
import { linesBetween } from "./line-select.js";

test("lines are selected from the anchor line to the other, in either direction", () => {
  const second = { from: 4, to: 8 };
  expect(linesBetween(second, { from: 8, to: 14 })).toEqual({ anchor: 4, head: 14 });
  expect(linesBetween(second, { from: 0, to: 4 })).toEqual({ anchor: 8, head: 0 });
  expect(linesBetween(second, second)).toEqual({ anchor: 4, head: 8 });
});
