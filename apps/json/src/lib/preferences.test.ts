import { expect, test } from "bun:test";
import { parsePrefs } from "./preferences.js";

test("older settings keep recognized fields and default anything missing or unknown", () => {
  expect(parsePrefs({ indent: "tab", sortKeys: true, view: "csv" })).toEqual({
    indent: "tab",
    sortKeys: true,
    view: "csv",
    pathStyle: "js",
    colours: true,
  });
  expect(
    parsePrefs({ indent: 4, sortKeys: "true", view: "future", pathStyle: "unknown", colours: 0 })
  ).toEqual(parsePrefs(null));
  expect(parsePrefs({ colours: false, pathStyle: "pointer" })).toMatchObject({
    colours: false,
    pathStyle: "pointer",
  });
});
