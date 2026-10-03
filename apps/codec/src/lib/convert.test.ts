import { expect, test } from "bun:test";
import { fromUrl, readValue, toUrl, writeAll, writeValue } from "./convert.js";

test("writes every format from the bytes, and no text when they are not UTF-8", () => {
  expect(writeAll(readValue("Hello, 🌍!\n", "text"))).toEqual({
    text: "Hello, 🌍!\n",
    url: "Hello%2C%20%F0%9F%8C%8D!%0A",
    base64: "SGVsbG8sIPCfjI0hCg==",
    base64url: "SGVsbG8sIPCfjI0hCg",
    hex: "48 65 6c 6c 6f 2c 20 f0 9f 8c 8d 21 0a",
  });
  expect(writeAll(readValue("ff 00", "hex"))).toEqual({
    text: null,
    url: "%FF%00",
    base64: "/wA=",
    base64url: "_wA",
    hex: "ff 00",
  });
  expect(writeAll(new Uint8Array())).toEqual({
    text: "",
    url: "",
    base64: "",
    base64url: "",
    hex: "",
  });
});

test("a URL component matches encodeURIComponent for text, and carries any byte", () => {
  const text = "a b+c/é?&=#~*'()!_-.🌍\u0000\r\n";
  expect(toUrl(readValue(text, "text"))).toBe(encodeURIComponent(text));
  expect(writeValue(fromUrl("a+b%20c"), "text")).toBe("a+b c");
  expect(writeValue(fromUrl("café%21"), "text")).toBe("café!");
  expect(writeValue(fromUrl("%FF%fe"), "hex")).toBe("ff fe");
  expect(() => fromUrl("100%")).toThrow("two hex digits (at character 4)");
  expect(() => fromUrl("%G0")).toThrow("two hex digits");
});

test("reads each format strictly", () => {
  expect(writeValue(readValue("48656c 6c6f", "hex"), "text")).toBe("Hello");
  expect(() => readValue("abc", "hex")).toThrow("pairs");
  expect(() => readValue("SGVsbG8=", "base64url")).toThrow("Base64url");
  expect(() => readValue("\ud800", "text")).toThrow("surrogate");
});

test("decodes large URL components without an argument limit", () => {
  const text = "a".repeat(1_000_000) + "🌍";
  expect(writeValue(fromUrl(text + "%00" + text), "text")).toBe(text + "\u0000" + text);
});
