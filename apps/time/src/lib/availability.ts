/**
 * Find a time: people's availability, each in their own zone, compared at the same instants.
 *
 * The model: a person's windows say when they are **preferred** or **acceptable**, or mark time
 * **unavailable** inside them; any time outside every window is unavailable. Where windows
 * overlap, unavailable wins over preferred, and preferred over acceptable. Weekly windows apply on
 * the weekdays they name; a date exception replaces the windows that start on that date. A
 * window whose end is not after its start runs past midnight into the next day, and one that
 * ends where it starts lasts the whole day.
 *
 * Windows are read on each person's wall clock, date by date, so an evening window follows that
 * person's daylight-saving changes rather than a frozen UTC offset.
 */

import { atMinutes, civilFromDays, dayNumber, formatDate, MINUTE, weekday } from "./civil.js";
import { clockTime, formatMinutes, shortDate } from "./format.js";
import type { ReadableOptions } from "./format.js";
import { instantOf, wallAt } from "./zone.js";

export type Level = "preferred" | "acceptable" | "unavailable";
export const LEVELS: readonly Level[] = ["preferred", "acceptable", "unavailable"];

/** Minutes after midnight on the person's own clock. */
export interface TimeWindow {
  start: number;
  end: number;
  level: Level;
}

export interface WeeklyWindow extends TimeWindow {
  /** ISO weekdays: 1 is Monday, 7 is Sunday. */
  days: number[];
}

export interface DateException {
  /** `YYYY-MM-DD`. */
  date: string;
  /** None: unavailable all day. */
  windows: TimeWindow[];
}

export interface Person {
  id: string;
  name: string;
  zone: string;
  windows: WeeklyWindow[];
  exceptions: DateException[];
  /** Their unavailable time may be used, ranked after every time that does not need it. */
  relaxed: boolean;
}

/** A stretch of real time at one level. */
export interface Segment {
  start: number;
  end: number;
  level: Level;
}

const RANK: Record<Level, number> = { acceptable: 1, preferred: 2, unavailable: 3 };

/** A window's length in minutes: past midnight when its end is not after its start. */
export function windowLength(window: TimeWindow): number {
  return window.end > window.start ? window.end - window.start : window.end + 1440 - window.start;
}

/** The windows that start on a date, from its exception or else the weekly pattern. */
export function windowsOn(person: Person, date: string, isoWeekday: number): TimeWindow[] {
  const exception = person.exceptions.find((x) => x.date === date);
  return exception ? exception.windows : person.windows.filter((w) => w.days.includes(isoWeekday));
}

/**
 * A person's levels from `from` to `to`, as segments that cover it all, in order, with
 * neighbours always at different levels.
 */
export function personSegments(person: Person, from: number, to: number): Segment[] {
  const raw: Segment[] = [];
  // A window from the evening before can still be running at `from`.
  const first = dayNumber(wallAt(from, person.zone)) - 1;
  const last = dayNumber(wallAt(to, person.zone));
  for (let day = first; day <= last; day++) {
    const date = civilFromDays(day);
    for (const window of windowsOn(person, formatDate(date), weekday(date))) {
      const start = instantOf(atMinutes(date, window.start), person.zone, "earlier");
      const end = instantOf(
        atMinutes(date, window.start + windowLength(window)),
        person.zone,
        "later"
      );
      if (end > from && start < to && end > start) raw.push({ start, end, level: window.level });
    }
  }
  const edges = [...new Set([from, to, ...raw.flatMap((s) => [s.start, s.end])])]
    .filter((t) => t >= from && t <= to)
    .sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [start, end] = [edges[i], edges[i + 1]];
    let level: Level | undefined;
    for (const s of raw)
      if (s.start <= start && s.end >= end && (!level || RANK[s.level] > RANK[level]))
        level = s.level;
    level ??= "unavailable";
    const previous = segments[segments.length - 1];
    if (previous?.level === level) previous.end = end;
    else segments.push({ start, end, level });
  }
  return segments;
}

/** Minutes of a call outside a person's preferred time. */
export interface Cost {
  acceptable: number;
  unavailable: number;
}

/** How a call from `start` to `end` sits with one person's segments. */
export function costOf(segments: Segment[], start: number, end: number): Cost {
  const cost: Cost = { acceptable: 0, unavailable: 0 };
  // The first segment that ends after the start.
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (segments[mid].end <= start) low = mid + 1;
    else high = mid;
  }
  let covered = 0;
  for (let i = low; i < segments.length && segments[i].start < end; i++) {
    const s = segments[i];
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    covered += overlap;
    if (s.level !== "preferred") cost[s.level] += overlap / MINUTE;
  }
  // Beyond the segments is beyond the search: nobody said they were free then.
  cost.unavailable += Math.max(0, end - start - covered) / MINUTE;
  return cost;
}

export interface Search {
  /** The first start considered. */
  from: number;
  /** Starts are before this; the call may run past it. */
  to: number;
  /** Call length in minutes. */
  duration: number;
  /** Minutes between the starts considered. */
  step: number;
}

/** One time to suggest: every start from `start` to `last` costs everyone the same. */
export interface Suggestion {
  start: number;
  last: number;
  costs: Cost[];
}

