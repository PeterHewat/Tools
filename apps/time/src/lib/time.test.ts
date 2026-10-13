import { describe, expect, test } from "bun:test";
import {
  addMonths,
  DAY,
  HOUR,
  civilFromDays,
  daysFromCivil,
  parseClock,
  weekday,
  wallFromMs,
  wallMs,
} from "./civil.js";
import { calendarSpan, describeSpan, nextAnniversary, totalIn } from "./duration.js";
import { formatOffset, httpDate, isoString, relativeTime } from "./format.js";
import { detectUnit, parseTime } from "./parse.js";
import { canonicalZone, findZone, offsetAt, offsetSpans, resolveWall, wallAt } from "./zone.js";

const wall = (iso: string) => {
  const p = parseTime(iso);
  if (p.kind !== "wall") throw new Error("not a wall time: " + iso);
  return p.wall;
};
const utc = (iso: string) => Date.parse(iso);

describe("civil dates", () => {
  test("day numbers round-trip across eras and leap years", () => {
    for (const days of [-1_000_000, -719468, -1, 0, 1, 11016, 20000, 2_932_896])
      expect(
        daysFromCivil(...(Object.values(civilFromDays(days)) as [number, number, number]))
      ).toBe(days);
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2000, 3, 1)).toBe(11017);
  });
  test("wall times read as UTC milliseconds", () => {
    const ms = utc("2026-10-12T10:15:30.250Z");
    expect(wallMs(wallFromMs(ms))).toBe(ms);
    expect(wallFromMs(-1)).toMatchObject({ year: 1969, month: 12, day: 31, hour: 23, ms: 999 });
  });
  test("weekdays are ISO, Monday first", () => {
    expect(weekday({ year: 2026, month: 10, day: 12 })).toBe(1);
    expect(weekday({ year: 2026, month: 10, day: 18 })).toBe(7);
  });
  test("months too short end at their last day", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(addMonths({ year: 2026, month: 3, day: 15 }, -3)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });
  test("clock times", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("23:59:59")).toBe(1439);
    expect(parseClock("24:00")).toBeUndefined();
  });
});

