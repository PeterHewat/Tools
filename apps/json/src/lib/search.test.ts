import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { findInText, findInTree, MAX_MATCHES } from "./search.js";

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

describe("findInText", () => {
  test("finds every match in order, ignoring case unless asked", () => {
    expect(findInText("Id id ID", "id")).toEqual([0, 3, 6]);
    expect(findInText("Id id ID", "id", { matchCase: true })).toEqual([3]);
  });

  test("does not overlap, and an empty query finds nothing", () => {
    expect(findInText("aaaa", "aa")).toEqual([0, 2]);
    expect(findInText("abc", "")).toEqual([]);
  });

  test("stops counting at the cap", () => {
    expect(findInText("x".repeat(MAX_MATCHES + 50), "x")).toHaveLength(MAX_MATCHES);
  });
});

describe("findInTree", () => {
  const doc = root('{"name": "Ada", "tags": ["admin", "x"], "meta": {"Named": 1, "n": null}}');

  test("matches keys and scalar values, in document order", () => {
    const found = findInTree(doc, "nam");
    expect(found.map((m) => m.indices)).toEqual([[0], [2, 0]]);
  });

  test("matches string values without their quotes, and numbers and literals as written", () => {
    expect(findInTree(doc, "ad").map((m) => m.indices)).toEqual([[0], [1, 0]]);
    expect(findInTree(doc, '"')).toEqual([]);
    expect(findInTree(doc, "null").map((m) => m.indices)).toEqual([[2, 1]]);
    expect(findInTree(doc, "1").map((m) => m.indices)).toEqual([[2, 0]]);
  });

  test("respects case when asked", () => {
    expect(findInTree(doc, "Nam", { matchCase: true }).map((m) => m.indices)).toEqual([[2, 0]]);
  });
});
