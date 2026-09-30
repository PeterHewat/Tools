import { describe, expect, test } from "bun:test";
import { importedRecords, listOrder, type DocumentMeta } from "./storage.js";

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

describe("library imports", () => {
  test("reserves unique names for the whole batch and retains its order above existing files", () => {
    const existing = [{ ...meta("existing", -5), name: "Icon" }];
    const tags = ["demo"];
    const records = importedRecords(
      existing,
      [{ name: "Icon", tags }, { name: "Icon" }, { name: "Icon 2" }],
      42
    );
    expect(records.map((record) => record.name)).toEqual(["Icon 2", "Icon 3", "Icon 2 2"]);
    expect(records.map((record) => record.order)).toEqual([-8, -7, -6]);
    expect(records.every((record) => record.updated === 42)).toBe(true);
    expect(new Set(records.map((record) => record.id)).size).toBe(3);
    expect(records[0]!.tags).toEqual(tags);
    expect(records[0]!.tags).not.toBe(tags);
    expect(existing[0]!.order).toBe(-5);
  });
});
