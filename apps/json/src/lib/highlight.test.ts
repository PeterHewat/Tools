import { describe, expect, test } from "bun:test";
import { highlightHtml, highlightLine, type Token } from "./highlight.js";

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

describe("highlightHtml over a range", () => {
  const line = '"a": 1, "b": 2, "c": 3';

  test("colours only the tokens in range, keeping the prefix as plain text", () => {
    const html = highlightHtml(line, 8, 12);
    expect(html.startsWith('"a": 1, <span class="t-key">"b"</span>')).toBe(true);
    expect(html).not.toContain('"c"');
  });

  test("the plain prefix plus the coloured tokens start at the true column", () => {
    const plain = highlightHtml(line, 13, 14).replace(/<[^>]+>/g, "");
    expect(line.startsWith(plain)).toBe(true);
    expect(plain.length).toBeGreaterThanOrEqual(14);
  });

  test("a long line costs its range, not its length", () => {
    const long = '"k": "' + "x".repeat(200_000) + '", ' + '"n": 1, '.repeat(100_000);
    const started = performance.now();
    const html = highlightHtml(long, 150_000, 150_100);
    expect(performance.now() - started).toBeLessThan(500);
    expect(html.length).toBeLessThan(long.length);
  });
});

test("highlightHtml escapes markup", () => {
  expect(highlightHtml('"<b>&"')).toBe('<span class="t-string">"&lt;b>&amp;"</span>');
  expect(highlightHtml("  x")).toBe("  x");
});
