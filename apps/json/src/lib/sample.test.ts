import { expect, test } from "bun:test";
import { parse } from "./ast.js";
import { SAMPLE } from "./sample.js";

const ART = await Bun.file(new URL("../../public/art.svg", import.meta.url)).text();

test("the sample is valid JSON", () => {
  const parsed = parse(SAMPLE);
  expect(parsed.ok && parsed.edits).toEqual([]);
});

test("the index card shows the sample, line for line", () => {
  // Each code line of the art is a <text xml:space="preserve"> of coloured spans; the
  // indentation is its x, so compare the lines without their leading spaces.
  // A line's text is what lies between its tags, with entities decoded in one pass.
  const ENTITIES: Record<string, string> = { quot: '"', lt: "<", gt: ">", amp: "&" };
  const lines = [...ART.matchAll(/<text [^>]*xml:space="preserve">(.*?)<\/text>/g)].map((m) =>
    [...`>${m[1]!}<`.matchAll(/>([^<]*)</g)]
      .map((t) => t[1]!.replace(/&(quot|lt|gt|amp);/g, (_, e: string) => ENTITIES[e]!))
      .join("")
  );
  expect(lines).toEqual(
    SAMPLE.trimEnd()
      .split("\n")
      .map((l) => l.trimStart())
  );
});
