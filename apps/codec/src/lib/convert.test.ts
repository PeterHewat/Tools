import { expect, test } from "bun:test";
import { convert } from "./convert.js";
test("converts raw bytes without requiring UTF-8 unless output is text", () => {
  expect(convert("ff00", "hex", "base64").text).toBe("/wA=");
  expect(() => convert("ff00", "hex", "text")).toThrow("UTF-8");
  expect(convert("a+b%20c", "url", "text").text).toBe("a+b c");
  expect(convert("🌍 /", "text", "url").text).toBe("%F0%9F%8C%8D%20%2F");
  expect(() => convert("%FF", "url", "text")).toThrow();
  expect(convert("", "text", "base64").text).toBe("");
});
