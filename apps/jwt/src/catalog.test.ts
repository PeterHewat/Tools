import { expect, test } from "bun:test";
import { findApp } from "@tools/catalog";

test("is in the catalog", () => {
  expect(findApp("jwt")).toBeDefined();
});
