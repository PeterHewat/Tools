import { describe, expect, test } from "bun:test";
import { listOrder, type DocumentMeta } from "./storage.js";

const meta = (id: string, order: number): DocumentMeta => ({ id, name: id, updated: 0, order });

describe("list order", () => {
  test("the ids given come first, in that order", () => {
    const all = [meta("a", 0), meta("b", 1), meta("c", 2)];
    expect([...listOrder(all, ["c", "a", "b"])]).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  test("one it was not given (made in another tab, on top) follows, never among them", () => {
    const all = [meta("new", -1), meta("a", 0), meta("b", 1)];
    const order = listOrder(all, ["b", "a"]);
    expect(order.get("new")).toBe(2);
    expect(new Set(order.values()).size).toBe(3);
  });
});
