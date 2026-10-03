import { describe, expect, test } from "bun:test";
import { applyEdits, parse, strictNumber, type ParseResult } from "./ast.js";

function ok(text: string): Extract<ParseResult, { ok: true }> {
  const r = parse(text);
  if (!r.ok) throw new Error(`${JSON.stringify(text)} failed: ${r.message} at ${r.offset}`);
  return r;
}

function repaired(text: string): string {
  return applyEdits(text, ok(text).edits);
}

describe("parse: strict JSON", () => {
  test("has no edits, and keeps each value's span and source text", () => {
    const text = '{"a": [1.0, "x\\u00e9"], "b": null}';
    const r = ok(text);
    expect(r.edits).toEqual([]);
    expect(r.root.kind).toBe("object");
    if (r.root.kind !== "object") return;
    const [a, b] = r.root.members;
    expect(a.key).toBe("a");
    expect(a.keyStart).toBe(1);
    expect(text.slice(a.value.start, a.value.end)).toBe('[1.0, "x\\u00e9"]');
    expect(a.value.kind === "array" && a.value.items.map((v) => "raw" in v && v.raw)).toEqual([
      "1.0",
      '"x\\u00e9"',
    ]);
    const at = text.indexOf("null");
    expect(b.value).toEqual({ kind: "null", start: at, end: at + 4, raw: "null" });
  });

  test("counts values and depth, and decodes escaped keys", () => {
    const r = ok('{"\\u0061": [1, [2]], "b": {}}');
    expect([r.values, r.depth]).toEqual([6, 3]);
    expect(r.root.kind === "object" && r.root.members[0].key).toBe("a");
    expect([ok("1").values, ok("1").depth]).toEqual([1, 0]);
  });

  test("finds duplicate keys in the same object only", () => {
    const r = ok('{"a": 1, "b": {"a": 2}, "a": 3}');
    expect(r.duplicates).toEqual([{ key: "a", offset: 24 }]);
  });

  test("rejects what is not JSON even leniently, with an offset", () => {
    expect(parse("")).toMatchObject({ ok: false, offset: 0 });
    expect(parse("[1 2]")).toMatchObject({ ok: false, offset: 3 });
    expect(parse('{"a" 1}')).toMatchObject({ ok: false, offset: 5 });
    expect(parse('"abc')).toMatchObject({ ok: false, message: "Unterminated string" });
    expect(parse('["a\nb"]')).toMatchObject({ ok: false, offset: 3 });
    expect(parse("[hello]")).toMatchObject({ ok: false, offset: 1 });
    expect(parse("1 2")).toMatchObject({ ok: false, offset: 2 });
  });

  test("survives nesting deeper than the call stack", () => {
    expect(ok("[".repeat(50_000) + "]".repeat(50_000)).depth).toBe(50_000);
  });
});

describe("parse: almost JSON, repaired in place", () => {
  test("drops comments and trailing commas, keeping the layout", () => {
    const text = '{\n  // note\n  "a": 1, /* why */\n  "b": [1, 2,],\n}';
    expect(repaired(text)).toBe('{\n  "a": 1,\n  "b": [1, 2]\n}');
    expect(ok(text).edits.map((e) => e.kind)).toEqual([
      "comment",
      "comment",
      "trailing comma",
      "trailing comma",
    ]);
  });

  test("a comment beside another repair on its line leaves the rest alone", () => {
    expect(repaired("[\n  'a', // x\n  /* y */ 1 /* z */\n]")).toBe('[\n  "a",\n  1\n]');
  });

  test("quotes keys and requotes single-quoted strings", () => {
    expect(repaired("{name: 'it\\'s \"x\"', $id: 1}")).toBe('{"name": "it\'s \\"x\\"", "$id": 1}');
  });

  test("rewrites loose escapes and raw control characters in strings", () => {
    expect(repaired('["\\x41\\v", "a\tb"]')).toBe('["A\\u000b", "a\\tb"]');
  });

  test("turns Python and JavaScript literals into JSON ones", () => {
    expect(repaired("[True, False, None, undefined, NaN, -Infinity]")).toBe(
      "[true, false, null, null, null, null]"
    );
  });

  test("rewrites JSON5 numbers exactly", () => {
    expect(repaired("[+1, .5, 5., 0x1F, -0XfF, 007, 1.e3]")).toBe("[1, 0.5, 5, 31, -255, 7, 1e3]");
    expect(strictNumber("0x1FFFFFFFFFFFFFFF")).toBe("2305843009213693951");
  });

  test("a repaired document parses strictly to the same values", () => {
    const text = "{a: [1, 2,], 'b': {c: .5}, // end\n}";
    const fixed = repaired(text);
    expect(ok(fixed).edits).toEqual([]);
    expect(JSON.parse(fixed)).toEqual({ a: [1, 2], b: { c: 0.5 } });
  });

  test("an unterminated comment is an error, not an edit", () => {
    expect(parse("[1 /* oops")).toMatchObject({ ok: false, message: "Unterminated comment" });
  });
});
