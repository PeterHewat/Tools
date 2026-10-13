import { describe, expect, test } from "bun:test";
import { formatClock, formatIsoDate, parseClock, parseIsoDate } from "./time-fields.js";

describe("time fields", () => {
  test("times of day are read on the 24-hour clock, however they are typed", () => {
    const at = (minutes: number, second = 0) => ({ minutes, second });
    expect(parseClock("09:30")).toEqual(at(570));
    for (const typed of ["9:30", "0930", "930", "9.30", "9h30", " 09:30 "])
      expect(parseClock(typed)).toEqual(at(570));
    expect(parseClock("9")).toEqual(at(540));
    expect(parseClock("23:59:59")).toEqual(at(1439, 59));
    expect(parseClock("235959")).toEqual(at(1439, 59));
    expect(parseClock("14:30:15.5")).toEqual(at(870, 15));
    for (const wrong of ["24:00", "12:60", "12:30:60", "9:3", "2:30 PM", "", "12:30:"])
      expect(parseClock(wrong)).toBeUndefined();
  });
  test("they are written as HH:MM, with seconds when given", () => {
    expect(formatClock(570)).toBe("09:30");
    expect(formatClock(570, 5)).toBe("09:30:05");
    expect(formatClock(1439, 0)).toBe("23:59:00");
  });
  test("dates are read year first, however they are typed, and only if the calendar has them", () => {
    const day = { year: 2026, month: 10, day: 5 };
    for (const typed of [
      "2026-10-05",
      "2026-10-5",
      "2026/10/05",
      "2026.10.5",
      "20261005",
      " 2026-10-05 ",
    ])
      expect(parseIsoDate(typed)).toEqual(day);
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    for (const wrong of [
      "2026-02-29",
      "2026-13-01",
      "2026-04-31",
      "10/05/2026",
      "05.10.2026",
      "",
      "2026-10",
    ])
      expect(parseIsoDate(wrong)).toBeUndefined();
    expect(formatIsoDate(day)).toBe("2026-10-05");
    expect(formatIsoDate({ year: 33, month: 1, day: 1 })).toBe("0033-01-01");
  });
});
