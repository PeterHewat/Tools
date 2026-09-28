import { describe, expect, test } from "bun:test";
import { highlightLine, type Token } from "./highlight.js";

const kinds = (line: string) =>
  highlightLine(line)
    .filter((t) => t.text.trim())
    .map((t): [Token["kind"], string] => [t.kind, t.text]);

describe("highlightLine", () => {
  test("tells keys from string values", () => {
    expect(kinds('  "name": "a:b",')).toEqual([
      ["key", '"name"'],
      ["punct", ":"],
      ["string", '"a:b"'],
      ["punct", ","],
    ]);
  });

  test("colours numbers, literals and escaped quotes", () => {
    expect(kinds('[-1.5e3, true, null, "say \\"hi\\""]')).toEqual([
      ["punct", "["],
      ["number", "-1.5e3"],
      ["punct", ","],
      ["literal", "true"],
      ["punct", ","],
      ["literal", "null"],
      ["punct", ","],
      ["string", '"say \\"hi\\""'],
      ["punct", "]"],
    ]);
  });

  test("knows almost-JSON: comments, unquoted keys, single quotes", () => {
    expect(kinds("{name: 'x', // note")).toEqual([
      ["punct", "{"],
      ["key", "name"],
      ["punct", ":"],
      ["string", "'x'"],
      ["punct", ","],
      ["comment", "// note"],
    ]);
  });

  test("keeps every character, so the colours line up with the text", () => {
    const line = '\t{"a": [1, "x\\u00e9"], /* c */ b: nul}  ';
    expect(
      highlightLine(line)
        .map((t) => t.text)
        .join("")
    ).toBe(line);
  });
});
