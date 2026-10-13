/** Instants written out: ISO 8601, HTTP dates, offsets, a reader's own format, and "in 3 hours". */

import { DAY, dayNumber, formatDate, formatYear, HOUR, MINUTE } from "./civil.js";
import type { PlainDate } from "./civil.js";
import { offsetAt, UTC, wallAt } from "./zone.js";

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** `+05:30`, `-03:00`, or with seconds for the historical offsets that had them. */
export function formatOffset(offset: number): string {
  const sign = offset < 0 ? "-" : "+";
  const total = Math.abs(Math.round(offset / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${sign}${pad(hours)}:${pad(minutes)}${seconds ? ":" + pad(seconds) : ""}`;
}

/** `UTC+05:30`, or `UTC` for none. */
export function utcOffset(offset: number): string {
  return offset === 0 ? "UTC" : "UTC" + formatOffset(offset);
}

/**
 * ISO 8601 / RFC 3339 in a zone, with its offset at that instant (`Z` in UTC). Milliseconds are
 * written only when there are some.
 */
export function isoString(ms: number, zone: string): string {
  const wall = wallAt(ms, zone);
  const offset = offsetAt(ms, zone);
  const fraction = wall.ms ? "." + pad(wall.ms, 3) : "";
  return (
    `${formatDate(wall)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${fraction}` +
    (zone === UTC ? "Z" : formatOffset(offset))
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The date HTTP headers carry (RFC 9110 IMF-fixdate), always in GMT. */
export function httpDate(ms: number): string {
  const wall = wallAt(ms, UTC);
  const day = DAYS[new Date(ms).getUTCDay()];
  return (
    `${day}, ${pad(wall.day)} ${MONTHS[wall.month - 1]} ${formatYear(wall.year)} ` +
    `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)} GMT`
  );
}

/**
 * How a reader sees a date: in their language, the browser's by default. Times of day are on the
 * 24-hour clock whatever the language, as across the site.
 */
export interface ReadableOptions {
  locale?: string;
}

const readers = new Map<string, Intl.DateTimeFormat>();
function reader(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let found = readers.get(key);
  if (!found) readers.set(key, (found = make()));
  return found;
}

/** The date and time as the reader's language writes them, e.g. "Monday 12 October 2026 at 10:15:00". */
export function readableDate(ms: number, zone: string, options: ReadableOptions = {}): string {
  const { locale } = options;
  return reader(
    `full|${locale}|${zone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        dateStyle: "full",
        timeStyle: "medium",
        hourCycle: "h23",
      })
  ).format(ms);
}

/** A calendar date, with no time or zone, as the reader's language writes it: "14 Mar 2027". */
export function formatDay(date: PlainDate, locale?: string): string {
  return reader(
    `day|${locale}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: UTC, dateStyle: "medium" })
  ).format(dayNumber(date) * DAY);
}

/** A short weekday and date, e.g. "Sat 14 Nov". */
export function shortDate(ms: number, zone: string, locale?: string): string {
  return reader(
    `short|${locale}|${zone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        weekday: "short",
        day: "numeric",
        month: "short",
      })
  ).format(ms);
}

/** A clock time, e.g. "08:00" or "20:00". */
export function clockTime(ms: number, zone: string, options: ReadableOptions = {}): string {
  const { locale } = options;
  return reader(
    `clock|${locale}|${zone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
  ).format(ms);
}

/**
 * The zone's abbreviation at an instant ("CEST", "EST") when the language has one; undefined
 * where it only has an offset ("GMT+9"), which is shown separately anyway.
 */
export function zoneAbbreviation(ms: number, zone: string, locale?: string): string | undefined {
  const part = reader(
    `abbr|${locale}|${zone}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
  )
    .formatToParts(ms)
    .find((p) => p.type === "timeZoneName")?.value;
  return part && /^[A-Za-z]{2,5}$/.test(part) && !/^(GMT|UTC)$/.test(part) ? part : undefined;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365.2425 * 24 * HOUR],
  ["month", (365.2425 / 12) * 24 * HOUR],
  ["week", 7 * 24 * HOUR],
  ["day", 24 * HOUR],
  ["hour", HOUR],
  ["minute", MINUTE],
  ["second", 1000],
];

/** "in 3 hours", "2 days ago": approximate, a supplement to the exact time. */
export function relativeTime(ms: number, now: number, locale?: string): string {
  const difference = ms - now;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS)
    if (Math.abs(difference) >= size || unit === "second")
      return format.format(Math.trunc(difference / size), unit);
  return "";
}

/** "45 min", "1 h 30 min", "2 h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
