/** Find a time: people and their windows, the search, what fits, a day's timeline, share links. */

import { fromBase64, toBase64, utf8, textFromBytes } from "@tools/bytes";
import {
  byId,
  copyText,
  debounce,
  iconSvg,
  readStored,
  setOn,
  showMessage,
  writeStored,
} from "@tools/ui";
import {
  combine,
  costOf,
  diagnose,
  explain,
  findTimes,
  LEVELS,
  personSegments,
  rankKey,
  summary,
  MAX_SEARCH_DAYS,
} from "./lib/availability.js";
import type {
  Level,
  Person,
  Search,
  Segment,
  Suggestion,
  TimeWindow,
  WeeklyWindow,
} from "./lib/availability.js";
import {
  addDays,
  atMinutes,
  dayNumber,
  DAY,
  formatClock,
  formatDate,
  MINUTE,
  parseClock,
  parseDate,
} from "./lib/civil.js";
import type { PlainDate } from "./lib/civil.js";
import { clockTime, formatMinutes, shortDate, utcOffset } from "./lib/format.js";
import { DEFAULT_DURATION, newPerson, readPlan, sharePlan, writePlan } from "./lib/plan.js";
import type { Plan } from "./lib/plan.js";
import { canonicalZone, instantOf, localZone, offsetAt, wallAt } from "./lib/zone.js";
import { readable } from "./prefs.js";
import { text } from "./app.js";
import type { App, View } from "./app.js";
import { h } from "./dom.js";
import { bindZoneField } from "./zone-field.js";

const PLAN_KEY = "tools.time.plan";
/** Starts are this far apart. Every zone in use today is a whole number of quarter hours from UTC. */
const STEP = 15;
const PAGE = 10;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LEVEL_NAMES: Record<Level, string> = {
  preferred: "Preferred",
  acceptable: "Acceptable",
  unavailable: "Unavailable",
};
export const SHARE_PREFIX = "#plan=";

/** First visit: three people in three zones, so every part of the view has something to show. */
function examplePlan(): Plan {
  const here = localZone();
  return {
    people: [
      newPerson("You", here),
      newPerson("Sam", here === "America/New_York" ? "America/Los_Angeles" : "America/New_York"),
      newPerson("Kai", here === "Asia/Tokyo" ? "Australia/Sydney" : "Asia/Tokyo"),
    ],
    duration: DEFAULT_DURATION,
  };
}

/**
 * A plan in a link: JSON, compressed where the browser can, in Base64url. `z` marks compressed
 * and `j` plain, so a link works in a browser either way.
 */
export async function encodeShare(plan: Plan): Promise<string> {
  const json = utf8(JSON.stringify(sharePlan(plan)));
  if (typeof CompressionStream === "undefined") return "j" + toBase64(json, true);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return "z" + toBase64(new Uint8Array(await new Response(stream).arrayBuffer()), true);
}

export async function decodeShare(value: string): Promise<Plan | undefined> {
  try {
    let bytes: Uint8Array<ArrayBuffer> = fromBase64(value.slice(1), true);
    if (value[0] === "z") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (value[0] !== "j") return undefined;
    return readPlan(JSON.parse(textFromBytes(bytes)));
  } catch {
    return undefined;
  }
}

