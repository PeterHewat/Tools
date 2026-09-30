import { describe, expect, test } from "bun:test";
import { parseSvg } from "./parse-svg.js";

describe("parseSvg", () => {
  test("refuses a DOCTYPE, the only place entities can be declared", () => {
    const bomb = `<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>`;
    expect(() => parseSvg(bomb)).toThrow("DOCTYPE");
  });

  test("reports markup that does not parse", () => {
    expect(() => parseSvg("<svg")).toThrow();
  });

  test("returns the document", () => {
    const doc = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>`);
    expect(doc.querySelector("rect")?.getAttribute("width")).toBe("1");
  });
});
