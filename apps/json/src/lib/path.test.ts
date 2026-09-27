import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { jsPath, jsonPointer, nodeAt, nodeAtPath } from "./path.js";

const TEXT = '{"data": {"shapes": [{"id": "a"}, {"id": "b"}]}, "a b": 1}';

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

describe("nodeAt", () => {
  test("finds the deepest value at an offset, keys included", () => {
    const at = (needle: string, shift = 0) => nodeAt(root(TEXT), TEXT.indexOf(needle) + shift).path;
    expect(at('"b"')).toEqual(["data", "shapes", 1, "id"]);
    expect(at('"id": "b"')).toEqual(["data", "shapes", 1, "id"]);
    expect(at('{"id": "b"}')).toEqual(["data", "shapes", 1]);
    expect(at('"a b"')).toEqual(["a b"]);
    expect(nodeAt(root(TEXT), 0).path).toEqual([]);
  });
});

test("nodeAtPath follows a path down, and misses cleanly", () => {
  const r = root(TEXT);
  const node = nodeAtPath(r, ["data", "shapes", 1, "id"]);
  expect(node && TEXT.slice(node.start, node.end)).toBe('"b"');
  expect(nodeAtPath(r, ["data", "nope"])).toBeUndefined();
  expect(nodeAtPath(r, ["data", "shapes", "0"])).toBeUndefined();
});

describe("path formats", () => {
  test("JavaScript style uses dots for identifiers and brackets otherwise", () => {
    expect(jsPath(["data", "shapes", 3, "id"])).toBe("data.shapes[3].id");
    expect(jsPath([0, "a b", "$x"])).toBe('[0]["a b"].$x');
    expect(jsPath([])).toBe("");
  });

  test("JSON Pointer escapes ~ and /", () => {
    expect(jsonPointer(["data", "shapes", 3])).toBe("/data/shapes/3");
    expect(jsonPointer(["a/b", "m~n", ""])).toBe("/a~1b/m~0n/");
    expect(jsonPointer([])).toBe("");
  });
});
