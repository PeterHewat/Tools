import { describe, expect, test } from "bun:test";
import {
  combine,
  costOf,
  diagnose,
  explain,
  findTimes,
  personSegments,
  summary,
} from "./availability.js";
import type { Person, Search } from "./availability.js";
import { readPlan, sharePlan, writePlan } from "./plan.js";

const utc = (iso: string) => Date.parse(iso);
const hours = (h: number, m = 0) => h * 60 + m;

function person(
  id: string,
  zone: string,
  windows: Person["windows"],
  extra: Partial<Person> = {}
): Person {
  return { id, name: id, zone, windows, exceptions: [], relaxed: false, ...extra };
}
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

describe("segments", () => {
  test("a window is read on the person's own clock, and outside windows is unavailable", () => {
    const paris = person("Ana", "Europe/Paris", [
      { days: EVERY_DAY, start: hours(18), end: hours(22), level: "preferred" },
    ]);
    const from = utc("2026-10-12T00:00:00Z");
    expect(personSegments(paris, from, from + 86_400_000)).toEqual([
      { start: from, end: utc("2026-10-12T16:00:00Z"), level: "unavailable" },
      { start: utc("2026-10-12T16:00:00Z"), end: utc("2026-10-12T20:00:00Z"), level: "preferred" },
      { start: utc("2026-10-12T20:00:00Z"), end: from + 86_400_000, level: "unavailable" },
    ]);
  });
  test("an evening window follows daylight-saving time rather than a fixed offset", () => {
    const paris = person("Ana", "Europe/Paris", [
      { days: EVERY_DAY, start: hours(18), end: hours(19), level: "preferred" },
    ]);
    const before = personSegments(paris, utc("2026-10-24T00:00:00Z"), utc("2026-10-25T00:00:00Z"));
    const after = personSegments(paris, utc("2026-10-26T00:00:00Z"), utc("2026-10-27T00:00:00Z"));
    expect(before.find((s) => s.level === "preferred")!.start).toBe(utc("2026-10-24T16:00:00Z"));
    expect(after.find((s) => s.level === "preferred")!.start).toBe(utc("2026-10-26T17:00:00Z"));
  });
  test("windows past midnight run into the next day; unavailable wins where windows overlap", () => {
    const owl = person("Owl", "UTC", [
      { days: [5], start: hours(22), end: hours(2), level: "preferred" },
      { days: [5], start: hours(20), end: hours(23, 30), level: "acceptable" },
      { days: [5], start: hours(23), end: hours(23, 30), level: "unavailable" },
    ]);
    // Friday 16 October 2026.
    const from = utc("2026-10-16T20:00:00Z");
    expect(personSegments(owl, from, utc("2026-10-17T03:00:00Z"))).toEqual([
      { start: from, end: utc("2026-10-16T22:00:00Z"), level: "acceptable" },
      { start: utc("2026-10-16T22:00:00Z"), end: utc("2026-10-16T23:00:00Z"), level: "preferred" },
      {
        start: utc("2026-10-16T23:00:00Z"),
        end: utc("2026-10-16T23:30:00Z"),
        level: "unavailable",
      },
      { start: utc("2026-10-16T23:30:00Z"), end: utc("2026-10-17T02:00:00Z"), level: "preferred" },
      {
        start: utc("2026-10-17T02:00:00Z"),
        end: utc("2026-10-17T03:00:00Z"),
        level: "unavailable",
      },
    ]);
  });
  test("a date exception replaces the windows that start on that date", () => {
    const busy = person(
      "Bo",
      "UTC",
      [{ days: EVERY_DAY, start: hours(9), end: hours(17), level: "preferred" }],
      {
        exceptions: [{ date: "2026-10-13", windows: [] }],
      }
    );
    const segments = personSegments(busy, utc("2026-10-13T00:00:00Z"), utc("2026-10-14T00:00:00Z"));
    expect(segments).toEqual([
      {
        start: utc("2026-10-13T00:00:00Z"),
        end: utc("2026-10-14T00:00:00Z"),
        level: "unavailable",
      },
    ]);
  });
  test("a window that ends where it starts is the whole day", () => {
    const always = person("Al", "UTC", [
      { days: EVERY_DAY, start: 0, end: 0, level: "acceptable" },
    ]);
    expect(
      personSegments(always, utc("2026-10-13T00:00:00Z"), utc("2026-10-15T00:00:00Z"))
    ).toEqual([
      { start: utc("2026-10-13T00:00:00Z"), end: utc("2026-10-15T00:00:00Z"), level: "acceptable" },
    ]);
  });
});

