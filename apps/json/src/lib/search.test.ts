import { describe, expect, test } from "bun:test";
import { findInText, MAX_MATCHES } from "./search.js";

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
