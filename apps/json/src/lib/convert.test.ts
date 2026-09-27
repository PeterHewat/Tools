import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import {
  exactCandidates,
  MAX_EXACT,
  toCsv,
  toJsonSchema,
  toTypeScript,
  toYaml,
} from "./convert.js";
import { SAMPLE } from "./sample.js";

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

describe("toYaml", () => {
  test("writes block style, quoting only strings that need it", () => {
    const text = JSON.stringify({
      name: "SVG",
      id: 12,
      tags: ["svg", "yes", "a: b", "12", ""],
      size: { w: 640, h: 1040 },
      empty: {},
      none: [],
      on: true,
      note: null,
    });
    expect(toYaml(root(text))).toBe(
      [
        "name: SVG",
        "id: 12",
        "tags:",
        "  - svg",
        '  - "yes"',
        '  - "a: b"',
        '  - "12"',
        '  - ""',
        "size:",
        "  w: 640",
        "  h: 1040",
        "empty: {}",
        "none: []",
        '"on": true',
        "note: null",
        "",
      ].join("\n")
    );
  });

  test("puts an object in a list on the dash line, and keeps big numbers exact", () => {
    expect(toYaml(root('[{"id": 12345678901234567890, "d": "M1 2"}, [1, [2]]]'))).toBe(
      ["- id: 12345678901234567890", "  d: M1 2", "- - 1", "  - - 2", ""].join("\n")
    );
  });
});

describe("toCsv", () => {
  test("makes a row per item and a column per key, escaping as RFC 4180 asks", () => {
    const r = toCsv(
      root('[{"a": 1, "b": "x, y"}, {"b": "say \\"hi\\"", "c": [1, 2]}, {"a": null}]')
    );
    expect(r).toEqual({
      ok: true,
      text: 'a,b,c\r\n1,"x, y",\r\n,"say ""hi""","[1,2]"\r\n,,\r\n',
    });
  });

  test("puts items that are not objects in a value column", () => {
    expect(toCsv(root('[1, "two"]'))).toEqual({ ok: true, text: "value\r\n1\r\ntwo\r\n" });
  });

  test("says what it needs when given something other than an array", () => {
    expect(toCsv(root('{"a": 1}')).ok).toBe(false);
  });
});

describe("toTypeScript", () => {
  test("names interfaces after keys, marks keys some items lack as optional", () => {
    const text =
      '{"name": "x", "shapes": [{"id": "a", "w": 1}, {"id": "b", "tags": ["t"]}], "meta": null}';
    expect(toTypeScript(root(text))).toBe(
      [
        "export interface Root {",
        "  name: string;",
        "  shapes: Shape[];",
        "  meta: null;",
        "}",
        "",
        "export interface Shape {",
        "  id: string;",
        "  w?: number;",
        "  tags?: string[];",
        "}",
        "",
      ].join("\n")
    );
  });

  test("unions mixed values, quotes odd keys, and aliases a root that is not an object", () => {
    expect(toTypeScript(root('[{"a b": 1}, {"a b": "x"}, {"a b": null}, []]'))).toBe(
      [
        "export type Root = (RootItem | unknown[])[];",
        "",
        "export interface RootItem {",
        '  "a b": string | number | null;',
        "}",
        "",
      ].join("\n")
    );
  });
});

describe("toJsonSchema", () => {
  test("describes types, required keys and array items", () => {
    const schema = JSON.parse(
      toJsonSchema(root('{"id": 1, "items": [{"x": 1.5}, {"x": 2, "y": "z"}]}'))
    );
    expect(schema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "integer" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "string" } },
            required: ["x"],
          },
        },
      },
      required: ["id", "items"],
    });
  });

  test("uses a type list for mixed scalars and anyOf when structure varies", () => {
    expect(JSON.parse(toJsonSchema(root('["a", null]'))).items).toEqual({
      type: ["string", "null"],
    });
    expect(JSON.parse(toJsonSchema(root('[1, {"a": 1}]'))).items.anyOf).toHaveLength(2);
  });
});

describe("exact values", () => {
  test("places with a handful of strings are offered, in document order", () => {
    expect(exactCandidates(root(SAMPLE))).toEqual([
      { place: "name", values: ["Tools"] },
      { place: "tags[]", values: ["json", "svg"] },
      { place: "apps[].id", values: ["svg", "json"] },
    ]);
    const many = Array.from({ length: MAX_EXACT + 1 }, (_, k) => `"s${k}"`).join(",");
    expect(exactCandidates(root(`[${many}]`))).toEqual([]);
  });

  test("Types lists a chosen place's strings instead of string", () => {
    const text = toTypeScript(root(SAMPLE), { exact: new Set(["tags[]", "apps[].id"]) });
    expect(text).toContain('  tags: ("json" | "svg")[];');
    expect(text).toContain('  id: "svg" | "json";');
    expect(text).toContain("  name: string;");
  });

  test("Schema makes a chosen place an enum, with null in it when null was seen", () => {
    const exact = { exact: new Set(["[].a"]) };
    const schema = JSON.parse(toJsonSchema(root('[{"a": "x"}, {"a": null}]'), exact));
    expect(schema.items.properties.a).toEqual({ enum: ["x", null] });
    const mixed = JSON.parse(toJsonSchema(root('[{"a": "x"}, {"a": 1}]'), exact));
    expect(mixed.items.properties.a).toEqual({ anyOf: [{ enum: ["x"] }, { type: "integer" }] });
  });
});
