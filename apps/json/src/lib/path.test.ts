import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { jsPath, jsonPointer, nodeAt } from "./path.js";

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

test("nodeAt follows positions, so a repeated key finds the right copy", () => {
  const text = '{"a": 1, "a": [0, 2]}';
  const r = root(text);
  const at = nodeAt(r, text.indexOf("2"));
  expect(at.path).toEqual(["a", 1]);
  // By position, not by key: the second "a", not the first.
  expect(at.chain[1]).toBe(r.kind === "object" ? r.members[1]!.value : r);
  expect(at.chain.at(-1)).toBe(at.node);
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
