import { describe, expect, test } from "bun:test";
import { createAnalysis } from "./analysis.js";

const options = { exact: new Set<string>(), pathStyle: "js" as const };

describe("document revision analysis", () => {
  test("presentation refreshes reuse the parse, and changed text gets fresh positions", () => {
    const analysis = createAnalysis();
    const first = analysis.read('{"name":"first"}');
    expect(analysis.read('{"name":"first"}')).toBe(first);
    const next = analysis.read('{\n  "name": "second"\n}');
    expect(next).not.toBe(first);
    expect(next.doc?.root.start).toBe(0);
    expect(next.fault).toBeNull();
    expect(next.exports).not.toBe(first.exports);
  });

  test("almost JSON has a repair fault but cannot be exported", () => {
    const value = createAnalysis().read('{"a": 1,}');
    expect(value.doc).toBeNull();
    expect(value.exports).toBeNull();
    expect(value.fault?.edits).toHaveLength(1);
    expect(value.fault?.position.offset).toBe(7);
    expect(createAnalysis().read(" ")).toEqual({ doc: null, fault: null, exports: null });
  });
});

describe("revision-owned exports", () => {
  test("Types and Schema share candidates and respect changed exact-value choices", () => {
    const exports = createAnalysis().read('[{"name":"a"},{"name":"b"}]').exports!;
    const types = exports.convert("ts", options);
    const schema = exports.convert("schema", options);
    expect(schema.candidates).toBe(types.candidates);
    expect(exports.convert("ts", options)).toBe(types);
    const exact = { ...options, exact: new Set(["[].name"]) };
    const precise = exports.convert("ts", exact);
    expect(precise.result.ok && precise.result.text).toContain('"a" | "b"');
    expect(precise.candidates).toBe(types.candidates);
    const json = exports.convert("schema", exact).result;
    expect(json.ok && JSON.parse(json.text).items.properties.name.enum).toEqual(["a", "b"]);
  });

  test("CSV carries its line mapping and updates captions when the path style changes", () => {
    const exports = createAnalysis().read(
      '{\n"rows": [\n{"id":1},\n{"id":2}\n], "other": [3]\n}'
    ).exports!;
    const csv = exports.convert("csv", options);
    expect(csv.sheet?.sections).toHaveLength(2);
    expect(csv.lineLabels).toContain(3);
    expect(csv.lineLabels).toContain(4);
    expect(exports.convert("csv", options)).toBe(csv);
    const pointer = exports.convert("csv", { ...options, pathStyle: "pointer" });
    expect(pointer.sheet?.text).toContain("/rows");
    expect(csv.sheet?.text).not.toContain("/rows");
    expect(exports.convert("yaml", options).sheet).toBeNull();
  });

  test("a new document does not retain a previous document's tables", () => {
    const analysis = createAnalysis();
    expect(analysis.read("[1,2]").exports!.convert("csv", options).sheet).not.toBeNull();
    const result = analysis.read('{"id":1}').exports!.convert("csv", options);
    expect(result.sheet).toBeNull();
    expect(result.lineLabels).toBeNull();
    expect(result.result.ok).toBe(false);
  });
});
