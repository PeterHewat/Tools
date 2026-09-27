import { expect, test } from "bun:test";
import { parseJson } from "@tools/codec";
import { SAMPLE } from "./sample.js";

const ART = await Bun.file(new URL("../../public/art.svg", import.meta.url)).text();

test("the sample is valid JSON", () => {
  expect(parseJson(SAMPLE).ok).toBe(true);
});

test("the index card shows the sample, line for line", () => {
  // Each code line of the art is a <text xml:space="preserve"> of coloured spans; the
  // indentation is its x, so compare the lines without their leading spaces.
  const lines = [...ART.matchAll(/<text [^>]*xml:space="preserve">(.*?)<\/text>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
  );
  expect(lines).toEqual(
    SAMPLE.trimEnd()
      .split("\n")
      .map((l) => l.trimStart())
  );
});
