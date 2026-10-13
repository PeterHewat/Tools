/**
 * What Time keeps for the whole app, in this browser: the pinned zones. A saved format: read field
 * by field, anything missing or unknown given its default. (Settings saved before times became
 * 24-hour everywhere also hold `clock`, which is no longer read.)
 */

import { readStored, writeStored } from "@tools/ui";
import { canonicalZone } from "./lib/zone.js";

const KEY = "tools.time.prefs";

export interface Prefs {
  pinned: string[];
}

export const MAX_PINNED = 12;
const DEFAULT_PINNED = ["America/New_York", "Europe/London", "Asia/Tokyo"];

export function readPrefs(): Prefs {
  const raw = readStored(KEY);
  const stored =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
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
  return { pinned };
}

export function writePrefs(prefs: Prefs): void {
  writeStored(KEY, prefs);
}
