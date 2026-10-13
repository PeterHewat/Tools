/** Duration: calendar age and elapsed time between two dates, either of which can be now. */

import { bindSwitch, byId, copyText, isOn, setOn, showMessage } from "@tools/ui";
import { dayNumber, parseClock, parseDate } from "./lib/civil.js";
import type { WallTime } from "./lib/civil.js";
import { calendarSpan, describeSpan, nextAnniversary, totalIn } from "./lib/duration.js";
import type { Rounding, TotalUnit } from "./lib/duration.js";
import { readableDate, relativeTime } from "./lib/format.js";
import { localZone, wallAt } from "./lib/zone.js";
import { readable } from "./prefs.js";
import { text } from "./app.js";
import type { App, View } from "./app.js";
import { copyButton, h, press } from "./dom.js";
import { resolveShown } from "./resolution.js";
import type { Choice } from "./resolution.js";
import { bindZoneField } from "./zone-field.js";

type Preset = "age" | "since" | "until" | "between";
type End = "start" | "end";

const LEGENDS: Record<Preset, [string, string]> = {
  age: ["Born", "Age on"],
  since: ["Since", "Until"],
  until: ["From", "Until"],
  between: ["From", "To"],
};
const NOW: Record<Preset, [boolean, boolean]> = {
  age: [false, true],
  since: [false, true],
  until: [true, false],
  between: [false, false],
};
const UNITS: [TotalUnit, string][] = [
  ["weeks", "Weeks"],
  ["days", "Days"],
  ["hours", "Hours"],
  ["minutes", "Minutes"],
  ["seconds", "Seconds"],
];

