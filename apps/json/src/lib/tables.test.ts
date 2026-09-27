import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { SAMPLE } from "./sample.js";
import { defaultTable, MAX_TABLES, tablesIn } from "./tables.js";

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

describe("tables", () => {
  test("every array, nearest the root first, with its path", () => {
    const t = tablesIn(root('{"a": {"deep": [1]}, "b": [{"x": [2]}, {"x": [3]}], "c": []}'));
    expect(t.map((x) => x.path)).toEqual([["b"], ["c"], ["a", "deep"], ["b", 0, "x"]]);
  });

  test("an array of objects is a table proper; one of plain values is not", () => {
    const t = tablesIn(root('{"tags": ["a"], "rows": [{"id": 1}]}'));
    expect(t.map((x) => x.objects)).toEqual([false, true]);
  });

  test("the default is the first table of objects, else the first array", () => {
    expect(defaultTable(tablesIn(root('{"tags": ["a"], "rows": [{"id": 1}]}')))?.path).toEqual([
      "rows",
    ]);
    expect(defaultTable(tablesIn(root('{"tags": ["a"]}')))?.path).toEqual(["tags"]);
    expect(defaultTable(tablesIn(root('{"a": 1}')))).toBeUndefined();
  });

  test("a nested array repeated in every row is one choice, and the list is capped", () => {
    const rows = Array.from({ length: 500 }, () => '{"tags": [1]}').join(",");
    expect(tablesIn(root(`[${rows}]`))).toHaveLength(2);
    const many = Array.from({ length: 300 }, (_, k) => `"k${k}": []`).join(",");
    expect(tablesIn(root(`{${many}}`))).toHaveLength(MAX_TABLES);
  });

  test("the sample's CSV view shows a table of objects", () => {
    const table = defaultTable(tablesIn(root(SAMPLE)));
    expect(table?.objects).toBe(true);
  });
});
