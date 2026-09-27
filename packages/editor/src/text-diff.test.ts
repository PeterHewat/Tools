import { describe, expect, test } from "bun:test";
import { minimalChange } from "./text-diff.js";

const apply = (before: string, after: string) => {
  const c = minimalChange(before, after);
  return c ? before.slice(0, c.from) + c.insert + before.slice(c.to) : before;
};

describe("minimalChange", () => {
  test("null for equal texts", () => {
    expect(minimalChange("abc", "abc")).toBeNull();
  });

  test("replaces only the middle", () => {
    expect(minimalChange("hello world", "hello there world")).toEqual({
      from: 6,
      to: 6,
      insert: "there ",
    });
    expect(minimalChange("abcdef", "abXef")).toEqual({ from: 2, to: 4, insert: "X" });
  });

  test("shared start and end never overlap", () => {
    expect(minimalChange("aaa", "aaaa")).toEqual({ from: 3, to: 3, insert: "a" });
    expect(minimalChange("aaaa", "aa")).toEqual({ from: 2, to: 4, insert: "" });
  });

  test("keeps surrogate pairs whole", () => {
    const c = minimalChange("x😀y", "x😃y")!;
    expect(c.insert).toBe("😃");
    expect(apply("x😀y", "x😃y")).toBe("x😃y");
  });

  test("round-trips arbitrary edits", () => {
    const cases: [string, string][] = [
      ["", "abc"],
      ["abc", ""],
      ['{"a":1}', '{\n  "a": 1\n}'],
      ["line1\nline2\nline3", "line1\nline3"],
    ];
    for (const [a, b] of cases) expect(apply(a, b)).toBe(b);
  });
});
