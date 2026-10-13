/**
 * Two measurements of the time between two instants. Elapsed time is exact: a day is 24 hours.
 * Calendar time counts as a calendar does, in years, months and days on the wall clock of one
 * zone, so a day that daylight-saving time made 23 or 25 hours long is still one day.
 */

import { addDays, addMonths, dayNumber, DAY, HOUR, MINUTE } from "./civil.js";
import type { PlainDate, WallTime } from "./civil.js";
import { instantOf, wallAt } from "./zone.js";

export interface CalendarSpan {
  /** The end is before the start; the parts are counted from the end to the start. */
  negative: boolean;
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
}

const timeOfDay = (wall: WallTime) =>
  wall.hour * HOUR + wall.minute * MINUTE + wall.second * 1000 + wall.ms;

/**
 * Whole months, then whole days, then the time left, from the earlier instant to the later, on
 * the wall clock of `zone`. A month too short for the day ends at its last day: one month after
 * 31 January is 28 (or 29) February, and someone born on 29 February is a year older on
 * 28 February in other years.
 */
export function calendarSpan(start: number, end: number, zone: string): CalendarSpan {
  const negative = end < start;
  const [from, to] = negative ? [end, start] : [start, end];
  const a = wallAt(from, zone);
  const b = wallAt(to, zone);
  const clock = timeOfDay(a);
  const beyond = (date: PlainDate) =>
    dayNumber(date) * DAY + clock > dayNumber(b) * DAY + timeOfDay(b);

  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months > 0 && beyond(addMonths(a, months))) months--;
  const anchor = addMonths(a, months);
  let days = dayNumber(b) - dayNumber(anchor);
  if (days > 0 && beyond(addDays(anchor, days))) days--;
  const at = (count: number) => {
    const date = addDays(anchor, count);
    return instantOf({ ...date, hour: a.hour, minute: a.minute, second: a.second, ms: a.ms }, zone);
  };
  let mid = at(days);
  // A clock change can put the day's time past the end: then that day is not complete.
  while (days > 0 && mid > to) mid = at(--days);
  const rest = Math.max(0, to - mid);
  return {
    negative,
    years: Math.floor(months / 12),
    months: months % 12,
    days,
    hours: Math.floor(rest / HOUR),
    minutes: Math.floor((rest % HOUR) / MINUTE),
    seconds: Math.floor((rest % MINUTE) / 1000),
    ms: rest % 1000,
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "34 years, 2 months, 5 days", with the time of day when `withTime`. */
export function describeSpan(span: CalendarSpan, withTime: boolean): string {
  const parts: string[] = [];
  if (span.years) parts.push(plural(span.years, "year"));
  if (span.months) parts.push(plural(span.months, "month"));
  if (span.days || (!withTime && !parts.length)) parts.push(plural(span.days, "day"));
  if (withTime) {
    if (span.hours) parts.push(plural(span.hours, "hour"));
    if (span.minutes) parts.push(plural(span.minutes, "minute"));
    if (span.seconds || !parts.length) parts.push(plural(span.seconds, "second"));
  }
  return parts.join(", ");
}

export type Rounding = "down" | "nearest";

export const UNIT_MS = {
  days: DAY,
  hours: HOUR,
  minutes: MINUTE,
  seconds: 1000,
} as const;
export type TotalUnit = keyof typeof UNIT_MS;

/**
 * Elapsed time in one unit. Down counts only units completed (toward zero, so a negative span
 * rounds the same way); nearest rounds half away from zero.
 */
export function totalIn(ms: number, unit: TotalUnit, rounding: Rounding): number {
  const value = Math.abs(ms) / UNIT_MS[unit];
  const rounded = rounding === "down" ? Math.floor(value) : Math.round(value);
  return ms < 0 && rounded ? -rounded : rounded;
}

/**
 * The next time a date comes round, on or after `today` (today counts), and how many years
 * that will be.
 */
export function nextAnniversary(
  date: PlainDate,
  today: PlainDate
): { date: PlainDate; years: number } {
  let years = Math.max(0, today.year - date.year);
  let next = addMonths(date, years * 12);
  if (dayNumber(next) < dayNumber(today)) next = addMonths(date, ++years * 12);
  return { date: next, years };
}
