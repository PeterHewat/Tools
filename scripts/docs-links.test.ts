import { expect, test } from "bun:test";
import { relativeLinks } from "./docs-links.ts";

test("only relative links outside fenced code are checked, without their anchors", () => {
  const markdown = [
    "See [the ADR](docs/adr/001.md#why), [GitHub](https://github.com) and [above](#top).",
    "```md",
    "[in code](missing.md)",
    "```",
    '[titled](../README.md "Readme") and [mail](mailto:a@b.c) and [spaced](a%20b.md)',
  ].join("\n");
  expect(relativeLinks(markdown)).toEqual([
    { path: "docs/adr/001.md", line: 1 },
    { path: "../README.md", line: 5 },
    { path: "a b.md", line: 5 },
  ]);
});