export function durationView(app: App): View {
  const saved = app.saved;
  const presetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-preset]")];
  const roundingButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-rounding]")];
  const field = (end: End, part: "date" | "time") => byId<HTMLInputElement>(`${end}-${part}`);
  const now = (end: End) => byId(`${end}-now`);
  const assume = byId("dur-assume");
  const choiceUi = (end: End) => ({
    box: byId(`${end}-choice`),
    text: byId(`${end}-choice-text`),
    buttons: byId(`${end}-choice-buttons`),
  });
  const live = byId("live");

  let preset: Preset =
    (["age", "since", "until", "between"] as const).find((p) => p === saved.preset) ?? "age";
  let rounding: Rounding = saved.rounding === "nearest" ? "nearest" : "down";
  const choices: Partial<Record<End, Choice>> = {};
  let visible = false;
  for (const end of ["start", "end"] as const) {
    field(end, "date").value = text(saved[`${end}Date`]);
    field(end, "time").value = text(saved[`${end}Time`]);
    const on = saved[`${end}Now`];
    setOn(now(end), typeof on === "boolean" ? on : NOW[preset][end === "start" ? 0 : 1]);
  }
  if (typeof saved.live === "boolean") setOn(live, saved.live);
  const zoneField = bindZoneField(byId("dur-zone"), text(saved.durZone) || localZone(), () =>
    update()
  );

  /** One end as an instant, or what is missing; `timed` when it has a time of day. */
  /** `timed` is undefined for now, which has every time of day. */
  function instant(end: End, zone: string): { ms?: number; timed?: boolean; note: string } {
    choiceUi(end).box.hidden = true;
    if (isOn(now(end))) return { ms: Date.now(), timed: undefined, note: "" };
    const date = parseDate(field(end, "date").value);
    if (!date)
      return { timed: false, note: `Choose the ${end === "start" ? "first" : "second"} date.` };
    const clock = field(end, "time").value;
    const minutes = clock ? parseClock(clock) : 0;
    const second = Number(/:\d{2}:(\d{2})/.exec(clock)?.[1] ?? 0);
    const wall: WallTime = {
      ...date,
      hour: Math.floor((minutes ?? 0) / 60),
      minute: (minutes ?? 0) % 60,
      second,
      ms: 0,
    };
    const resolved = resolveShown(
      wall,
      zone,
      readable(app.prefs),
      choiceUi(end),
      choices[end],
      (choice) => {
        choices[end] = choice;
        update();
      }
    );
    const legend = byId(`${end}-legend`).textContent;
    const note = clock ? resolved.note : `${legend}: 00:00 assumed. ${resolved.note}`.trim();
    return { ms: resolved.ms, timed: Boolean(clock), note };
  }

  function show(): void {
    const zone = zoneField.zone;
    const [startLegend, endLegend] = LEGENDS[preset];
    byId("start-legend").textContent = startLegend;
    byId("end-legend").textContent = endLegend;
    for (const end of ["start", "end"] as const) {
      field(end, "date").disabled = isOn(now(end));
      field(end, "time").disabled = isOn(now(end));
    }
    press(presetButtons, "preset", preset);
    press(roundingButtons, "rounding", rounding);
    const start = instant("start", zone);
    const end = instant("end", zone);
    showMessage(assume, [start.note, end.note].filter(Boolean).join(" "));
    const span = byId("span");
    const extra = byId("span-extra");
    const totals = byId("totals");
    const copy = byId<HTMLButtonElement>("span-copy");
    if (start.ms === undefined || end.ms === undefined) {
      span.textContent = "—";
      extra.textContent = "";
      showMessage(byId("span-note"), "");
      totals.hidden = true;
      copy.disabled = true;
      return;
    }
    const calendar = calendarSpan(start.ms, end.ms, zone);
    const words = describeSpan(calendar, start.timed !== false && end.timed !== false);
    span.textContent = words;
    copy.disabled = false;
    showMessage(byId("span-note"), calendar.negative ? "The second date is before the first." : "");
    extra.textContent = extraLine(start.ms, end.ms, zone);
    const elapsed = end.ms - start.ms;
    totals.hidden = false;
    for (const [unit] of UNITS) {
      values[unit] = totalIn(elapsed, unit, rounding);
      cells[unit].textContent = numbers.format(values[unit]);
    }
  }

  /** The age to come, or the date being counted to or from. */
  function extraLine(start: number, end: number, zone: string): string {
    const options = readable(app.prefs);
    if (preset === "age" && !isOn(now("start"))) {
      const birth = parseDate(field("start", "date").value)!;
      const today = wallAt(isOn(now("end")) ? Date.now() : end, zone);
      const next = nextAnniversary(birth, today);
      const days = dayNumber(next.date) - dayNumber(today);
      if (next.years === 0) return "";
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      return `Turns ${next.years} ${when}.`;
    }
    const other = isOn(now("start")) ? end : start;
    if (isOn(now("start")) || isOn(now("end")))
      return `${readableDate(other, zone, options)} · ${relativeTime(other, Date.now())}`;
    return "";
  }

  /** The totals' rows, made once: a live count rewrites only their numbers, so focus stays. */
  const numbers = new Intl.NumberFormat();
  const values = {} as Record<TotalUnit, number>;
  const cells = {} as Record<TotalUnit, HTMLElement>;
  byId("totals").replaceChildren(
    ...UNITS.map(([unit, label]) => {
      cells[unit] = h("code", { class: "time-result-value" });
      return h(
        "div",
        { class: "time-result time-total" },
        h("div", { class: "time-result-head" }, h("span", { class: "time-result-label" }, label)),
        cells[unit],
        h(
          "div",
          { class: "time-result-actions" },
          copyButton(
            `Copy ${label.toLowerCase()}`,
            () => String(values[unit]),
            () => app.clipboardFailed(byId("span-note"))
          )
        )
      );
    })
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  function schedule(): void {
    const ticking = visible && isOn(live) && (isOn(now("start")) || isOn(now("end")));
    if (ticking && !timer) timer = setInterval(show, 1000);
    if (!ticking && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function update(): void {
    show();
    schedule();
    app.save();
  }

  for (const button of presetButtons)
    button.addEventListener("click", () => {
      preset = button.dataset.preset as Preset;
      setOn(now("start"), NOW[preset][0]);
      setOn(now("end"), NOW[preset][1]);
      update();
      const first = (["start", "end"] as const).find((end) => !isOn(now(end)));
      if (first) field(first, "date").focus();
    });
  for (const button of roundingButtons)
    button.addEventListener("click", () => {
      rounding = button.dataset.rounding as Rounding;
      update();
    });
  for (const end of ["start", "end"] as const) {
    for (const part of ["date", "time"] as const)
      field(end, part).addEventListener("input", () => {
        delete choices[end];
        update();
      });
    bindSwitch(now(end), () => update());
  }
  bindSwitch(live, () => update());
  byId("span-copy").addEventListener("click", async () => {
    if (!(await copyText(byId("span").textContent ?? "", byId("span-copy"))))
      app.clipboardFailed(byId("span-note"));
  });
  app.onPrefs(show);

  show();
  return {
    values: () => ({
      preset,
      rounding,
      live: isOn(live),
      durZone: zoneField.zone,
      startDate: field("start", "date").value,
      startTime: field("start", "time").value,
      startNow: isOn(now("start")),
      endDate: field("end", "date").value,
      endTime: field("end", "time").value,
      endNow: isOn(now("end")),
    }),
    shown(on) {
      visible = on;
      if (on) show();
      schedule();
    },
  };
}
