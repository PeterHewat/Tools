/**
 * Times of day across the site are on the 24-hour clock, whatever the browser's language.
 *
 * A time field is a typed `.ui-clock` field rather than a native time field: a native one writes
 * the time as the browser's language does, AM/PM in American English, with no way to ask
 * otherwise. A field accepts `14:30`, `9:30` or `0930` (and seconds where it shows them,
 * `data-seconds`), is marked invalid while it cannot be read, and is written out as `HH:MM` once
 * the person leaves it. Pages read it with `parseClock`.
 */

const pad = (value: number) => String(value).padStart(2, "0");

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

const isClock = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement && target.classList.contains("ui-clock");

function mark(input: HTMLInputElement): void {
  if (input.value.trim() !== "" && parseClock(input.value) === undefined)
    input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

let bound = false;
/** Binds every clock field on the page, those drawn later included. */
export function bindClockFields(): void {
  if (bound) return;
  bound = true;
  document.addEventListener("input", (event) => {
    // While typing, only clear a mark: "9:" is on its way to being a time.
    if (isClock(event.target) && parseClock(event.target.value)) mark(event.target);
  });
  document.addEventListener("change", (event) => {
    if (!isClock(event.target)) return;
    const input = event.target;
    const clock = parseClock(input.value);
    if (clock) {
      const second = input.dataset.seconds !== undefined && clock.second ? clock.second : undefined;
      input.value = formatClock(clock.minutes, second);
    }
    mark(input);
  });
}

/** The attributes of a clock field, for one made in code; the page's own carry the same. */
export const CLOCK_FIELD = {
  class: "ui-input ui-clock",
  type: "text",
  inputmode: "numeric",
  autocomplete: "off",
  spellcheck: "false",
  placeholder: "HH:MM",
  maxlength: "8",
} as const;