describe("finding a time", () => {
  // Ana in Paris prefers 18:00 to 21:00, accepts from 08:00 to 22:00. Ben in New York prefers
  // 12:00 to 15:00, accepts from 08:00 to 20:00. 12 October 2026: Paris is UTC+2, New York UTC-4.
  const ana = person("Ana", "Europe/Paris", [
    { days: EVERY_DAY, start: hours(8), end: hours(22), level: "acceptable" },
    { days: EVERY_DAY, start: hours(18), end: hours(21), level: "preferred" },
  ]);
  const ben = person("Ben", "America/New_York", [
    { days: EVERY_DAY, start: hours(8), end: hours(20), level: "acceptable" },
    { days: EVERY_DAY, start: hours(12), end: hours(15), level: "preferred" },
  ]);
  const day: Search = {
    from: utc("2026-10-12T00:00:00Z"),
    to: utc("2026-10-13T00:00:00Z"),
    duration: 60,
    step: 15,
  };

  test("fully preferred overlaps come first, as one suggestion for a run of starts", () => {
    const found = findTimes([ana, ben], day);
    // Both preferred: 16:00–19:00 UTC overlaps 16:00–19:00 UTC: starts from 16:00 to 18:00.
    expect(found[0]).toEqual({
      start: utc("2026-10-12T16:00:00Z"),
      last: utc("2026-10-12T18:00:00Z"),
      costs: [
        { acceptable: 0, unavailable: 0 },
        { acceptable: 0, unavailable: 0 },
      ],
    });
    expect(explain([ana, ben], found[0].costs)).toBe("Everyone: preferred hours.");
  });

  test("compromises minimise the worst person's minutes before the total", () => {
    const tight = {
      ...ana,
      windows: [
        ...ana.windows.slice(0, 1),
        { days: EVERY_DAY, start: hours(21), end: hours(22), level: "preferred" as const },
      ],
    };
    // Ana prefers 19:00–20:00 UTC; Ben prefers 16:00–19:00 UTC; both accept 12:00–20:00 UTC.
    const found = findTimes([tight, ben], day);
    const first = found[0];
    const worst = Math.max(...first.costs.map((c) => c.acceptable));
    for (const other of found)
      expect(Math.max(...other.costs.map((c) => c.acceptable))).toBeGreaterThanOrEqual(worst);
    // A call from 18:30 costs each 30 minutes: better than 0 for one and 60 for the other.
    expect(first.start).toBe(utc("2026-10-12T18:30:00Z"));
    expect(explain([tight, ben], first.costs)).toBe(
      "Ana: 30 min outside preferred hours; Ben: 30 min outside preferred hours."
    );
  });

  test("the whole call must fit, not only its start", () => {
    const found = findTimes([ana, ben], { ...day, duration: 120 });
    for (const s of found)
      expect(s.last + 120 * 60_000).toBeLessThanOrEqual(utc("2026-10-13T00:00:00Z"));
    // Ben stops accepting at 00:00 UTC (20:00 New York): the last start is 22:00 UTC.
    expect(Math.max(...found.map((s) => s.last))).toBe(utc("2026-10-12T18:00:00Z"));
  });

  test("unavailable time is excluded unless relaxed, and relaxed times rank last", () => {
    const early = person("Cy", "Asia/Tokyo", [
      { days: EVERY_DAY, start: hours(7), end: hours(9), level: "acceptable" },
    ]);
    // Cy accepts 22:00–00:00 UTC; Ana stops at 20:00 UTC.
    expect(findTimes([ana, early], day)).toEqual([]);
    const diagnosis = diagnose([ana, early], day);
    expect(diagnosis.alone).toEqual([]);
    expect(diagnosis.blocking.map((b) => b.id).sort()).toEqual(["Ana", "Cy"]);
    const relaxed = findTimes([{ ...ana, relaxed: true }, early], day);
    expect(relaxed.length).toBeGreaterThan(0);
    expect(relaxed[0].costs[0].unavailable).toBeGreaterThan(0);
    expect(explain([ana, early], relaxed[0].costs)).toContain("Ana: 1 h in unavailable time");
  });

  test("someone with no window long enough is named", () => {
    const brief = person("Di", "UTC", [
      { days: EVERY_DAY, start: hours(10), end: hours(10, 30), level: "preferred" },
    ]);
    expect(diagnose([ana, brief], day).alone).toEqual(["Di"]);
  });

  test("costs count minutes at each level", () => {
    const segments = personSegments(ana, day.from, day.to);
    expect(costOf(segments, utc("2026-10-12T15:30:00Z"), utc("2026-10-12T16:30:00Z"))).toEqual({
      acceptable: 30,
      unavailable: 0,
    });
    expect(costOf(segments, utc("2026-10-12T19:30:00Z"), utc("2026-10-12T20:30:00Z"))).toEqual({
      acceptable: 30,
      unavailable: 30,
    });
  });

  test("everyone's levels combine to the worst at each moment", () => {
    const both = combine(
      [personSegments(ana, day.from, day.to), personSegments(ben, day.from, day.to)],
      day.from,
      day.to
    );
    expect(both.find((s) => s.level === "preferred")).toEqual({
      start: utc("2026-10-12T16:00:00Z"),
      end: utc("2026-10-12T19:00:00Z"),
      level: "preferred",
    });
  });

  test("a summary gives each person their own date and time", () => {
    const tokyo = person("Kai", "Asia/Tokyo", []);
    expect(
      summary([ana, ben, tokyo], utc("2026-10-12T18:00:00Z"), 60, {
        locale: "en-GB",
        hour12: false,
      })
    ).toBe(
      [
        "Call, 1 h",
        "Ana (Europe/Paris): Mon 12 Oct, 20:00–21:00",
        "Ben (America/New_York): Mon 12 Oct, 14:00–15:00",
        "Kai (Asia/Tokyo): Tue 13 Oct, 03:00–04:00",
      ].join("\n")
    );
  });
});