export function meetView(app: App): View {
  const saved = app.saved;
  const stored = readPlan(readStored(PLAN_KEY));
  let plan: Plan = stored ?? examplePlan();
  let pending: Plan | undefined;
  /** People whose card is folded. */
  const folded = new Set<string>(
    Array.isArray(saved.folded)
      ? saved.folded.filter((x): x is string => typeof x === "string")
      : // The example opens on its first person; the others are folded to their name and zone.
        stored
        ? []
        : plan.people.slice(1).map((p) => p.id)
  );
  let shownCount = PAGE;
  let suggestions: Suggestion[] = [];
  let selected: number | undefined =
    typeof saved.selected === "number" ? saved.selected : undefined;
  let day: PlainDate | undefined = parseDate(text(saved.day));
  let visible = false;

  const peopleBox = byId("people");
  const length = byId<HTMLSelectElement>("call-length");
  const rangeFrom = byId<HTMLInputElement>("range-from");
  const rangeTo = byId<HTMLInputElement>("range-to");
  const zoneField = bindZoneField(byId("meet-zone"), text(saved.meetZone) || localZone(), () => {
    day = undefined;
    research();
  });
  const zone = () => zoneField.zone;

  const today = wallAt(Date.now(), zone());
  rangeFrom.value = text(saved.rangeFrom) || formatDate(today);
  rangeTo.value = text(saved.rangeTo) || formatDate(addDays(today, 6));

  function savePlan(): void {
    writeStored(PLAN_KEY, writePlan(plan));
  }

  function setLength(minutes: number): void {
    if (![...length.options].some((o) => o.value === String(minutes)))
      length.append(h("option", { value: String(minutes) }, formatMinutes(minutes)));
    length.value = String(minutes);
  }
  setLength(plan.duration);

  // ---------- People ----------

  const levelSelect = (level: Level) =>
    h(
      "select",
      { class: "ui-input", "data-field": "level", "aria-label": "Level" },
      ...LEVELS.map((l) => h("option", { value: l, selected: l === level }, LEVEL_NAMES[l]))
    );

  function windowRow(
    window: TimeWindow | WeeklyWindow,
    index: number,
    exception?: number
  ): HTMLElement {
    const days =
      "days" in window
        ? h(
            "div",
            { class: "ui-seg time-days", role: "group", "aria-label": "Days" },
            ...DAY_NAMES.map((name, i) =>
              h(
                "button",
                {
                  type: "button",
                  class: "ui-btn ui-btn--small",
                  "data-day": String(i + 1),
                  "aria-pressed": String(window.days.includes(i + 1)),
                  "aria-label": name,
                  title: name,
                },
                name.slice(0, 2)
              )
            )
          )
        : undefined;
    const clock = (field: "start" | "end", label: string) =>
      h("input", {
        class: "ui-input",
        type: "time",
        step: "60",
        "data-field": field,
        "aria-label": label,
        value: formatClock(window[field]),
      });
    return h(
      "div",
      {
        class: "time-window",
        "data-window": String(index),
        "data-exception": exception === undefined ? undefined : String(exception),
        "data-level": window.level,
      },
      days,
      h(
        "div",
        { class: "time-window-hours" },
        clock("start", "From"),
        h("span", { "aria-hidden": "true" }, "–"),
        clock("end", "Until"),
        levelSelect(window.level),
        h(
          "button",
          {
            type: "button",
            class: "ui-btn ui-icon-btn",
            "data-action": "remove-window",
            "aria-label": "Remove window",
          },
          iconSvg("close")
        )
      )
    );
  }

  function personCard(person: Person): HTMLElement {
    const valid = canonicalZone(person.zone) !== undefined;
    const meta = valid
      ? `${person.zone} · ${utcOffset(offsetAt(Date.now(), person.zone))}`
      : `${person.zone} · unknown zone`;
    const zoneInput = h("input", {
      class: "ui-input time-zone",
      list: "zone-list",
      "aria-label": "Time zone",
    });
    const relaxed = h("button", {
      type: "button",
      class: "ui-switch",
      role: "switch",
      "aria-checked": String(person.relaxed),
      "data-field": "relaxed",
    });
    const card = h(
      "details",
      { class: "time-person", "data-person": person.id, open: !folded.has(person.id) },
      h(
        "summary",
        {},
        h("span", { class: "time-person-name" }, person.name || "Unnamed"),
        h("span", { class: "time-person-meta" }, meta),
        person.relaxed && h("span", { class: "time-badge" }, "Relaxed")
      ),
      h(
        "div",
        { class: "time-person-body" },
        h(
          "div",
          { class: "time-person-fields" },
          h(
            "label",
            {},
            h("span", {}, "Name"),
            h("input", {
              class: "ui-input",
              "data-field": "name",
              value: person.name,
              maxlength: "60",
              autocomplete: "off",
            })
          ),
          h("label", {}, h("span", {}, "Time zone"), zoneInput)
        ),
        h("h3", {}, "Every week"),
        h("div", { class: "time-windows" }, ...person.windows.map((w, i) => windowRow(w, i))),
        h(
          "button",
          { type: "button", class: "ui-btn ui-btn--small", "data-action": "add-window" },
          iconSvg("plus"),
          "Window"
        ),
        h("h3", {}, "Dates that differ"),
        ...person.exceptions.map((x, i) =>
          h(
            "div",
            { class: "time-exception", "data-exception": String(i) },
            h(
              "div",
              { class: "time-exception-head" },
              h("input", {
                class: "ui-input",
                type: "date",
                "data-field": "date",
                value: x.date,
                "aria-label": "Date",
              }),
              h(
                "span",
                { class: "ui-note" },
                x.windows.length ? "Replaces that day's weekly windows." : "Unavailable all day."
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "ui-btn ui-icon-btn",
                  "data-action": "remove-exception",
                  "aria-label": "Remove date",
                },
                iconSvg("trash")
              )
            ),
            ...x.windows.map((w, j) => windowRow(w, j, i)),
            h(
              "button",
              {
                type: "button",
                class: "ui-btn ui-btn--small",
                "data-action": "add-exception-window",
              },
              iconSvg("plus"),
              "Window"
            )
          )
        ),
        h(
          "button",
          { type: "button", class: "ui-btn ui-btn--small", "data-action": "add-exception" },
          iconSvg("plus"),
          "Date"
        ),
        h(
          "div",
          { class: "time-person-foot" },
          h("label", { class: "time-switch" }, relaxed, "Allow unavailable time"),
          h(
            "button",
            { type: "button", class: "ui-btn ui-btn--small", "data-action": "remove-person" },
            iconSvg("trash"),
            "Remove"
          )
        )
      )
    );
    bindZoneField(zoneInput, person.zone, (next) => {
      person.zone = next;
      changed();
      refreshSummary(person);
    });
    if (!valid) zoneInput.setAttribute("aria-invalid", "true");
    return card;
  }

  function refreshSummary(person: Person): void {
    const card = peopleBox.querySelector<HTMLDetailsElement>(`[data-person="${person.id}"]`);
    if (!card) return;
    const old = card.querySelector("summary")!;
    const fresh = personCard(person).querySelector("summary")!;
    old.replaceChildren(...fresh.childNodes);
  }

  function renderPeople(): void {
    peopleBox.replaceChildren(...plan.people.map(personCard));
    if (!plan.people.length)
      peopleBox.append(h("p", { class: "time-empty" }, "No one yet. Add a person to compare."));
    showMessage(
      byId("people-note"),
      plan.people.length
        ? `${plan.people.length} ${plan.people.length === 1 ? "person" : "people"}`
        : ""
    );
  }

  /** The person, window and exception an event happened in. */
  function locate(target: HTMLElement) {
    const card = target.closest<HTMLElement>("[data-person]");
    const person = plan.people.find((p) => p.id === card?.dataset.person);
    const row = target.closest<HTMLElement>("[data-window]");
    const exceptionBox = target.closest<HTMLElement>(".time-exception");
    const exception = exceptionBox
      ? person?.exceptions[Number(exceptionBox.dataset.exception)]
      : undefined;
    const index = row ? Number(row.dataset.window) : -1;
    const window = row
      ? exception
        ? exception.windows[index]
        : person?.windows[index]
      : undefined;
    return { person, exception, window, index, row };
  }

  peopleBox.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const { person, exception, window, row } = locate(target);
    if (!person) return;
    switch (target.dataset.field) {
      case "name":
        person.name = target.value.slice(0, 60);
        refreshSummary(person);
        break;
      case "start":
      case "end": {
        const minutes = parseClock(target.value);
        if (window && minutes !== undefined) window[target.dataset.field] = minutes;
        break;
      }
      case "level":
        if (window) window.level = target.value as Level;
        row?.setAttribute("data-level", target.value);
        break;
      case "date":
        if (
          exception &&
          parseDate(target.value) &&
          !person.exceptions.some((x) => x !== exception && x.date === target.value)
        )
          exception.date = target.value;
        break;
      default:
        return;
    }
    changed();
  });

  peopleBox.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target) return;
    const { person, exception, window, index } = locate(target);
    if (!person) return;
    if (target.dataset.day && window && !exception) {
      const weekly = window as WeeklyWindow;
      const d = Number(target.dataset.day);
      const days = weekly.days.includes(d)
        ? weekly.days.filter((x) => x !== d)
        : [...weekly.days, d].sort();
      // A weekly window keeps at least one day: remove the window to have none.
      if (!days.length) return;
      weekly.days = days;
      target.setAttribute("aria-pressed", String(days.includes(d)));
      return changed();
    }
    if (target.dataset.field === "relaxed") {
      person.relaxed = !person.relaxed;
      setOn(target, person.relaxed);
      refreshSummary(person);
      return changed();
    }
    switch (target.dataset.action) {
      case "add-window":
        person.windows.push({
          days: [1, 2, 3, 4, 5],
          start: 9 * 60,
          end: 17 * 60,
          level: "acceptable",
        });
        break;
      case "remove-window":
        if (exception) exception.windows.splice(index, 1);
        else person.windows.splice(index, 1);
        break;
      case "add-exception": {
        let date = parseDate(rangeFrom.value) ?? wallAt(Date.now(), person.zone);
        while (person.exceptions.some((x) => x.date === formatDate(date))) date = addDays(date, 1);
        person.exceptions.push({ date: formatDate(date), windows: [] });
        break;
      }
      case "remove-exception":
        if (exception) person.exceptions.splice(person.exceptions.indexOf(exception), 1);
        break;
      case "add-exception-window":
        exception?.windows.push({ start: 9 * 60, end: 17 * 60, level: "acceptable" });
        break;
      case "remove-person":
        plan.people.splice(plan.people.indexOf(person), 1);
        folded.delete(person.id);
        break;
      default:
        return;
    }
    // Structure changed: draw the people again, keeping the focus near where it was.
    const id = person.id;
    renderPeople();
    const card = peopleBox.querySelector<HTMLElement>(`[data-person="${id}"]`);
    (
      card?.querySelector<HTMLElement>(`[data-action="${target.dataset.action}"]`) ??
      byId("add-person")
    ).focus();
    changed();
  });

  peopleBox.addEventListener(
    "toggle",
    (event) => {
      const card = event.target as HTMLDetailsElement;
      if (!card.dataset?.person) return;
      if (card.open) folded.delete(card.dataset.person);
      else folded.add(card.dataset.person);
      app.save();
    },
    true
  );

  byId("add-person").addEventListener("click", () => {
    const person = newPerson(`Person ${plan.people.length + 1}`, zone());
    plan.people.push(person);
    renderPeople();
    peopleBox
      .querySelector<HTMLInputElement>(`[data-person="${person.id}"] [data-field="name"]`)
      ?.select();
    changed();
  });

  // ---------- Search ----------

  function range(): { search?: Search; problem?: string } {
    const from = parseDate(rangeFrom.value);
    const to = parseDate(rangeTo.value);
    if (!from || !to) return { problem: "Choose the dates to search." };
    const days = dayNumber(to) - dayNumber(from) + 1;
    if (days < 1) return { problem: "The last date is before the first." };
    if (days > MAX_SEARCH_DAYS)
      return { problem: `Search up to ${MAX_SEARCH_DAYS} days at a time.` };
    return {
      search: {
        from: instantOf(atMinutes(from, 0), zone()),
        to: instantOf(atMinutes(addDays(to, 1), 0), zone()),
        duration: plan.duration,
        step: STEP,
      },
    };
  }

  const usable = () => plan.people.filter((p) => canonicalZone(p.zone) !== undefined);

  function tier(s: Suggestion): "preferred" | "compromise" | "relaxed" {
    const key = rankKey(s);
    return key[0] ? "relaxed" : key[3] ? "compromise" : "preferred";
  }

  function renderSuggestions(): void {
    const list = byId("suggestions");
    const options = readable(app.prefs);
    const people = usable();
    list.replaceChildren(
      ...suggestions.slice(0, shownCount).map((s) => {
        const end = s.start + plan.duration * MINUTE;
        const startDay = shortDate(s.start, zone());
        const endDay = shortDate(end, zone());
        const when = `${startDay}, ${clockTime(s.start, zone(), options)}–${clockTime(end, zone(), options)}${endDay === startDay ? "" : ` (${endDay})`}`;
        const button = h(
          "button",
          {
            type: "button",
            class: "time-suggestion",
            "data-tier": tier(s),
            "aria-pressed": String(
              selected !== undefined && selected >= s.start && selected <= s.last
            ),
          },
          h("span", { class: "time-suggestion-when" }, when),
          s.last > s.start &&
            h(
              "span",
              { class: "time-suggestion-range" },
              `or start any time until ${clockTime(s.last, zone(), options)}`
            ),
          h("span", { class: "time-suggestion-why" }, explain(people, s.costs))
        );
        button.addEventListener("click", () => pick(s.start));
        return h("li", {}, button);
      })
    );
    byId("more").hidden = suggestions.length <= shownCount;
  }

  function renderDiagnosis(search: Search): void {
    const box = byId("diagnosis");
    const people = usable();
    if (suggestions.length || people.length < 1) {
      box.hidden = true;
      return;
    }
    const found = diagnose(people, search);
    const name = (id: string) => people.find((p) => p.id === id)?.name || "Unnamed";
    const lines: HTMLElement[] = [
      h("p", {}, "No time in this range fits everyone's windows for the whole call."),
    ];
    for (const id of found.alone)
      lines.push(
        h(
          "p",
          {},
          `${name(id)} has no ${formatMinutes(plan.duration)} stretch of preferred or acceptable time in this range.`
        )
      );
    for (const { id, count } of found.blocking) {
      const relax = h(
        "button",
        { type: "button", class: "ui-btn ui-btn--small" },
        `Allow ${name(id)}'s unavailable time`
      );
      relax.addEventListener("click", () => {
        const person = plan.people.find((p) => p.id === id);
        if (!person) return;
        person.relaxed = true;
        renderPeople();
        changed();
      });
      lines.push(
        h(
          "p",
          {},
          `Without ${name(id)}, ${count} ${count === 1 ? "time fits" : "times fit"}. `,
          relax
        )
      );
    }
    if (!found.alone.length && !found.blocking.length && people.length > 1)
      lines.push(
        h(
          "p",
          {},
          "No one person stands in the way: several people's windows would have to change, or search more dates."
        )
      );
    box.replaceChildren(...lines);
    box.hidden = false;
  }

  function research(): void {
    const note = byId("search-note");
    const { search, problem } = range();
    const people = usable();
    const broken = plan.people.filter((p) => !people.includes(p)).map((p) => p.name || "Unnamed");
    showMessage(
      note,
      problem ?? (broken.length ? `Unknown time zone for ${broken.join(", ")}: left out.` : ""),
      Boolean(problem || broken.length)
    );
    if (!search || !people.length) {
      suggestions = [];
      byId("diagnosis").hidden = true;
      showMessage(byId("suggestions-note"), people.length ? "" : "Add people to compare.");
    } else {
      suggestions = findTimes(people, search);
      const best = suggestions.filter((s) => tier(s) === "preferred").length;
      showMessage(
        byId("suggestions-note"),
        suggestions.length
          ? `${suggestions.length} ${suggestions.length === 1 ? "time" : "times"}${best ? `, ${best} preferred by everyone` : ""}.`
          : "None fits."
      );
      renderDiagnosis(search);
      if (!day) day = wallAt(suggestions[0]?.start ?? search.from, zone());
    }
    shownCount = PAGE;
    renderSuggestions();
    renderTimeline();
    app.save();
  }
  const researchSoon = debounce(research, 150);

  function changed(): void {
    savePlan();
    researchSoon();
  }

  // ---------- Timeline ----------

  function hourLabel(ms: number, zoneName: string): string {
    const wall = wallAt(ms, zoneName);
    if (app.prefs.clock === "12") {
      const hour = wall.hour % 12 || 12;
      return `${hour}${wall.minute ? ":" + String(wall.minute).padStart(2, "0") : ""}${wall.hour < 12 ? "a" : "p"}`;
    }
    return wall.minute ? formatClock(wall.hour * 60 + wall.minute) : String(wall.hour);
  }

  function track(
    segments: Segment[],
    from: number,
    to: number,
    hoursZone: string,
    label: string
  ): HTMLElement {
    const span = to - from;
    const pct = (t: number) => `${(((t - from) / span) * 100).toFixed(3)}%`;
    const hours = h("div", { class: "tl-hours", "aria-hidden": "true" });
    let lastDate = "";
    for (let t = from, i = 0; t < to; t += 60 * MINUTE, i++) {
      const date = formatDate(wallAt(t, hoursZone));
      const newDay = date !== lastDate && i > 0;
      lastDate = date;
      hours.append(
        h(
          "span",
          {
            class: `tl-hour${i % 3 ? " tl-minor" : ""}${newDay ? " tl-newday" : ""}`,
            style: `left:${pct(t)}`,
          },
          newDay ? shortDate(t, hoursZone).split(/[ ,]/)[0] : hourLabel(t, hoursZone)
        )
      );
    }
    const bar = h("div", { class: "tl-bar", role: "img", "aria-label": label });
    for (const s of segments)
      if (s.end > from && s.start < to)
        bar.append(
          h("span", {
            class: `tl-seg level-${s.level}`,
            style: `left:${pct(Math.max(s.start, from))};width:${(((Math.min(s.end, to) - Math.max(s.start, from)) / span) * 100).toFixed(3)}%`,
          })
        );
    if (selected !== undefined) {
      const end = selected + plan.duration * MINUTE;
      if (end > from && selected < to)
        bar.append(
          h("span", {
            class: "tl-call",
            style: `left:${pct(Math.max(selected, from))};width:${(((Math.min(end, to) - Math.max(selected, from)) / span) * 100).toFixed(3)}%`,
          })
        );
    }
    const now = Date.now();
    if (now >= from && now < to)
      bar.append(h("span", { class: "tl-now", style: `left:${pct(now)}` }));
    return h("div", { class: "tl-track" }, hours, bar);
  }

  /** Words for a row's levels, for those who cannot see the colours. */
  function describeRow(name: string, segments: Segment[], zoneName: string): string {
    const options = readable(app.prefs);
    const parts = segments
      .filter((s) => s.level !== "unavailable")
      .map(
        (s) =>
          `${LEVEL_NAMES[s.level].toLowerCase()} ${clockTime(s.start, zoneName, options)}–${clockTime(s.end, zoneName, options)}`
      );
    return `${name}: ${parts.length ? parts.join(", ") : "unavailable all day"}`;
  }

  function dayBounds(): [number, number] {
    const date = day ?? wallAt(Date.now(), zone());
    return [
      instantOf(atMinutes(date, 0), zone()),
      instantOf(atMinutes(addDays(date, 1), 0), zone()),
    ];
  }

  function renderTimeline(): void {
    const [from, to] = dayBounds();
    const people = usable();
    byId("timeline-day").textContent = `${shortDate(from, zone())} · ${zone()}`;
    const segments = people.map((p) => personSegments(p, from, to));
    const rows: HTMLElement[] = [];
    if (people.length > 1) {
      const all = combine(segments, from, to);
      rows.push(
        h(
          "div",
          { class: "tl-row tl-all" },
          h("div", { class: "tl-name" }, h("span", {}, "Everyone"), h("small", {}, zone())),
          track(all, from, to, zone(), describeRow("Everyone", all, zone()))
        )
      );
    }
    people.forEach((person, i) =>
      rows.push(
        h(
          "div",
          { class: "tl-row" },
          h(
            "div",
            { class: "tl-name" },
            h("span", {}, person.name || "Unnamed"),
            h("small", {}, person.zone)
          ),
          track(
            segments[i],
            from,
            to,
            person.zone,
            describeRow(person.name || "Unnamed", segments[i], person.zone)
          )
        )
      )
    );
    byId("timeline").replaceChildren(...rows);
    renderPicked();
  }

  function renderPicked(): void {
    const people = usable();
    const [from] = dayBounds();
    const input = byId<HTMLInputElement>("picked-time");
    const copy = byId<HTMLButtonElement>("picked-copy");
    byId("picked-zone").textContent = `${shortDate(from, zone())}, ${zone()}`;
    if (selected === undefined || !people.length) {
      input.value = "";
      copy.disabled = true;
      byId("picked-text").textContent = people.length
        ? "Choose a suggestion, or click the timeline, to place the call."
        : "";
      byId("picked-summary").textContent = "";
      return;
    }
    const wall = wallAt(selected, zone());
    input.value = formatClock(wall.hour * 60 + wall.minute);
    const end = selected + plan.duration * MINUTE;
    const costs = people.map((p) =>
      costOf(personSegments(p, selected! - DAY, end + DAY), selected!, end)
    );
    const blocked = people
      .filter((p, i) => !p.relaxed && costs[i].unavailable > 0)
      .map((p) => p.name || "Unnamed");
    showMessage(
      byId("picked-text"),
      (blocked.length
        ? `Does not fit: ${blocked.join(", ")} ${blocked.length === 1 ? "is" : "are"} unavailable for part of it. `
        : "") + explain(people, costs),
      blocked.length > 0
    );
    byId("picked-summary").textContent = summary(
      people,
      selected,
      plan.duration,
      readable(app.prefs)
    );
    copy.disabled = false;
  }

  function pick(start: number): void {
    selected = start;
    day = wallAt(start, zone());
    renderSuggestions();
    renderTimeline();
    app.save();
  }

  byId("timeline").addEventListener("click", (event) => {
    const bar = (event.target as HTMLElement).closest(".tl-track");
    if (!bar) return;
    const box = bar.getBoundingClientRect();
    const [from, to] = dayBounds();
    const t = from + ((event.clientX - box.left) / box.width) * (to - from);
    // Snapped to a quarter hour, the call starting where it was clicked.
    pick(from + Math.max(0, Math.floor((t - from) / (STEP * MINUTE))) * STEP * MINUTE);
  });
  byId("picked-time").addEventListener("change", () => {
    const minutes = parseClock(byId<HTMLInputElement>("picked-time").value);
    if (minutes === undefined) return;
    pick(instantOf(atMinutes(day ?? wallAt(Date.now(), zone()), minutes), zone()));
  });
  byId("picked-copy").addEventListener("click", async () => {
    if (!(await copyText(byId("picked-summary").textContent ?? "", byId("picked-copy"))))
      app.clipboardFailed(byId("picked-text"));
  });
  const moveDay = (by: number) => {
    day = addDays(day ?? wallAt(Date.now(), zone()), by);
    renderTimeline();
    app.save();
  };
  byId("day-prev").addEventListener("click", () => moveDay(-1));
  byId("day-next").addEventListener("click", () => moveDay(1));
  byId("more").addEventListener("click", () => {
    shownCount += PAGE;
    renderSuggestions();
  });

  length.addEventListener("change", () => {
    plan.duration = Number(length.value);
    changed();
  });
  for (const input of [rangeFrom, rangeTo])
    input.addEventListener("change", () => {
      day = undefined;
      research();
    });

  // ---------- Sharing ----------

  byId("share").addEventListener("click", async () => {
    const note = byId("people-note");
    if (!plan.people.length) return showMessage(note, "Add people to share.", true);
    const url = location.href.split("#")[0] + SHARE_PREFIX + (await encodeShare(plan));
    if (await copyText(url, byId("share")))
      showMessage(note, "Link copied: a snapshot of these people and windows.");
    else app.clipboardFailed(note);
  });

  function showSnapshot(): void {
    const box = byId("snapshot");
    box.hidden = !pending;
    if (!pending) return;
    const names = pending.people.map((p) => p.name || "Unnamed").join(", ");
    byId("snapshot-text").textContent =
      `This link holds ${pending.people.length} ${pending.people.length === 1 ? "person" : "people"} (${names}) ` +
      `and a ${formatMinutes(pending.duration)} call: what its sender entered, not live answers.`;
  }
  const take = (replace: boolean) => {
    if (!pending) return;
    plan = replace ? pending : { ...plan, people: [...plan.people, ...pending.people] };
    if (replace) setLength(plan.duration);
    pending = undefined;
    showSnapshot();
    selected = undefined;
    day = undefined;
    renderPeople();
    savePlan();
    research();
  };
  byId("snapshot-replace").addEventListener("click", () => take(true));
  byId("snapshot-add").addEventListener("click", () => take(false));
  byId("snapshot-dismiss").addEventListener("click", () => {
    pending = undefined;
    showSnapshot();
  });
  /** A share link, opened in a new tab or followed from this one. */
  function readShared(): void {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    const value = location.hash.slice(SHARE_PREFIX.length);
    app.show("meet");
    // The link has been read: a reload must not ask again.
    history.replaceState(null, "", location.pathname + location.search);
    void decodeShare(value).then((shared) => {
      if (shared?.people.length) pending = shared;
      else showMessage(byId("people-note"), "That link holds no people that can be read.", true);
      showSnapshot();
    });
  }
  readShared();
  window.addEventListener("hashchange", readShared);

  app.onPrefs(() => {
    renderSuggestions();
    renderTimeline();
  });

  renderPeople();
  research();
  return {
    values: () => ({
      meetZone: zone(),
      rangeFrom: rangeFrom.value,
      rangeTo: rangeTo.value,
      selected,
      day: day ? formatDate(day) : "",
      folded: [...folded],
    }),
    shown(on) {
      visible = on;
      if (visible) renderTimeline();
    },
  };
}
