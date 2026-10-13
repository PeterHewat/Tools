import { describe, expect, test } from "bun:test";
import { formatClock, parseClock } from "./clock.js";

describe("clock", () => {
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
});
