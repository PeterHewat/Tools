import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { lexLine, startsInComment, type BlockComment, type Token } from "./colour.js";

/** Strings, block comments (possibly unterminated on the line) and everything else. */
const lexer = (line: string): Token[] =>
  [...line.matchAll(/("(?:[^"\\]|\\.)*"?)|(\/\*.*?(?:\*\/|$))|([^"/]+|\/)/g)].map((m) => ({
    kind: m[1] !== undefined ? "string" : m[2] !== undefined ? "comment" : "plain",
    text: m[0],
  }));

const C: BlockComment = ["/*", "*/"];

describe("lexLine", () => {
  test("a comment left open on a line carries to the next", () => {
    expect(lexLine(lexer, '"a": 1, /* note', false, C)).toEqual({
      spans: [
        [0, 3, "string"],
        [8, 15, "comment"],
      ],
      open: true,
    });
    expect(lexLine(lexer, '"a": 1 /* done */', false, C).open).toBe(false);
  });

  test("a line inside a comment is all comment, until it closes", () => {
    expect(lexLine(lexer, "still going", true, C)).toEqual({
      spans: [[0, 11, "comment"]],
      open: true,
    });
    expect(lexLine(lexer, 'end */ "b"', true, C)).toEqual({
      spans: [
        [0, 6, "comment"],
        [7, 10, "string"],
      ],
      open: false,
    });
  });

  test("without markers, lines are independent", () => {
    expect(lexLine(lexer, "/* open", false).open).toBe(false);
  });
});

describe("startsInComment", () => {
  const doc = (lines: string[]) => Text.of(lines);
  const lineStart = (t: Text, n: number) => t.line(n).from;

  test("finds a comment opened on an earlier line and not yet closed", () => {
    const t = doc(["{", "  /* a", "  b", "  c */", '  "d": 1', "}"]);
    expect(startsInComment(t, lineStart(t, 3), lexer, C)).toBe(true);
    expect(startsInComment(t, lineStart(t, 4), lexer, C)).toBe(true);
    expect(startsInComment(t, lineStart(t, 5), lexer, C)).toBe(false);
    expect(startsInComment(t, lineStart(t, 2), lexer, C)).toBe(false);
  });

  test("an opener inside a string is not a comment", () => {
    const t = doc(['"url": "a/*b",', '"c": 1']);
    expect(startsInComment(t, lineStart(t, 2), lexer, C)).toBe(false);
  });
});
