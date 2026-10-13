/**
 * What Time keeps for the whole app, in this browser: the clock (24- or 12-hour) and the pinned
 * zones. A saved format: read field by field, anything missing or unknown given its default.
 */

import { readStored, writeStored } from "@tools/ui";
import { canonicalZone } from "./lib/zone.js";
import type { ReadableOptions } from "./lib/format.js";

const KEY = "tools.time.prefs";

export interface Prefs {
  clock: "24" | "12";
  pinned: string[];
}

export const MAX_PINNED = 12;
const DEFAULT_PINNED = ["America/New_York", "Europe/London", "Asia/Tokyo"];

/** The reader's own habit, until they choose. */
function localeClock(): Prefs["clock"] {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12" ? "12" : "24";
}

export function readPrefs(): Prefs {
  const raw = readStored(KEY);
  const stored =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const clock = stored.clock === "12" || stored.clock === "24" ? stored.clock : localeClock();
  const pinned = Array.isArray(stored.pinned)
    ? [
        ...new Set(
          stored.pinned
            .filter((z): z is string => typeof z === "string")
            .map((z) => canonicalZone(z))
            .filter((z): z is string => z !== undefined)
        ),
      ].slice(0, MAX_PINNED)
    : DEFAULT_PINNED;
  return { clock, pinned };
}

export function writePrefs(prefs: Prefs): void {
  writeStored(KEY, prefs);
}

export const readable = (prefs: Prefs): ReadableOptions => ({ hour12: prefs.clock === "12" });
