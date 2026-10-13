/** Convert: a timestamp or date to every form and zone; several lines to a table. */

import { byId, copyText, iconSvg, showMessage } from "@tools/ui";
import { formatClock, formatDate, parseClock, parseDate } from "./lib/civil.js";
import type { WallTime } from "./lib/civil.js";
import {
  httpDate,
  isoString,
  readableDate,
  relativeTime,
  utcOffset,
  zoneAbbreviation,
} from "./lib/format.js";
import { parseTime } from "./lib/parse.js";
import type { Parsed, Unit } from "./lib/parse.js";
import { localZone, offsetAt, resolveWall, UTC, wallAt } from "./lib/zone.js";
import { MAX_PINNED, readable } from "./prefs.js";
import { text } from "./app.js";
import type { App, View } from "./app.js";
import { copyButton, h, press } from "./dom.js";
import { resolveShown } from "./resolution.js";
import type { Choice } from "./resolution.js";
import { bindZoneField } from "./zone-field.js";

type UnitChoice = Unit | "auto";

/** A line may start with a label: `exp: 1760264100`, or a JSON member `"exp": 1760264100,`. */
const LABELLED = /^\s*"?([A-Za-z_][\w.-]*)"?\s*[:=]\s*"?(.+?)"?\s*,?\s*$/;
function splitLabel(line: string): { label?: string; value: string } {
  const match = LABELLED.exec(line);
  return match ? { label: match[1], value: match[2] } : { value: line.trim() };
}

/** Unix seconds, with milliseconds as a fraction when there are any. */
function unixSeconds(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const whole = Math.floor(abs / 1000);
  const fraction = abs % 1000;
  return sign + whole + (fraction ? "." + String(fraction).padStart(3, "0") : "");
}

const wallInput = (wall: WallTime) =>
  `${formatDate(wall)}T${formatClock(wall.hour * 60 + wall.minute)}:${String(wall.second).padStart(2, "0")}`;

