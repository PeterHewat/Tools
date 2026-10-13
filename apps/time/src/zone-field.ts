/**
 * A time-zone field: a text input over the list of zones (a `<datalist>`), shared by every view.
 * It takes a zone's name in any case or its city alone, writes back the zone's own name, and
 * marks itself invalid, keeping the last good zone, while what is typed is not a zone.
 */

import { byId } from "@tools/ui";
import { formatOffset } from "./lib/format.js";
import { findZone, offsetAt, zoneNames } from "./lib/zone.js";

export interface ZoneField {
  /** The last valid zone. */
  readonly zone: string;
  set(zone: string): void;
}

let listed = false;
/** Fills the shared list once, the first time a zone field is used: each zone with its offset now. */
function fillList(): void {
  if (listed) return;
  listed = true;
  const now = Date.now();
  const list = byId<HTMLDataListElement>("zone-list");
  for (const zone of zoneNames()) {
    const option = document.createElement("option");
    option.value = zone;
    option.label = "UTC" + formatOffset(offsetAt(now, zone));
    list.append(option);
  }
}

export function bindZoneField(
  input: HTMLInputElement,
  initial: string,
  onChange: (zone: string) => void
): ZoneField {
  let zone = initial;
  input.value = zone;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("focus", fillList, { once: true });
  const read = (commit: boolean) => {
    const found = findZone(input.value);
    input.setAttribute("aria-invalid", String(!found && input.value.trim() !== ""));
    if (!found) {
      if (commit && !input.value.trim()) {
        // Emptied and left: back to the zone in use.
        input.value = zone;
        input.setAttribute("aria-invalid", "false");
      }
      return;
    }
    if (commit) input.value = found;
    if (found !== zone) {
      zone = found;
      onChange(zone);
    }
  };
  // While typing, only a full name counts, so "Europe/Par" does not jump to a city's zone.
  input.addEventListener("input", () => {
    if (zoneNames().includes(input.value.trim())) read(false);
    else
      input.setAttribute(
        "aria-invalid",
        String(!findZone(input.value) && input.value.trim() !== "")
      );
  });
  input.addEventListener("change", () => read(true));
  return {
    get zone() {
      return zone;
    },
    set(next: string) {
      zone = next;
      input.value = next;
      input.setAttribute("aria-invalid", "false");
    },
  };
}
