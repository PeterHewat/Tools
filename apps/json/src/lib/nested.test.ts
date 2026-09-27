import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { nodeAt } from "./path.js";
import { unwrapString, wrapAsString } from "./nested.js";

function at(text: string, needle: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return nodeAt(r.root, text.indexOf(needle)).node;
}

describe("unwrapString", () => {
  test("replaces a string holding JSON with that JSON, indented to its depth", () => {
    const text = '{\n  "payload": "{\\"id\\": 12345678901234567890, \\"tags\\": [1]}"\n}';
    expect(unwrapString(text, at(text, '"{'), 2)).toBe(
      '{\n  "payload": {\n    "id": 12345678901234567890,\n    "tags": [\n      1\n    ]\n  }\n}'
    );
  });

  test("indents like the document, whatever the indent setting", () => {
    const text = '{\n    "p": "[1]"\n}';
    expect(unwrapString(text, at(text, '"['), "\t")).toBe('{\n    "p": [\n        1\n    ]\n}');
  });

  test("keeps a minified document minified", () => {
    const text = '{"a":"[1,2]"}';
    expect(unwrapString(text, at(text, '"['))).toBe('{"a":[1,2]}');
  });

  test("unwraps a document that is itself a string", () => {
    const text = '"{\\"a\\":1}"';
    expect(unwrapString(text, at(text, '"'))).toBe('{"a":1}');
  });

  test("leaves strings that do not hold an object or array", () => {
    for (const text of ['{"a": "hello"}', '{"a": "42"}', '{"a": "{oops}"}']) {
      expect(unwrapString(text, at(text, ': "') ?? at(text, '"a"'))).toBeNull();
    }
    const text = '{"a": 1}';
    expect(unwrapString(text, at(text, "1"))).toBeNull();
  });
});

test("wrapAsString turns a value into a string of its minified JSON, and back", () => {
  const text = '{"a": {"b": [1, 2]}}';
  const wrapped = wrapAsString(text, at(text, '{"b"'));
  expect(wrapped).toBe('{"a": "{\\"b\\":[1,2]}"}');
  // One line in, one line out: unwrapping it again gives the value back, minified.
  expect(unwrapString(wrapped, at(wrapped, '"{'))).toBe('{"a": {"b":[1,2]}}');
});
