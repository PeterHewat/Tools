/**
 * What a person typed into Convert: a Unix timestamp, an ISO 8601 / RFC 3339 date, or an HTTP /
 * email date. A date without an offset is a wall time that still needs a zone, which is the
 * caller's to supply; nothing here guesses one.
 */

import { isValidDate, wallMs } from "./civil.js";
import type { WallTime } from "./civil.js";
import { findZone } from "./zone.js";

export type Unit = "s" | "ms";

/** Instants a Date can hold: ±100,000,000 days around 1970. */
export const MAX_MS = 8.64e15;

export type Parsed =
  /** A Unix timestamp, in the unit given or, failing that, the one its size suggests. */
  | { kind: "unix"; ms: number; unit: Unit; detected: boolean; dropped: boolean }
  /** A date and time with an offset: one instant. */
  | { kind: "instant"; ms: number; offset: number; zone?: string; dropped?: boolean }
  /** A date, or a date and time, with no offset: a wall time in a zone still to be chosen. */
  | { kind: "wall"; wall: WallTime; dateOnly: boolean; zone?: string; dropped?: boolean }
  | { kind: "error"; message: string };

/**
 * A number this size or more is taken for milliseconds: in seconds it would be past the year
 * 5000, while in milliseconds it is after March 1973.
 */
const MS_FROM = 1e11;

export function detectUnit(value: number): Unit {
  return Math.abs(value) >= MS_FROM ? "ms" : "s";
}

const ISO =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?(?:\[!?([^\]=]+)\])?$/;
const ISO_BASIC =
  /^(\d{4})(\d{2})(\d{2})[Tt](\d{2})(\d{2})(?:(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}(?:\d{2})?)?$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RFC_2822 =
  /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(gmt|ut|utc|z|[+-]\d{4}|[ecmp][sd]t)?$/i;
const NAMED_OFFSETS: Record<string, number> = {
  est: -5,
  edt: -4,
  cst: -6,
  cdt: -5,
  mst: -7,
  mdt: -6,
  pst: -8,
  pdt: -7,
};

function offsetMs(text: string): number {
  if (/^z$/i.test(text)) return 0;
  const digits = text.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4) || "0");
  if (hours > 23 || minutes > 59) return NaN;
  return (text[0] === "-" ? -1 : 1) * (hours * 60 + minutes) * 60_000;
}

/** Fractions of a second past milliseconds are dropped, and the caller is told. */
function fractionMs(text: string | undefined): { ms: number; dropped: boolean } {
  if (!text) return { ms: 0, dropped: false };
  return { ms: Number(text.slice(0, 3).padEnd(3, "0")), dropped: /[1-9]/.test(text.slice(3)) };
}

function wallOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number
): WallTime | string {
  if (!isValidDate(year, month, day)) return "That date does not exist.";
  if (hour > 23 || minute > 59 || second > 59)
    return "That time of day does not exist (00:00 to 23:59:59).";
  return { year, month, day, hour, minute, second, ms };
}

function fromWall(
  wall: WallTime | string,
  dateOnly: boolean,
  offset: string | undefined,
  zoneName: string | undefined,
  dropped: boolean
): Parsed {
  if (typeof wall === "string") return { kind: "error", message: wall };
  let zone: string | undefined;
  if (zoneName) {
    zone = findZone(zoneName);
    if (!zone) return { kind: "error", message: `Unknown time zone "${zoneName}".` };
  }
  if (offset !== undefined) {
    if (dateOnly) return { kind: "error", message: "An offset needs a time of day." };
    const shift = offsetMs(offset);
    if (Number.isNaN(shift)) return { kind: "error", message: `Not an offset: "${offset}".` };
    const ms = wallMs(wall) - shift;
    if (Math.abs(ms) > MAX_MS) return { kind: "error", message: "Out of range for a date." };
    return { kind: "instant", ms, offset: shift, zone, dropped };
  }
  if (Math.abs(wallMs(wall)) > MAX_MS)
    return { kind: "error", message: "Out of range for a date." };
  return { kind: "wall", wall, dateOnly, zone, dropped };
}

/** Reads one value. `unit` overrides the unit a number's size suggests. */
export function parseTime(input: string, unit?: Unit): Parsed {
  const text = input.trim();
  if (!text) return { kind: "error", message: "Empty." };

  const number = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (number) {
    const [, sign, whole, fraction = ""] = number;
    const chosen = unit ?? detectUnit(Number(text));
    // Milliseconds from the digits themselves: 1.001 seconds times 1000 is 1000.9999… in
    // floating point. Below a millisecond is beyond what a Date holds.
    const kept = chosen === "s" ? 3 : 0;
    const size =
      Number(whole) * (chosen === "s" ? 1000 : 1) +
      Number(fraction.slice(0, kept).padEnd(kept, "0") || 0);
    if (size > MAX_MS) return { kind: "error", message: "Out of range for a date." };
    return {
      kind: "unix",
      ms: sign === "-" && size ? -size : size,
      unit: chosen,
      detected: unit === undefined,
      dropped: /[1-9]/.test(fraction.slice(kept)),
    };
  }

  const iso = ISO.exec(text) ?? ISO_BASIC.exec(text);
  if (iso) {
    const [, y, mo, d, h, mi, s, fraction, offset, zone] = iso;
    const { ms, dropped } = fractionMs(fraction);
    const wall = wallOf(
      Number(y),
      Number(mo),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(s ?? 0),
      ms
    );
    return fromWall(wall, h === undefined, offset, zone, dropped);
  }

  const rfc = RFC_2822.exec(text);
  if (rfc) {
    const [, d, mon, y, h, mi, s, zone] = rfc;
    const month = MONTHS.indexOf(mon.toLowerCase()) + 1;
    if (!month) return { kind: "error", message: `Unknown month "${mon}".` };
    const wall = wallOf(Number(y), month, Number(d), Number(h), Number(mi), Number(s ?? 0), 0);
    const name = zone?.toLowerCase();
    const offset =
      name === undefined
        ? undefined
        : name in NAMED_OFFSETS
          ? (NAMED_OFFSETS[name] < 0 ? "-" : "+") +
            String(Math.abs(NAMED_OFFSETS[name])).padStart(2, "0")
          : /^[+-]/.test(name)
            ? name
            : "Z";
    return fromWall(wall, false, offset, undefined, false);
  }

  return {
    kind: "error",
    message: "Not a Unix timestamp, an ISO 8601 date (2026-10-12T14:30) or an HTTP date.",
  };
}
