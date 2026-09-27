import { expect, test } from "bun:test";
import { findApp } from "@workbench/catalog";

test("is in the catalog", () => {
  expect(findApp("json")).toBeDefined();
});