export function convertView(app: App): View {
  const input = byId<HTMLTextAreaElement>("input");
  const note = byId("input-note");
  const unitButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-unit]")];
  const pickDate = byId<HTMLInputElement>("pick-date");
  const pickTime = byId<HTMLInputElement>("pick-time");
  const results = byId("results");
  const relative = byId("relative");
  const choiceUi = {
    box: byId("choice"),
    text: byId("choice-text"),
    buttons: byId("choice-buttons"),
  };

  const saved = app.saved;
  input.value = text(saved.input, String(Math.floor(Date.now() / 1000)));
  let unit: UnitChoice = saved.unit === "s" || saved.unit === "ms" ? saved.unit : "auto";
  let choice: Choice | undefined =
    saved.choice === "earlier" || saved.choice === "later" ? saved.choice : undefined;
  /** The instant on show, for the relative time that ticks. */
  let shown: number | undefined;
  let visible = false;

  const zoneField = bindZoneField(byId("input-zone"), text(saved.inputZone) || localZone(), () => {
    choice = undefined;
    update();
  });
  const pinField = bindZoneField(byId("pin-zone"), "", () => {});
  byId<HTMLInputElement>("pin-zone").value = "";

  function fitRows(): void {
    input.rows = Math.min(10, Math.max(1, input.value.split("\n").length));
  }

  /** One zone's row: its name and offset, the ISO date, and the date as the reader writes it. */
  function zoneRow(label: string, zone: string, ms: number, pinned = false): HTMLElement {
    const offset = utcOffset(offsetAt(ms, zone));
    const abbr = zoneAbbreviation(ms, zone);
    const iso = isoString(ms, zone);
    const actions = h("div", { class: "time-result-actions" });
    if (pinned) {
      const unpin = h(
        "button",
        { type: "button", class: "ui-btn ui-icon-btn", "aria-label": `Unpin ${zone}` },
        iconSvg("close")
      );
      unpin.addEventListener("click", () => {
        app.prefs.pinned = app.prefs.pinned.filter((z) => z !== zone);
        app.savePrefs();
        update();
      });
      actions.append(unpin);
    }
    actions.append(
      copyButton(
        `Copy ${label}`,
        () => iso,
        () => app.clipboardFailed(note)
      )
    );
    return h(
      "div",
      { class: "time-result" },
      h(
        "div",
        { class: "time-result-head" },
        h("span", { class: "time-result-label" }, label),
        h(
          "span",
          { class: "time-result-meta" },
          [zone === label ? "" : zone, offset, abbr].filter(Boolean).join(" · ")
        )
      ),
      h("code", { class: "time-result-value" }, iso),
      h("span", { class: "time-result-readable" }, readableDate(ms, zone, readable(app.prefs))),
      actions
    );
  }

  function plainRow(label: string, value: string, meta = ""): HTMLElement {
    return h(
      "div",
      { class: "time-result" },
      h(
        "div",
        { class: "time-result-head" },
        h("span", { class: "time-result-label" }, label),
        meta && h("span", { class: "time-result-meta" }, meta)
      ),
      h("code", { class: "time-result-value" }, value),
      h(
        "div",
        { class: "time-result-actions" },
        copyButton(
          `Copy ${label}`,
          () => value,
          () => app.clipboardFailed(note)
        )
      )
    );
  }

  function showResults(ms: number, readIn: string | undefined): void {
    shown = ms;
    const here = localZone();
    const rows: HTMLElement[] = [
      plainRow("Unix seconds", unixSeconds(ms)),
      plainRow("Unix milliseconds", String(ms)),
      zoneRow(UTC, UTC, ms),
      zoneRow("This device", here, ms),
    ];
    if (readIn && readIn !== here && readIn !== UTC) rows.push(zoneRow("Read in", readIn, ms));
    for (const zone of app.prefs.pinned)
      if (zone !== here && zone !== readIn && zone !== UTC)
        rows.push(zoneRow(zone, zone, ms, true));
    rows.push(plainRow("HTTP date", httpDate(ms), "RFC 9110"));
    results.replaceChildren(...rows);
    byId("results-card").removeAttribute("data-stale");
    tick();
  }

  function clearResults(): void {
    shown = undefined;
    showMessage(relative, "");
    byId("results-card").toggleAttribute("data-stale", results.childElementCount > 0);
  }

  function tick(): void {
    if (shown !== undefined) showMessage(relative, relativeTime(shown, Date.now()));
  }

  const requested = () => (unit === "auto" ? undefined : unit);

  /** What a parsed value means, and what to say about how it was read. */
  function describe(parsed: Parsed): {
    ms?: number;
    note: string;
    readIn?: string;
    wall?: WallTime;
  } {
    switch (parsed.kind) {
      case "error":
        return { note: parsed.message };
      case "unix":
        return {
          ms: parsed.ms,
          note:
            `Unix ${parsed.unit === "s" ? "seconds" : "milliseconds"}${parsed.detected ? ", by its size" : ""}.` +
            (parsed.dropped ? " Digits past milliseconds dropped." : ""),
        };
      case "instant":
        return {
          ms: parsed.ms,
          note:
            `Offset ${utcOffset(parsed.offset)} given.` +
            (parsed.dropped ? " Digits past milliseconds dropped." : ""),
          readIn: parsed.zone,
        };
      case "wall": {
        const zone = parsed.zone ?? zoneField.zone;
        const resolved = resolveShown(
          parsed.wall,
          zone,
          readable(app.prefs),
          choiceUi,
          choice,
          (next) => {
            choice = next;
            update();
          }
        );
        const assumed = parsed.dateOnly ? `00:00 in ${zone} assumed.` : `Read in ${zone}.`;
        return {
          ms: resolved.ms,
          note: [assumed, resolved.note, parsed.dropped ? "Digits past milliseconds dropped." : ""]
            .filter(Boolean)
            .join(" "),
          readIn: zone,
          wall: parsed.wall,
        };
      }
    }
  }

  function single(line: string): void {
    byId("results-card").hidden = false;
    byId("batch-card").hidden = true;
    const { label, value } = splitLabel(line);
    if (!value) {
      choiceUi.box.hidden = true;
      showMessage(note, "Type a timestamp or a date.");
      clearResults();
      return;
    }
    const parsed = parseTime(value, requested());
    if (parsed.kind !== "wall") choiceUi.box.hidden = true;
    const found = describe(parsed);
    showMessage(note, (label ? label + ": " : "") + found.note, parsed.kind === "error");
    if (found.ms === undefined) return clearResults();
    showResults(found.ms, found.readIn);
    // The pickers follow what was typed, in the zone things are read in.
    const wall = found.wall ?? wallAt(found.ms, zoneField.zone);
    if (wall.year >= 1 && wall.year <= 9999) {
      pickDate.value = formatDate(wall);
      pickTime.value = wallInput(wall).slice(11);
    }
  }

  function batch(lines: string[]): void {
    byId("results-card").hidden = true;
    byId("batch-card").hidden = false;
    choiceUi.box.hidden = true;
    shown = undefined;
    const zone = zoneField.zone;
    const rows = lines.map((line) => {
      const { label, value } = splitLabel(line);
      const parsed = parseTime(value, requested());
      let ms: number | undefined;
      let remark = "";
      if (parsed.kind === "error") remark = parsed.message;
      else if (parsed.kind === "wall") {
        const where = parsed.zone ?? zone;
        const found = resolveWall(parsed.wall, where);
        if (found.kind === "ambiguous") remark = `Happens twice in ${where}: give it an offset.`;
        else {
          ms = found.ms;
          remark =
            found.kind === "gap"
              ? `Does not exist in ${where}: read after the change.`
              : `Read in ${where}.`;
        }
      } else ms = parsed.ms;
      if (parsed.kind === "unix") remark = parsed.unit === "s" ? "Seconds." : "Milliseconds.";
      return { label: label ?? "", value, ms, remark, error: ms === undefined };
    });
    const labelled = rows.some((r) => r.label);
    const head = [...(labelled ? ["Label"] : []), "Input", "Unix seconds", "UTC", zone, "Note"];
    const cells = rows.map((r) => [
      ...(labelled ? [r.label] : []),
      r.value,
      r.ms === undefined ? "" : unixSeconds(r.ms),
      r.ms === undefined ? "" : isoString(r.ms, UTC),
      r.ms === undefined ? "" : isoString(r.ms, zone),
      r.remark,
    ]);
    const table = byId<HTMLTableElement>("batch");
    table.replaceChildren(
      h("thead", {}, h("tr", {}, ...head.map((c) => h("th", { scope: "col" }, c)))),
      h(
        "tbody",
        {},
        ...cells.map((row, i) =>
          h(
            "tr",
            { "data-error": rows[i].error ? "true" : undefined },
            ...row.map((c, j) =>
              h("td", { class: j < head.length - 1 ? "time-mono" : undefined }, c)
            )
          )
        )
      )
    );
    const failed = rows.filter((r) => r.error).length;
    showMessage(note, `${rows.length} lines.`);
    showMessage(byId("batch-note"), failed ? `${failed} could not be read.` : "", failed > 0);
    batchText = [head, ...cells].map((row) => row.join("\t")).join("\n");
  }
  let batchText = "";

  function update(): void {
    fitRows();
    press(unitButtons, "unit", unit);
    const lines = input.value.split("\n").filter((line) => line.trim());
    if (lines.length > 1) batch(lines);
    else single(lines[0] ?? "");
    app.save();
  }

  input.addEventListener("input", () => {
    choice = undefined;
    update();
  });
  for (const button of unitButtons)
    button.addEventListener("click", () => {
      unit = button.dataset.unit as UnitChoice;
      update();
    });
  const fromPicker = () => {
    const date = parseDate(pickDate.value);
    if (!date) return;
    const clock = pickTime.value ? parseClock(pickTime.value) : 0;
    if (clock === undefined) return;
    const seconds = /:(\d{2}):(\d{2})/.exec(pickTime.value)?.[2] ?? "00";
    input.value = `${formatDate(date)}T${formatClock(clock)}:${seconds}`;
    choice = undefined;
    update();
  };
  pickDate.addEventListener("change", fromPicker);
  pickTime.addEventListener("change", fromPicker);
  byId("now").addEventListener("click", () => {
    input.value = String(Math.floor(Date.now() / 1000));
    choice = undefined;
    update();
  });
  byId("input-clear").addEventListener("click", () => {
    input.value = "";
    update();
    input.focus();
  });
  byId("batch-copy").addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLElement;
    if (!(await copyText(batchText, button))) app.clipboardFailed(byId("batch-note"));
  });
  const pin = () => {
    const zone = pinField.zone;
    const typed = byId<HTMLInputElement>("pin-zone");
    if (!zone || typed.getAttribute("aria-invalid") === "true") return;
    if (!app.prefs.pinned.includes(zone)) {
      app.prefs.pinned = [...app.prefs.pinned, zone].slice(-MAX_PINNED);
      app.savePrefs();
    }
    typed.value = "";
    pinField.set("");
    update();
  };
  byId("pin").addEventListener("click", pin);
  byId("pin-zone").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      // The field reads what was typed as it is left; Enter commits it first.
      byId("pin-zone").dispatchEvent(new Event("change"));
      pin();
    }
  });
  app.onPrefs(update);
  setInterval(() => {
    if (visible) tick();
  }, 15_000);

  update();
  return {
    values: () => ({ input: input.value, unit, choice, inputZone: zoneField.zone }),
    shown(on) {
      visible = on;
      if (on) tick();
    },
  };
}
