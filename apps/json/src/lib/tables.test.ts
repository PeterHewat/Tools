import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { SAMPLE } from "./sample.js";
import { csvSheet, MAX_TABLES, tablesIn } from "./tables.js";

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

const name = (t: { path: unknown[] }) => t.path.join(".") || "root";

describe("tables", () => {
  test("every array reached through objects, in document order, with its path", () => {
    const t = tablesIn(root('{"a": {"deep": [1]}, "b": [{"x": [2]}, {"x": [3]}], "c": []}'));
    expect(t.map((x) => x.path)).toEqual([["a", "deep"], ["b"], ["c"]]);
  });

  test("arrays inside a table are its cells, not tables; the list is capped", () => {
    const rows = Array.from({ length: 500 }, () => '{"tags": [1]}').join(",");
    expect(tablesIn(root(`[${rows}]`))).toHaveLength(1);
    const many = Array.from({ length: 300 }, (_, k) => `"k${k}": []`).join(",");
    expect(tablesIn(root(`{${many}}`))).toHaveLength(MAX_TABLES);
  });

  test("a document with no arrays has no tables", () => {
    expect(tablesIn(root('{"a": 1}'))).toEqual([]);
  });
});

describe("the CSV sheet", () => {
  test("a lone table is plain CSV, each line tied to the value it comes from", () => {
    const text = '[\n  {"id": 1},\n  {"id": 2}\n]';
    const doc = root(text);
    const sheet = csvSheet(tablesIn(doc), name);
    expect(sheet.text).toBe("id\r\n1\r\n2\r\n");
    expect(sheet.sources).toEqual([0, text.indexOf("{"), text.lastIndexOf("{")]);
    expect(sheet.sections.map((s) => s.lastLine)).toEqual([2]);
  });

  test("several tables follow each other, each under a heading", () => {
    const sheet = csvSheet(tablesIn(root(SAMPLE)), name);
    expect(sheet.text).toBe(
      "# tags\r\nvalue\r\njson\r\nsvg\r\n\r\n# apps\r\nid,kb\r\nsvg,191\r\njson,43\r\n"
    );
    expect(sheet.sources.map((s) => s >= 0)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(sheet.sections.map((s) => s.lastLine)).toEqual([3, 8]);
  });

  test("a cell with a line break makes its row two lines, the second without a source", () => {
    const sheet = csvSheet(tablesIn(root('[{"a": "x\\ny"}, {"a": "z"}]')), name);
    expect(sheet.text).toBe('a\r\n"x\ny"\r\nz\r\n');
    expect(sheet.sources.map((s) => s >= 0)).toEqual([true, true, false, true]);
    expect(sheet.sections[0].lastLine).toBe(3);
  });
});
