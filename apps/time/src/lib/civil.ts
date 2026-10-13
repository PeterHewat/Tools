/**
 * Calendar arithmetic on plain dates and wall-clock times: the proleptic Gregorian calendar, with
 * no time zone. Day numbers count from 1970-01-01, so a wall time maps to the milliseconds it
 * would be in UTC; `zone.ts` turns that into a real instant for a named zone.
 */

export interface PlainDate {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

export interface WallTime extends PlainDate {
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** The day number of a date: 0 is 1970-01-01. Exact for any year (H. Hinnant's algorithm). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date of a day number. */
export function civilFromDays(days: number): PlainDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export const dayNumber = (date: PlainDate): number =>
  daysFromCivil(date.year, date.month, date.day);

/** 1 is Monday and 7 is Sunday, as in ISO 8601. */
export function weekday(date: PlainDate): number {
  return ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return civilFromDays(dayNumber(date) + days);
}

/**
 * The same day `months` later; a day the month does not have becomes its last day, so 31 January
 * plus one month is 28 or 29 February.
 */
export function addMonths(date: PlainDate, months: number): PlainDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** The wall time read as if it were UTC, in milliseconds since 1970. */
export function wallMs(wall: WallTime): number {
  return (
    dayNumber(wall) * DAY + wall.hour * HOUR + wall.minute * MINUTE + wall.second * 1000 + wall.ms
  );
}

export function wallFromMs(ms: number): WallTime {
  const days = Math.floor(ms / DAY);
  let rest = ms - days * DAY;
  const hour = Math.floor(rest / HOUR);
  rest -= hour * HOUR;
  const minute = Math.floor(rest / MINUTE);
  rest -= minute * MINUTE;
  const second = Math.floor(rest / 1000);
  return { ...civilFromDays(days), hour, minute, second, ms: rest - second * 1000 };
}

/** A date at a time of day, given in minutes from midnight (1440 is the next midnight). */
export function atMinutes(date: PlainDate, minutes: number): WallTime {
  return wallFromMs(dayNumber(date) * DAY + minutes * MINUTE);
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Years outside 0000 to 9999 take a sign and six digits, as ISO 8601 extends them. */
export function formatYear(year: number): string {
  return year >= 0 && year <= 9999 ? pad(year, 4) : (year < 0 ? "-" : "+") + pad(Math.abs(year), 6);
}

/** `YYYY-MM-DD`. */
export function formatDate(date: PlainDate): string {
  return `${formatYear(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}

/** A date as an `<input type="date">` holds it, `YYYY-MM-DD`; undefined when it is not one. */
export function parseDate(value: string): PlainDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isValidDate(year, month, day) ? { year, month, day } : undefined;
}
