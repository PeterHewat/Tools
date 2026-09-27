import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { printJson, printedSize } from "./print.js";

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

const SAMPLE =
  '{"name":"Vellum","size":{"w":640,"h":1040},"tags":[],"meta":{},"shapes":[{"id":"a","d":"M1 2","on":true,"n":null},[1,[2,[3]]]]}';

describe("printJson", () => {
  test("lays out like JSON.stringify at every indent", () => {
    for (const indent of [0, 2, 4, "\t"] as const) {
      expect(printJson(root(SAMPLE), { indent })).toBe(
        JSON.stringify(JSON.parse(SAMPLE), null, indent || undefined)
      );
    }
  });

  test("copies numbers and strings as written, so nothing is rounded or re-escaped", () => {
    const text = '{"id": 12345678901234567890, "f": 1.0, "e": 1E5, "s": "\\u00e9\\/"}';
    expect(printJson(root(text), { indent: 0 })).toBe(
      '{"id":12345678901234567890,"f":1.0,"e":1E5,"s":"\\u00e9\\/"}'
    );
  });

  test("keeps key order and duplicates unless sorting", () => {
    const text = '{"b": 1, "a": {"d": 1, "c": 2}, "b": 3}';
    expect(printJson(root(text), { indent: 0 })).toBe('{"b":1,"a":{"d":1,"c":2},"b":3}');
    expect(printJson(root(text), { indent: 0, sortKeys: true })).toBe(
      '{"a":{"c":2,"d":1},"b":1,"b":3}'
    );
  });

  test("sorts by the decoded key, and leaves arrays in order", () => {
    expect(printJson(root('{"\\u0062": [3, 1], "a": 0}'), { indent: 0, sortKeys: true })).toBe(
      '{"a":0,"\\u0062":[3,1]}'
    );
  });

  test("handles nesting deeper than the call stack", () => {
    const deep = "[".repeat(50_000) + "]".repeat(50_000);
    expect(printJson(root(deep), { indent: 0 })).toBe(deep);
  });
});

test("printedSize matches the bytes printJson writes, without printing", () => {
  const text = '{"é": ["ü", 1.0, {}, [], {"k": "😀", "n": null}], "z": "\ud800", "t": true}';
  for (const indent of [0, 2, 4, "\t"] as const) {
    const bytes = new TextEncoder().encode(printJson(root(text), { indent })).length;
    expect(printedSize(root(text), { indent })).toBe(bytes);
  }
  expect(printedSize(root("1"), { indent: 2 })).toBe(1);
});
