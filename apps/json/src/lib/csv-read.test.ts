import { describe, expect, test } from "bun:test";
import { parse } from "./ast.js";
import { columnNames, csvToJson, detectSeparator, looksLikeCsv, parseCsv } from "./csv-read.js";
import { toCsv } from "./convert.js";

describe("reading CSV", () => {
  test("quoted fields hold separators, line breaks and doubled quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,2\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
      ["1", "2"],
    ]);
  });

  test("the separator is found on the first line, outside quotes", () => {
    expect(detectSeparator("a;b;c\n1;2;3")).toBe(";");
    expect(detectSeparator("a\tb\n1\t2")).toBe("\t");
    expect(detectSeparator('"a,b";c;d\n')).toBe(";");
    expect(detectSeparator("just text")).toBe(",");
  });

  test("a byte-order mark is not part of the first column's name", () => {
    expect(parseCsv("﻿id,kb\n1,2")[0]).toEqual(["id", "kb"]);
  });

  test("blank and repeated column names get names of their own", () => {
    expect(columnNames(["id", "", "id", " name "], 5)).toEqual([
      "id",
      "column2",
      "id_2",
      "name",
      "column5",
    ]);
  });
});

describe("CSV to JSON", () => {
  test("each row is an object; numbers, booleans and null are values, the rest strings", () => {
    const out = csvToJson("id,kb,ok,note\nsvg,191,true,\njson,043,false,null\n")!;
    expect(JSON.parse(out)).toEqual([
      { id: "svg", kb: 191, ok: true, note: "" },
      { id: "json", kb: "043", ok: false, note: null },
    ]);
  });

  test("big numbers keep every digit: they are written as the CSV has them", () => {
    const out = csvToJson("id,n\na,12345678901234567890\n")!;
    expect(out).toContain('"n": 12345678901234567890');
  });

  test("short rows fill with empty strings; long ones get extra columns", () => {
    expect(JSON.parse(csvToJson("a,b\n1\n1,2,3")!)).toEqual([
      { a: 1, b: "", column3: "" },
      { a: 1, b: 2, column3: 3 },
    ]);
  });

  test("one row, or one column, is not a table", () => {
    expect(csvToJson("a,b")).toBeNull();
    expect(csvToJson("a\nb\nc")).toBeNull();
  });

  test("the CSV view's output reads back as the same table", () => {
    const r = parse('[{"id": "svg", "kb": 191}, {"id": "a \\"b\\", c", "kb": 43}]');
    if (!r.ok) throw new Error(r.message);
    const csv = toCsv(r.root);
    if (!csv.ok) throw new Error(csv.message);
    expect(JSON.parse(csvToJson(csv.text)!)).toEqual([
      { id: "svg", kb: 191 },
      { id: 'a "b", c', kb: 43 },
    ]);
  });

  test("JSON, broken or not, is never taken for CSV", () => {
    expect(looksLikeCsv('{"a": 1, "b": 2,}')).toBe(false);
    expect(looksLikeCsv("[1,2,\n3,4]")).toBe(false);
    expect(looksLikeCsv("id,kb\nsvg,191")).toBe(true);
  });
});
