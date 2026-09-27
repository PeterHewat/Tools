import { describe, expect, test } from "bun:test";
import { lineCount, lineOf, lineStarts, pageAt, pageOf } from "./pages.js";

const text = Array.from({ length: 10 }, (_, k) => `line ${k + 1}`).join("\n");

describe("pageOf", () => {
  test("splits into pages of whole lines that join back exactly", () => {
    for (let k = 0; k < 4; k++) {
      const p = pageOf(text, k, 3);
      expect(p.before + p.body + p.after).toBe(text);
      expect(p.count).toBe(4);
    }
    const second = pageOf(text, 1, 3);
    expect(second.body).toBe("line 4\nline 5\nline 6");
    expect(second.firstLine).toBe(4);
    expect(second.before.endsWith("line 3\n")).toBe(true);
    expect(second.after.startsWith("\nline 7")).toBe(true);
  });

  test("the last page runs to the end, and out-of-range pages clamp", () => {
    const last = pageOf(text, 3, 3);
    expect([last.body, last.after, last.index]).toEqual(["line 10", "", 3]);
    expect(pageOf(text, 99, 3).index).toBe(3);
    expect(pageOf(text, -1, 3).index).toBe(0);
  });

  test("a document that fits is one page with nothing aside", () => {
    expect(pageOf(text, 0, 50)).toEqual({
      before: "",
      body: text,
      after: "",
      firstLine: 1,
      index: 0,
      count: 1,
    });
  });

  test("keeps empty lines and a trailing line break", () => {
    const t = "a\n\nb\n";
    const p = pageOf(t, 1, 2);
    expect([p.body, p.before + p.body + p.after]).toEqual(["b\n", t]);
  });
});

test("pageAt finds the page holding an offset", () => {
  expect(pageAt(text, 0, 3)).toBe(0);
  expect(pageAt(text, text.indexOf("line 4"), 3)).toBe(1);
  expect(pageAt(text, text.indexOf("line 3") + 5, 3)).toBe(0);
  expect(pageAt(text, text.length, 3)).toBe(3);
  expect(lineCount(text)).toBe(10);
});

test("lineOf finds the line of any offset from lineStarts", () => {
  const t = "ab\n\ncd\n";
  const starts = lineStarts(t);
  expect(starts).toEqual([0, 3, 4, 7]);
  expect([0, 2, 3, 4, 6, 7].map((o) => lineOf(starts, o))).toEqual([1, 1, 2, 3, 3, 4]);
});
