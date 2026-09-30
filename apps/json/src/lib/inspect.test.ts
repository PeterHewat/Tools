import { describe, expect, test } from "bun:test";
import { positionAt } from "./lines.js";
import { excerptAt } from "./inspect.js";

describe("excerptAt", () => {
  test("puts the caret under the error's column", () => {
    const text = '{\n  "a": 1,\n}';
    expect(excerptAt(text, positionAt(text, 12))).toEqual({ line: "}", caret: "^" });
    const text2 = '{"a" 1}';
    expect(excerptAt(text2, positionAt(text2, 5))).toEqual({ line: text2, caret: "     ^" });
  });

  test("drops a trailing carriage return and shows tabs as one column", () => {
    const text = "[\r\n\t1 2\r\n]";
    expect(excerptAt(text, positionAt(text, 6))).toEqual({ line: " 1 2", caret: "   ^" });
  });

  test("clips a long line around the error and keeps the caret on it", () => {
    const text = "[" + "1,".repeat(200) + "x]";
    const at = text.indexOf("x");
    const { line, caret } = excerptAt(text, positionAt(text, at), 40);
    expect(line.startsWith("…")).toBe(true);
    expect(line[caret.length - 1]).toBe("x");
  });
});