const totalOf = (c: Cost) => c.acceptable + c.unavailable;

/**
 * The order of suggestions. Times that need nobody's unavailable time come first. Then the least
 * unavailable time any one person gives up, and in total; then the most minutes any one person
 * spends outside their preferred hours, so no one bears a large compromise to spare the group a
 * small one; then the group's total; then the earliest.
 */
export function rankKey(suggestion: Suggestion): number[] {
  const { costs } = suggestion;
  const unavailable = costs.map((c) => c.unavailable);
  const outside = costs.map(totalOf);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return [
    Math.max(...unavailable) > 0 ? 1 : 0,
    Math.max(...unavailable),
    sum(unavailable),
    Math.max(...outside),
    sum(outside),
    suggestion.start,
  ];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const sameCosts = (a: Cost[], b: Cost[]) =>
  a.every((c, i) => c.acceptable === b[i].acceptable && c.unavailable === b[i].unavailable);

/** Every time the whole call fits everyone, best first. */
export function findTimes(people: Person[], search: Search, segments?: Segment[][]): Suggestion[] {
  if (!people.length) return [];
  const length = search.duration * MINUTE;
  const step = search.step * MINUTE;
  const all = segments ?? people.map((p) => personSegments(p, search.from, search.to + length));
  const found: Suggestion[] = [];
  let open: Suggestion | undefined;
  for (let start = search.from; start < search.to; start += step) {
    const costs = all.map((s) => costOf(s, start, start + length));
    const fits = costs.every((c, i) => people[i].relaxed || c.unavailable === 0);
    if (!fits) {
      open = undefined;
      continue;
    }
    if (open && sameCosts(open.costs, costs)) open.last = start;
    else found.push((open = { start, last: start, costs }));
  }
  return found.sort((a, b) => compareKeys(rankKey(a), rankKey(b)));
}

export interface Diagnosis {
  /** People with no time of their own long enough for the call. */
  alone: string[];
  /** People without whom the others would find times, and how many. */
  blocking: { id: string; count: number }[];
}

/** Why nothing fits: whose windows stand in the way. */
export function diagnose(people: Person[], search: Search): Diagnosis {
  const alone = people.filter((p) => !p.relaxed && !findTimes([p], search).length).map((p) => p.id);
  const blocking: Diagnosis["blocking"] = [];
  if (people.length > 1)
    for (const person of people) {
      if (alone.includes(person.id) && alone.length > 1) continue;
      const count = findTimes(
        people.filter((p) => p !== person),
        search
      ).length;
      if (count) blocking.push({ id: person.id, count });
    }
  return { alone, blocking };
}

/** "Alice: 30 min outside preferred hours; everyone else: preferred." */
export function explain(people: Person[], costs: Cost[]): string {
  const parts: string[] = [];
  costs.forEach((cost, i) => {
    const notes: string[] = [];
    if (cost.acceptable) notes.push(`${formatMinutes(cost.acceptable)} outside preferred hours`);
    if (cost.unavailable) notes.push(`${formatMinutes(cost.unavailable)} in unavailable time`);
    if (notes.length) parts.push(`${people[i].name || "Unnamed"}: ${notes.join(", ")}`);
  });
  if (!parts.length) return people.length === 1 ? "Preferred hours." : "Everyone: preferred hours.";
  if (parts.length < costs.length) parts.push("everyone else: preferred");
  return parts.join("; ") + ".";
}

/**
 * The call as text to paste into a message: each person's own date and time.
 * "Alice (Europe/Paris): Sat 14 Nov, 20:00–21:00".
 */
export function summary(
  people: Person[],
  start: number,
  duration: number,
  options: ReadableOptions = {}
): string {
  const end = start + duration * MINUTE;
  const lines = people.map((person) => {
    const startDay = shortDate(start, person.zone, options.locale);
    const endDay = shortDate(end, person.zone, options.locale);
    const range =
      `${clockTime(start, person.zone, options)}–${clockTime(end, person.zone, options)}` +
      (endDay === startDay ? "" : ` (${endDay})`);
    return `${person.name || "Unnamed"} (${person.zone}): ${startDay}, ${range}`;
  });
  return [`Call, ${formatMinutes(duration)}`, ...lines].join("\n");
}

/** The levels at once: unavailable where anyone is, else acceptable where anyone is. */
export function combine(segments: Segment[][], from: number, to: number): Segment[] {
  const edges = [...new Set([from, to, ...segments.flat().flatMap((s) => [s.start, s.end])])]
    .filter((t) => t >= from && t <= to)
    .sort((a, b) => a - b);
  const result: Segment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [start, end] = [edges[i], edges[i + 1]];
    let level: Level = "preferred";
    for (const person of segments) {
      const s = person.find((x) => x.start <= start && x.end >= end);
      const here = s?.level ?? "unavailable";
      if (here === "unavailable" || (here === "acceptable" && level === "preferred")) level = here;
    }
    const previous = result[result.length - 1];
    if (previous?.level === level) previous.end = end;
    else result.push({ start, end, level });
  }
  return result;
}

/** Days in a search, as a guard against a range nobody meant. */
export const MAX_SEARCH_DAYS = 31;
