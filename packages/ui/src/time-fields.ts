/**
 * Dates and times of day are typed fields across the site, written the same whatever the
 * browser's language: dates as `YYYY-MM-DD`, times on the 24-hour clock.
 *
 * Native date and time fields write them as the browser's language does (`10/13/2026` and AM/PM
 * in American English), with no way to ask otherwise. A `.ui-date` field accepts `2026-10-13`,
 * `2026-10-5` or `20261013`; a `.ui-clock` field accepts `14:30`, `9:30` or `0930` (and seconds
 * where it shows them, `data-seconds`). Each is marked invalid while it cannot be read, and is
 * written out in full once the person leaves it, with an `input` event so the page reads it again.
 * Pages read them with `parseIsoDate` and `parseClock`.
 */

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** `HH:MM` from minutes after midnight, on the 24-hour clock; `HH:MM:SS` given the seconds. */
export function formatClock(minutes: number, second?: number): string {
  const clock = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return second === undefined ? clock : `${clock}:${pad(second)}`;
}

/**
 * A time of day as typed on the 24-hour clock: `14:30`, `14:30:15`, `9:30`, `0930`, `14h30` or
 * just `9`. Fractions of a second are dropped. Undefined when it is not one.
 */
export function parseClock(value: string): { minutes: number; second: number } | undefined {
  const match = /^(\d{1,2})(?:[:.h]?(\d{2})(?:[:.]?(\d{2})(?:[.,]\d+)?)?)?$/i.exec(value.trim());
  if (!match) return undefined;
  const [hour, minute, second] = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  return hour < 24 && minute < 60 && second < 60
    ? { minutes: hour * 60 + minute, second }
    : undefined;
}

export interface IsoDate {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

const daysIn = (year: number, month: number) =>
  month === 2
    ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/**
 * A date as typed, year first: `2026-10-13`, `2026-10-5`, `2026/10/13`, `2026.10.13` or
 * `20261013`. Undefined when it is not one, or not a day the calendar has (`2026-02-30`).
 */
export function parseIsoDate(value: string): IsoDate | undefined {
  const text = value.trim();
  const match =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
    ? { year, month, day }
    : undefined;
}

/** `YYYY-MM-DD`. */
export function formatIsoDate(date: IsoDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** The field's value written out in full, or undefined when it cannot be read. */
function tidy(input: HTMLInputElement): string | undefined {
  if (input.classList.contains("ui-date")) {
    const date = parseIsoDate(input.value);
    return date && formatIsoDate(date);
  }
  const clock = parseClock(input.value);
  if (!clock) return undefined;
  const second = input.dataset.seconds !== undefined && clock.second ? clock.second : undefined;
  return formatClock(clock.minutes, second);
}

const isField = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement &&
  (target.classList.contains("ui-clock") || target.classList.contains("ui-date"));

function mark(input: HTMLInputElement, readable: boolean): void {
  if (input.value.trim() !== "" && !readable) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

let bound = false;
/** Binds every date and time field on the page, those drawn later included. */
export function bindTimeFields(): void {
  if (bound) return;
  bound = true;
  document.addEventListener("input", (event) => {
    // While typing, only clear a mark: "9:" is on its way to being a time.
    if (isField(event.target) && tidy(event.target) !== undefined) mark(event.target, true);
  });
  document.addEventListener("change", (event) => {
    if (!isField(event.target)) return;
    const input = event.target;
    const full = tidy(input);
    mark(input, full !== undefined);
    if (full !== undefined && full !== input.value) {
      input.value = full;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

const TYPED = {
  type: "text",
  inputmode: "numeric",
  autocomplete: "off",
  spellcheck: "false",
} as const;

/** The attributes of a time field, for one made in code; the page's own carry the same. */
export const CLOCK_FIELD = {
  ...TYPED,
  class: "ui-input ui-clock",
  placeholder: "HH:MM",
  maxlength: "8",
} as const;

/** The attributes of a date field, for one made in code. */
export const DATE_FIELD = {
  ...TYPED,
  class: "ui-input ui-date",
  placeholder: "YYYY-MM-DD",
  maxlength: "10",
} as const;
