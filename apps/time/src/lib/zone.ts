/**
 * Named time zones, through the browser's own copy of the IANA database (`Intl`). An offset is
 * never a fixed property of a zone: it depends on the instant, because of daylight-saving time
 * and the zone's history, so every question here is asked at an instant.
 */

import { DAY, wallFromMs, wallMs } from "./civil.js";
import type { WallTime } from "./civil.js";

export const UTC = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      era: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, found);
  }
  return found;
}

/** The zone's own name for itself (`utc` → `UTC`), or undefined when there is no such zone. */
export function canonicalZone(name: string): string | undefined {
  const value = name.trim();
  if (!value || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return undefined;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
      .timeZone;
    // Fixed offsets ("+05:30") are not named zones: they have no rules to follow.
    return /^[+-]/.test(resolved) ? undefined : resolved === "Etc/UTC" ? UTC : resolved;
  } catch {
    return undefined;
  }
}

/** The browser's zone: the device's setting. */
export function localZone(): string {
  return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? UTC;
}

const REGIONS = [
  "America",
  "Europe",
  "Asia",
  "Africa",
  "Australia",
  "Pacific",
  "Atlantic",
  "Indian",
  "Antarctica",
];

let names: string[] | undefined;
/** Every zone this browser knows, UTC first. */
export function zoneNames(): string[] {
  if (!names) {
    let all: string[] = [];
    try {
      all = Intl.supportedValuesOf("timeZone");
    } catch {
      /* an older browser: zones can still be typed */
    }
    names = [UTC, ...all.filter((zone) => zone !== UTC && zone !== "Etc/UTC")];
  }
  return names;
}

/**
 * Finds a zone from what someone typed: its name in any case, with spaces for underscores, or
 * just its city when only one zone has it (`tokyo` → `Asia/Tokyo`).
 */
export function findZone(typed: string): string | undefined {
  const value = typed.trim().replace(/\s+/g, "_");
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "utc" || lower === "gmt" || lower === "z") return UTC;
  const all = zoneNames();
  const exact = all.find((zone) => zone.toLowerCase() === lower);
  if (exact) return exact;
  const cities = all.filter((zone) => zone.toLowerCase().split("/").pop() === lower);
  if (cities.length === 1) return cities[0];
  // A city the browser lists under an older name: Chromium has Asia/Calcutta, not Asia/Kolkata.
  if (!value.includes("/")) {
    const city = lower.replace(
      /(^|[_-])([a-z])/g,
      (_, gap: string, letter: string) => gap + letter.toUpperCase()
    );
    for (const region of REGIONS) {
      const found = canonicalZone(`${region}/${city}`);
      if (found) return found;
    }
  }
  return canonicalZone(value);
}

/** The wall-clock time in a zone at an instant. */
export function wallAt(ms: number, zone: string): WallTime {
  if (zone === UTC) return wallFromMs(ms);
  const fields: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(ms)) fields[part.type] = part.value;
  const year = Number(fields.year);
  return {
    // The years before 1 are counted backwards with an era: 1 BC is year 0.
    year: /^B/.test(fields.era ?? "") ? 1 - year : year,
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
    ms: ((ms % 1000) + 1000) % 1000,
  };
}

/** How far the zone's clocks are ahead of UTC at an instant, in milliseconds. */
export function offsetAt(ms: number, zone: string): number {
  return zone === UTC ? 0 : wallMs(wallAt(ms, zone)) - ms;
}

/**
 * A wall time read in a zone. Where the clocks go back, the time happens twice (`ambiguous`);
 * where they go forward, it never happens (`gap`), and `ms` is the moment the clock shows that
 * time after moving on (02:30 in a one-hour gap is 03:30), as calendars resolve it.
 */
export type Resolution =
  | { kind: "exact"; ms: number }
  | { kind: "ambiguous"; earlier: number; later: number }
  | { kind: "gap"; ms: number; before: number; after: number };

export function resolveWall(wall: WallTime, zone: string): Resolution {
  const local = wallMs(wall);
  if (zone === UTC) return { kind: "exact", ms: local };
  // Each offset the zone has around this time is a candidate; those that read back as this
  // wall time are its instants.
  const before = offsetAt(local - DAY, zone);
  const after = offsetAt(local + DAY, zone);
  const offsets = new Set([before, offsetAt(local, zone), after]);
  const hits = [...offsets]
    .map((offset) => local - offset)
    .filter((ms) => offsetAt(ms, zone) === local - ms)
    .sort((a, b) => a - b);
  if (hits.length === 1) return { kind: "exact", ms: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", earlier: hits[0], later: hits[hits.length - 1] };
  return { kind: "gap", ms: local - before, before, after };
}

/**
 * One instant for a wall time, where none has to be chosen by a person: the earlier of two, or
 * the time after a gap.
 */
export function instantOf(
  wall: WallTime,
  zone: string,
  prefer: "earlier" | "later" = "earlier"
): number {
  const found = resolveWall(wall, zone);
  return found.kind === "ambiguous" ? found[prefer] : found.ms;
}
