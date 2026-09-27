import { describe, expect, test } from "bun:test";
import { parse, type JsonNode } from "./ast.js";
import { toCsv, toTypeScript, toYaml } from "./convert.js";
import type { Token } from "./highlight.js";
import { lexCsv, lexTypeScript, lexYaml } from "./lexers.js";

const shown = (tokens: Token[]) =>
  tokens.filter((t) => t.text.trim()).map((t): [string, string] => [t.kind, t.text]);

function root(text: string): JsonNode {
  const r = parse(text);
  if (!r.ok) throw new Error(r.message);
  return r.root;
}

/** Every lexer keeps every character, so colours line up with the text. */
function lossless(lexer: (line: string) => Token[], text: string) {
  for (const line of text.split(/\r?\n/)) {
    expect(
      lexer(line)
        .map((t) => t.text)
        .join("")
    ).toBe(line);
  }
}

const SAMPLE =
  '{"name": "Vellum", "id": 12, "on": true, "note": null, "tags": ["yes", "a: b"], "items": [{"sku": "A1", "qty": 2, "x y": "say \\"hi\\""}]}';

describe("lexYaml", () => {
  test("colours keys, sequence dashes and scalars", () => {
    expect(shown(lexYaml("  - sku: A1"))).toEqual([
      ["punct", "-"],
      ["key", "sku"],
      ["punct", ":"],
      ["string", "A1"],
    ]);
    expect(shown(lexYaml('"on": true # yes'))).toEqual([
      ["key", '"on"'],
      ["punct", ":"],
      ["literal", "true"],
      ["comment", "# yes"],
    ]);
    expect(shown(lexYaml("id: 12"))[2]).toEqual(["number", "12"]);
    expect(shown(lexYaml('- "yes"'))).toEqual([
      ["punct", "-"],
      ["string", '"yes"'],
    ]);
    expect(shown(lexYaml("items:"))).toEqual([
      ["key", "items"],
      ["punct", ":"],
    ]);
  });

  test("keeps every character of the converter's output", () => {
    lossless(lexYaml, toYaml(root(SAMPLE)));
  });
});

describe("lexCsv", () => {
  test("colours each column its own way, quoted commas and quotes included", () => {
    expect(shown(lexCsv('a,"x, ""y""",3'))).toEqual([
      ["key", "a"],
      ["punct", ","],
      ["string", '"x, ""y"""'],
      ["punct", ","],
      ["number", "3"],
    ]);
    expect(shown(lexCsv(",b"))).toEqual([
      ["punct", ","],
      ["string", "b"],
    ]);
  });

  test("keeps every character of the converter's output", () => {
    const csv = toCsv(root('[{"a": "x, y", "b": null}, {"c": [1, 2], "d": "say \\"hi\\""}]'));
    if (!csv.ok) throw new Error(csv.message);
    lossless(lexCsv, csv.text);
  });
});

describe("lexTypeScript", () => {
  test("tells keywords, properties and types apart", () => {
    expect(shown(lexTypeScript("export interface Root {"))).toEqual([
      ["literal", "export"],
      ["literal", "interface"],
      ["type", "Root"],
      ["punct", "{"],
    ]);
    expect(shown(lexTypeScript('  "x y"?: string | Item[] | null;'))).toEqual([
      ["key", '"x y"'],
      ["punct", "?"],
      ["punct", ":"],
      ["type", "string"],
      ["punct", "|"],
      ["type", "Item"],
      ["punct", "["],
      ["punct", "]"],
      ["punct", "|"],
      ["type", "null"],
      ["punct", ";"],
    ]);
  });

  test("keeps every character of the converter's output", () => {
    lossless(lexTypeScript, toTypeScript(root(SAMPLE)));
  });
});
