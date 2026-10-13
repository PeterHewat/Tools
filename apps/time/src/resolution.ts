/**
 * A wall time read in a zone, explained: where clocks go forward it never happens, and the time
 * after the change is used and said; where they go back it happens twice, and the person
 * chooses which before anything is shown. Convert and Duration both ask this.
 */

import { formatDate, formatClock } from "./lib/civil.js";
import type { WallTime } from "./lib/civil.js";
import { clockTime, formatMinutes, utcOffset } from "./lib/format.js";
import type { ReadableOptions } from "./lib/format.js";
import { offsetAt, resolveWall } from "./lib/zone.js";
import { h } from "./dom.js";

export type Choice = "earlier" | "later";

export interface ChoiceBox {
  box: HTMLElement;
  text: HTMLElement;
  buttons: HTMLElement;
}

export interface Resolved {
  /** Undefined while a choice is needed. */
  ms?: number;
  /** What was assumed or changed, to say beside the result. */
  note: string;
}

const wallClock = (wall: WallTime) =>
  formatClock(wall.hour * 60 + wall.minute) +
  (wall.second ? ":" + String(wall.second).padStart(2, "0") : "");

export function resolveShown(
  wall: WallTime,
  zone: string,
  options: ReadableOptions,
  ui: ChoiceBox,
  chosen: Choice | undefined,
  onChoose: (choice: Choice) => void
): Resolved {
  const found = resolveWall(wall, zone);
  const when = `${wallClock(wall)} on ${formatDate(wall)} in ${zone}`;
  ui.box.hidden = found.kind !== "ambiguous";
  if (found.kind === "exact") return { ms: found.ms, note: "" };
  if (found.kind === "gap") {
    const shift = formatMinutes(Math.round((found.after - found.before) / 60_000));
    return {
      ms: found.ms,
      note:
        `${when} does not exist: the clocks go forward ${shift} there. ` +
        `Read as ${clockTime(found.ms, zone, options)} (${utcOffset(offsetAt(found.ms, zone))}), the time after the change.`,
    };
  }
  const shift = formatMinutes(Math.round((found.later - found.earlier) / 60_000));
  // Drawn again only when it changes, so a live count does not take the focus from its buttons.
  const key = `${when}|${chosen}|${found.earlier}`;
  if (ui.box.dataset.key !== key) {
    ui.box.dataset.key = key;
    ui.text.textContent = `${when} happens twice: the clocks go back ${shift}. Which one?`;
    ui.buttons.replaceChildren(
      ...(["earlier", "later"] as const).map((choice) => {
        const ms = found[choice];
        const button = h(
          "button",
          {
            type: "button",
            class: "ui-btn ui-btn--small",
            "aria-pressed": String(chosen === choice),
          },
          `${choice === "earlier" ? "First" : "Second"}, ${utcOffset(offsetAt(ms, zone))}`
        );
        button.addEventListener("click", () => onChoose(choice));
        return button;
      })
    );
  }
  return chosen
    ? {
        ms: found[chosen],
        note: `The ${chosen === "earlier" ? "first" : "second"} ${wallClock(wall)}, ${utcOffset(offsetAt(found[chosen], zone))}.`,
      }
    : { note: "Choose which of the two times." };
}