describe("zones", () => {
  test("names are found however they are typed", () => {
    expect(findZone("europe/paris")).toBe("Europe/Paris");
    expect(findZone("New York")).toBe("America/New_York");
    expect(findZone("tokyo")).toBe("Asia/Tokyo");
    expect(findZone("utc")).toBe("UTC");
    expect(findZone("Atlantis/Lost")).toBeUndefined();
    expect(canonicalZone("+05:30")).toBeUndefined();
  });
  test("offsets follow daylight-saving time and fractional hours", () => {
    expect(offsetAt(utc("2026-01-15T12:00:00Z"), "Europe/Paris")).toBe(3_600_000);
    expect(offsetAt(utc("2026-07-15T12:00:00Z"), "Europe/Paris")).toBe(7_200_000);
    expect(offsetAt(utc("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3_600_000);
    expect(offsetAt(utc("2026-07-15T12:00:00Z"), "Asia/Kathmandu")).toBe(5.75 * 3_600_000);
    expect(offsetAt(utc("2026-07-15T12:00:00Z"), "America/St_Johns")).toBe(-2.5 * 3_600_000);
  });
  test("a wall time that happens twice is ambiguous", () => {
    // Paris turns its clocks back from 03:00 CEST to 02:00 CET on 25 October 2026.
    const found = resolveWall(wall("2026-10-25T02:30"), "Europe/Paris");
    expect(found).toEqual({
      kind: "ambiguous",
      earlier: utc("2026-10-25T00:30:00Z"),
      later: utc("2026-10-25T01:30:00Z"),
    });
  });
  test("a wall time that never happens is a gap, read after the change", () => {
    // Paris moves from 02:00 CET to 03:00 CEST on 29 March 2026.
    const found = resolveWall(wall("2026-03-29T02:30"), "Europe/Paris");
    expect(found).toEqual({
      kind: "gap",
      ms: utc("2026-03-29T01:30:00Z"),
      before: 3_600_000,
      after: 7_200_000,
    });
    expect(wallAt(utc("2026-03-29T01:30:00Z"), "Europe/Paris")).toMatchObject({
      hour: 3,
      minute: 30,
    });
  });
  test("ordinary times are exact, in any zone", () => {
    expect(resolveWall(wall("2026-10-12T14:30"), "America/New_York")).toEqual({
      kind: "exact",
      ms: utc("2026-10-12T18:30:00Z"),
    });
    expect(resolveWall(wall("2026-10-12T14:30"), "UTC")).toEqual({
      kind: "exact",
      ms: utc("2026-10-12T14:30:00Z"),
    });
  });
  test("a stretch of time is cut where the offset changes, to the millisecond", () => {
    // Lord Howe Island moves its clocks by half an hour.
    expect(
      offsetSpans(utc("2026-04-04T00:00:00Z"), utc("2026-04-05T00:00:00Z"), "Australia/Lord_Howe")
    ).toEqual([
      { start: utc("2026-04-04T00:00:00Z"), end: utc("2026-04-04T15:00:00Z"), offset: 11 * HOUR },
      {
        start: utc("2026-04-04T15:00:00Z"),
        end: utc("2026-04-05T00:00:00Z"),
        offset: 10.5 * HOUR,
      },
    ]);
    expect(offsetSpans(0, DAY, "UTC")).toEqual([{ start: 0, end: DAY, offset: 0 }]);
  });
  test("years before 1 are counted with year 0", () => {
    expect(wallAt(utc("0000-06-01T00:00:00Z"), "UTC").year).toBe(0);
    expect(wallAt(Date.UTC(-1, 5, 1) + 0, "Europe/London").year).toBe(-1);
  });
});

describe("parsing", () => {
  test("numbers are Unix time, in the unit their size suggests unless one is given", () => {
    expect(parseTime("1760264100")).toEqual({
      kind: "unix",
      ms: 1760264100000,
      unit: "s",
      detected: true,
    });
    expect(parseTime("1760264100000")).toEqual({
      kind: "unix",
      ms: 1760264100000,
      unit: "ms",
      detected: true,
    });
    expect(parseTime("1760264100000000", "s")).toEqual({
      kind: "error",
      message: "Out of range for a date.",
    });
    expect(parseTime("1760264100", "ms")).toEqual({
      kind: "unix",
      ms: 1760264100,
      unit: "ms",
      detected: false,
    });
    expect(parseTime("-1.5")).toMatchObject({ kind: "unix", ms: -1500 });
    expect(detectUnit(99_999_999_999)).toBe("s");
  });
  test("ISO 8601 with an offset is one instant", () => {
    expect(parseTime("2026-10-12T10:15:00Z")).toMatchObject({
      kind: "instant",
      ms: utc("2026-10-12T10:15:00Z"),
      offset: 0,
    });
    expect(parseTime("2026-10-12T10:15:00.5+05:30")).toMatchObject({
      kind: "instant",
      ms: utc("2026-10-12T04:45:00.500Z"),
    });
    expect(parseTime("20261012T101500-0400")).toMatchObject({ ms: utc("2026-10-12T14:15:00Z") });
    expect(parseTime("2026-10-12 10:15+02:00[Europe/Paris]")).toMatchObject({
      kind: "instant",
      zone: "Europe/Paris",
    });
  });
  test("ISO 8601 without an offset is a wall time, a date alone at midnight", () => {
    expect(parseTime("2026-10-12T10:15")).toMatchObject({
      kind: "wall",
      dateOnly: false,
      wall: { hour: 10, minute: 15 },
    });
    expect(parseTime("2026-10-12")).toMatchObject({
      kind: "wall",
      dateOnly: true,
      wall: { hour: 0 },
    });
    expect(parseTime("2026-10-12T10:15[asia/tokyo]")).toMatchObject({
      kind: "wall",
      zone: "Asia/Tokyo",
    });
  });
  test("HTTP and email dates", () => {
    expect(parseTime("Mon, 12 Oct 2026 10:15:00 GMT")).toMatchObject({
      kind: "instant",
      ms: utc("2026-10-12T10:15:00Z"),
    });
    expect(parseTime("12 Oct 2026 10:15 -0700")).toMatchObject({ ms: utc("2026-10-12T17:15:00Z") });
    expect(parseTime("Mon, 12 Oct 2026 10:15:00 EDT")).toMatchObject({
      ms: utc("2026-10-12T14:15:00Z"),
    });
  });
  test("refuses what is not a date, and says why", () => {
    expect(parseTime("2026-02-30")).toEqual({
      kind: "error",
      message: "That date does not exist.",
    });
    expect(parseTime("2026-10-12T25:00").kind).toBe("error");
    expect(parseTime("2026-10-12Z").kind).toBe("error");
    expect(parseTime("2026-10-12T10:00+25:00").kind).toBe("error");
    expect(parseTime("2026-10-12T10:00[Nowhere/Here]")).toEqual({
      kind: "error",
      message: 'Unknown time zone "Nowhere/Here".',
    });
    expect(parseTime("yesterday").kind).toBe("error");
  });
  test("precision past milliseconds is dropped, and said", () => {
    expect(parseTime("2026-10-12T10:15:00.123456Z")).toMatchObject({
      dropped: true,
      ms: utc("2026-10-12T10:15:00.123Z"),
    });
    expect(parseTime("2026-10-12T10:15:00.123000Z")).toMatchObject({ dropped: false });
  });
});

describe("formatting", () => {
  test("ISO 8601 in a zone carries the offset at that instant", () => {
    const ms = utc("2026-10-12T08:15:00Z");
    expect(isoString(ms, "UTC")).toBe("2026-10-12T08:15:00Z");
    expect(isoString(ms, "Europe/Paris")).toBe("2026-10-12T10:15:00+02:00");
    expect(isoString(ms + 5, "Asia/Kolkata")).toBe("2026-10-12T13:45:00.005+05:30");
    expect(isoString(utc("+012026-01-01T00:00:00Z"), "UTC")).toBe("+012026-01-01T00:00:00Z");
  });
  test("offsets, HTTP dates and relative times", () => {
    expect(formatOffset(-9_000_000)).toBe("-02:30");
    expect(formatOffset(561_000)).toBe("+00:09:21");
    expect(httpDate(utc("2026-10-12T08:15:00Z"))).toBe("Mon, 12 Oct 2026 08:15:00 GMT");
    const now = utc("2026-10-12T08:00:00Z");
    expect(relativeTime(now + 3 * 3_600_000, now, "en")).toBe("in 3 hours");
    expect(relativeTime(now - 2 * 86_400_000, now, "en")).toBe("2 days ago");
    expect(relativeTime(now, now, "en")).toBe("now");
  });
});

describe("durations", () => {
  test("calendar age counts whole years, months and days on the wall clock", () => {
    const span = calendarSpan(utc("1990-05-20T00:00:00Z"), utc("2026-10-12T15:30:00Z"), "UTC");
    expect(span).toMatchObject({
      negative: false,
      years: 36,
      months: 4,
      days: 22,
      hours: 15,
      minutes: 30,
    });
    expect(describeSpan(span, false)).toBe("36 years, 4 months, 22 days");
  });
  test("a 29 February birthday counts on 28 February in other years", () => {
    const span = calendarSpan(utc("2000-02-29T00:00:00Z"), utc("2001-02-28T00:00:00Z"), "UTC");
    expect(span).toMatchObject({ years: 1, months: 0, days: 0 });
    expect(
      nextAnniversary({ year: 2000, month: 2, day: 29 }, { year: 2026, month: 3, day: 1 })
    ).toEqual({
      date: { year: 2027, month: 2, day: 28 },
      years: 27,
    });
    expect(
      nextAnniversary({ year: 2000, month: 5, day: 20 }, { year: 2026, month: 5, day: 20 })
    ).toEqual({
      date: { year: 2026, month: 5, day: 20 },
      years: 26,
    });
  });
  test("a month from the 31st ends at the next month's last day", () => {
    const span = calendarSpan(utc("2026-01-31T00:00:00Z"), utc("2026-03-01T00:00:00Z"), "UTC");
    expect(span).toMatchObject({ months: 1, days: 1 });
  });
  test("a day across a clock change is one calendar day but 23 elapsed hours", () => {
    const start = utc("2026-03-28T11:00:00Z"); // noon in Paris, CET
    const end = utc("2026-03-29T10:00:00Z"); // noon in Paris, CEST
    expect(calendarSpan(start, end, "Europe/Paris")).toMatchObject({ days: 1, hours: 0 });
    expect(totalIn(end - start, "hours", "down")).toBe(23);
    expect(totalIn(end - start, "days", "down")).toBe(0);
    expect(totalIn(end - start, "days", "nearest")).toBe(1);
  });
  test("an end before the start counts backwards", () => {
    const span = calendarSpan(utc("2026-10-12T00:00:00Z"), utc("2026-10-10T12:00:00Z"), "UTC");
    expect(span).toMatchObject({ negative: true, days: 1, hours: 12 });
    expect(totalIn(-90 * 60_000, "hours", "down")).toBe(-1);
    expect(totalIn(-90 * 60_000, "hours", "nearest")).toBe(-2);
  });
});