describe("saved plans", () => {
  test("read field by field: what is valid is kept, the rest defaulted or dropped", () => {
    const plan = readPlan({
      version: 1,
      duration: "long",
      people: [
        {
          id: "a",
          name: "Ana",
          zone: "Europe/Paris",
          relaxed: true,
          windows: [
            { days: [1, 1, 9, 2], start: 60, end: 120, level: "preferred" },
            { days: [], start: 60, end: 120, level: "preferred" },
            { days: [3], start: 60, end: 2000 },
            { days: [3], start: 60, end: 90, level: "mystery" },
          ],
          exceptions: [
            { date: "2026-10-13", windows: [{ start: 0, end: 60, level: "acceptable" }, "x"] },
            { date: "2026-10-13", windows: [] },
            { date: "not a date", windows: [] },
          ],
        },
        { id: "a", name: 7, zone: "Asia/Tokyo" },
        { name: "No zone" },
        "nobody",
      ],
    });
    expect(plan!.duration).toBe(60);
    expect(plan!.people).toHaveLength(2);
    const [ana, second] = plan!.people;
    expect(ana).toEqual({
      id: "a",
      name: "Ana",
      zone: "Europe/Paris",
      relaxed: true,
      windows: [
        { days: [1, 2], start: 60, end: 120, level: "preferred" },
        { days: [3], start: 60, end: 90, level: "acceptable" },
      ],
      exceptions: [{ date: "2026-10-13", windows: [{ start: 0, end: 60, level: "acceptable" }] }],
    });
    expect(second.id).not.toBe("a");
    expect(second).toMatchObject({
      name: "",
      zone: "Asia/Tokyo",
      windows: [],
      exceptions: [],
      relaxed: false,
    });
    expect(readPlan("nothing")).toBeUndefined();
  });
  test("what is written reads back the same; a shared plan leaves out the ids", () => {
    const plan = readPlan({
      people: [{ id: "x", name: "Ana", zone: "UTC", windows: [], exceptions: [] }],
      duration: 30,
    })!;
    expect(readPlan(JSON.parse(JSON.stringify(writePlan(plan))))).toEqual(plan);
    const shared = sharePlan(plan);
    expect(JSON.stringify(shared)).not.toContain('"id"');
    expect(readPlan(shared)!.people[0]).toMatchObject({ name: "Ana", zone: "UTC" });
  });
});
