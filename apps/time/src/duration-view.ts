/** Duration: calendar age and elapsed time between two dates, either of which can be now. */

import { bindSwitch, byId, copyText, isOn, parseClock, setOn, showMessage } from "@tools/ui";
import { dayNumber, parseDate } from "./lib/civil.js";
import type { WallTime } from "./lib/civil.js";
import { calendarSpan, describeSpan, nextAnniversary, totalIn } from "./lib/duration.js";
import type { Rounding, TotalUnit } from "./lib/duration.js";
import { formatDay, readableDate, relativeTime } from "./lib/format.js";
import { localZone, wallAt } from "./lib/zone.js";
import { text } from "./app.js";
import type { App, View } from "./app.js";
import { copyButton, h, press } from "./dom.js";
import { resolveShown } from "./resolution.js";
import type { Choice } from "./resolution.js";
import { bindZoneField } from "./zone-field.js";

type End = "start" | "end";

/** Each end is a date, or now; until someone says otherwise, from a date to now. */
const NOW: Record<End, boolean> = { start: false, end: true };
const UNITS: [TotalUnit, string][] = [
  ["days", "Days"],
  ["hours", "Hours"],
  ["minutes", "Minutes"],
  ["seconds", "Seconds"],
];

export function durationView(app: App): View {
  const saved = app.saved;
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

  let rounding: Rounding = saved.rounding === "nearest" ? "nearest" : "down";
  const choices: Partial<Record<End, Choice>> = {};
  let visible = false;
  for (const end of ["start", "end"] as const) {
    field(end, "date").value = text(saved[`${end}Date`]);
    field(end, "time").value = text(saved[`${end}Time`]);
    const on = saved[`${end}Now`];
    setOn(now(end), typeof on === "boolean" ? on : NOW[end]);
  }
  if (typeof saved.live === "boolean") setOn(live, saved.live);
  const zoneField = bindZoneField(byId("dur-zone"), text(saved.durZone) || localZone(), () =>
    update()
  );

  const legend = (end: End) => (end === "start" ? "From" : "To");

  /** One end as an instant, or what is missing; `timed` when it has a time of day. */
  /** `timed` is undefined for now, which has every time of day. */
  function instant(end: End, zone: string): { ms?: number; timed?: boolean; note: string } {
    choiceUi(end).box.hidden = true;
    if (isOn(now(end))) return { ms: Date.now(), timed: undefined, note: "" };
    const date = parseDate(field(end, "date").value);
    if (!date)
      return { timed: false, note: `Choose the ${end === "start" ? "first" : "second"} date.` };
    const clock = field(end, "time").value.trim();
    const time = clock ? parseClock(clock) : { minutes: 0, second: 0 };
    if (!time)
      return { timed: true, note: `${legend(end)}: type the time as HH:MM, on the 24-hour clock.` };
    const wall: WallTime = {
      ...date,
      hour: Math.floor(time.minutes / 60),
      minute: time.minutes % 60,
      second: time.second,
      ms: 0,
    };
    const resolved = resolveShown(wall, zone, choiceUi(end), choices[end], (choice) => {
      choices[end] = choice;
      update();
    });
    const note = clock ? resolved.note : `${legend(end)}: 00:00 assumed. ${resolved.note}`.trim();
    return { ms: resolved.ms, timed: Boolean(clock), note };
  }

  function show(): void {
    const zone = zoneField.zone;
    for (const end of ["start", "end"] as const) {
      field(end, "date").disabled = isOn(now(end));
      field(end, "time").disabled = isOn(now(end));
    }
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

  /**
   * From a date in the past to now: when it next comes round (a birthday, the day two people met).
   * With one end now otherwise: the other end, and how far off it is.
   */
  function extraLine(start: number, end: number, zone: string): string {
    const startNow = isOn(now("start"));
    const endNow = isOn(now("end"));
    if (!startNow && endNow && start < end) {
      const from = parseDate(field("start", "date").value)!;
      const today = wallAt(end, zone);
      const next = nextAnniversary(from, today);
      if (next.years === 0) return "";
      const days = dayNumber(next.date) - dayNumber(today);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      return `${next.years} ${next.years === 1 ? "year" : "years"} on ${formatDay(next.date)}, ${when}.`;
    }
    const other = startNow ? end : start;
    if (startNow || endNow)
      return `${readableDate(other, zone)} · ${relativeTime(other, Date.now())}`;
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

  show();
  return {
    values: () => ({
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
