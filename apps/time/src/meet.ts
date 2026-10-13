/** Find a time: people and their windows, the search, what fits, a day's timeline, share links. */

import { fromBase64, toBase64, utf8, textFromBytes } from "@tools/bytes";
import {
  byId,
  CLOCK_FIELD,
  copyText,
  DATE_FIELD,
  debounce,
  formatClock,
  iconSvg,
  parseClock,
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
import { addDays, atMinutes, dayNumber, DAY, formatDate, MINUTE, parseDate } from "./lib/civil.js";
import type { PlainDate } from "./lib/civil.js";
import { clockTime, formatMinutes, shortDate, utcOffset } from "./lib/format.js";
import {
  DEFAULT_DURATION,
  isNewerPlan,
  newPerson,
  readPlan,
  sharePlan,
  writePlan,
} from "./lib/plan.js";
import type { Plan } from "./lib/plan.js";
import { canonicalZone, instantOf, localZone, offsetAt, wallAt } from "./lib/zone.js";
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

/**
 * First visit: two people in business hours, 09:00 to 17:00 on weekdays, in Paris and New York.
 * They overlap for two hours (15:00 to 17:00 in Paris is 09:00 to 11:00 in New York).
 */
function examplePlan(): Plan {
  return {
    people: [newPerson("Alex", "Europe/Paris"), newPerson("Sam", "America/New_York")],
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

/** The plan in a link; "newer" when a later Time made it, undefined when it cannot be read. */
export async function decodeShare(value: string): Promise<Plan | "newer" | undefined> {
  try {
    let bytes: Uint8Array<ArrayBuffer> = fromBase64(value.slice(1), true);
    if (value[0] === "z") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (value[0] !== "j") return undefined;
    const raw: unknown = JSON.parse(textFromBytes(bytes));
    return isNewerPlan(raw) ? "newer" : readPlan(raw);
  } catch {
    return undefined;
  }
}

export function meetView(app: App): View {
  const saved = app.saved;
  const raw = readStored(PLAN_KEY);
  // People a later Time saved stay as they are: this page neither reads nor replaces them.
  const newer = isNewerPlan(raw);
  const stored = readPlan(raw);
  let plan: Plan = stored ?? examplePlan();
  let pending: Plan | undefined;
  /** People whose card is folded. */
  const folded = new Set<string>(
    Array.isArray(saved.folded)
      ? saved.folded.filter((x): x is string => typeof x === "string")
      : []
  );
  let shownCount = PAGE;
  let suggestions: Suggestion[] = [];
  let selected: number | undefined =
    typeof saved.selected === "number" ? saved.selected : undefined;
  /** Whether the call was placed by the person, rather than on the best suggestion. */
  let placedByHand = saved.placedByHand === true;
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
    if (!newer) writeStored(PLAN_KEY, writePlan(plan));
  }
  if (newer)
    showMessage(
      byId("people-note"),
      "These people were saved by a newer version of Time. Reload the page to see them; changes made here are not kept.",
      true
    );

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
        ...CLOCK_FIELD,
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
        levelSelect(window.level)
      ),
      h(
        "button",
        {
          type: "button",
          class: "ui-btn ui-icon-btn time-window-remove",
          "data-action": "remove-window",
          "aria-label": "Remove window",
          title: "Remove window",
        },
        iconSvg("close")
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
        person.relaxed && h("span", { class: "time-badge" }, "Relaxed"),
        // Room for the remove button, which sits over the row beside the chevron.
        h("span", { class: "time-person-room", "aria-hidden": "true" }),
        h("span", { class: "time-chevron", "aria-hidden": "true" }, iconSvg("chevron-down"))
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
                ...DATE_FIELD,
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
          h("label", { class: "time-switch" }, relaxed, "Allow unavailable time")
        )
      )
    );
    bindZoneField(zoneInput, person.zone, (next) => {
      person.zone = next;
      changed();
      refreshSummary(person);
    });
    if (!valid) zoneInput.setAttribute("aria-invalid", "true");
    // Outside the summary, where a button would be one control inside another, and outside the
    // card's body, so it stays in reach while the card is folded.
    const remove = h(
      "button",
      {
        type: "button",
        class: "ui-btn ui-icon-btn time-person-remove",
        "data-action": "remove-person",
        "aria-label": `Remove ${person.name || "this person"}`,
        title: "Remove person",
      },
      iconSvg("trash")
    );
    return h("div", { class: "time-person-box", "data-person": person.id }, card, remove);
  }

  function refreshSummary(person: Person): void {
    const box = peopleBox.querySelector<HTMLElement>(
      `.time-person-box[data-person="${person.id}"]`
    );
    if (!box) return;
    const fresh = personCard(person);
    box.querySelector("summary")!.replaceChildren(...fresh.querySelector("summary")!.childNodes);
    box
      .querySelector(".time-person-remove")!
      .replaceWith(fresh.querySelector(".time-person-remove")!);
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
        const clock = parseClock(target.value);
        if (window && clock) window[target.dataset.field] = clock.minutes;
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
    const people = usable();
    list.replaceChildren(
      ...suggestions.slice(0, shownCount).map((s) => {
        const end = s.start + plan.duration * MINUTE;
        const startDay = shortDate(s.start, zone());
        const endDay = shortDate(end, zone());
        const when = `${startDay}, ${clockTime(s.start, zone())}–${clockTime(end, zone())}${endDay === startDay ? "" : ` (${endDay})`}`;
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
              `or start any time until ${clockTime(s.last, zone())}`
            ),
          // Everyone's own clock at the start, and their date where it is not the one above.
          h(
            "span",
            { class: "time-suggestion-local" },
            people
              .map((p) => {
                const theirDay = shortDate(s.start, p.zone);
                return (
                  `${p.name || "Unnamed"} ${clockTime(s.start, p.zone)}` +
                  (theirDay === startDay ? "" : ` (${theirDay})`)
                );
              })
              .join(" · ")
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
      problem ??
        (broken.length
          ? `Unknown time zone for ${broken.join(", ")}: choose one to see times for everyone.`
          : ""),
      Boolean(problem || broken.length)
    );
    // Times found without someone would read as times that suit everyone.
    if (!search || !people.length || broken.length) {
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
    // Until someone places the call themselves, it is on the best suggestion.
    if (!placedByHand) {
      selected = suggestions[0]?.start;
      if (selected !== undefined) day = wallAt(selected, zone());
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
    const parts = segments
      .filter((s) => s.level !== "unavailable")
      .map(
        (s) =>
          `${LEVEL_NAMES[s.level].toLowerCase()} ${clockTime(s.start, zoneName)}–${clockTime(s.end, zoneName)}`
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
    byId("picked-summary").textContent = summary(people, selected, plan.duration);
    copy.disabled = false;
  }

  function pick(start: number): void {
    placedByHand = true;
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
    const clock = parseClock(byId<HTMLInputElement>("picked-time").value);
    if (!clock) return;
    pick(instantOf(atMinutes(day ?? wallAt(Date.now(), zone()), clock.minutes), zone()));
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

  // Suggestions fold to their heading: the page's styles hide them while <html> is marked folded,
  // which the head of index.html sets from the draft before the first paint.
  const root = document.documentElement;
  const foldToggle = byId("suggestions-toggle");
  const suggestionsOpen = () => !root.hasAttribute("data-time-folded");
  foldToggle.setAttribute("aria-expanded", String(suggestionsOpen()));
  // The heading's button, or anywhere else on its row.
  byId("suggestions-row").addEventListener("click", () => {
    root.toggleAttribute("data-time-folded", suggestionsOpen());
    foldToggle.setAttribute("aria-expanded", String(suggestionsOpen()));
    app.save();
  });

  length.addEventListener("change", () => {
    plan.duration = Number(length.value);
    changed();
  });
  for (const input of [rangeFrom, rangeTo])
    // Typed dates: searched once the typing pauses.
    input.addEventListener("input", () => {
      day = undefined;
      placedByHand = false;
      researchSoon();
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
    placedByHand = false;
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
      if (shared === "newer")
        showMessage(
          byId("people-note"),
          "That link was made by a newer version of Time. Reload the page, then open the link again.",
          true
        );
      else if (shared?.people.length) pending = shared;
      else showMessage(byId("people-note"), "That link holds no people that can be read.", true);
      showSnapshot();
    });
  }
  readShared();
  window.addEventListener("hashchange", readShared);

  renderPeople();
  research();
  return {
    values: () => ({
      meetZone: zone(),
      rangeFrom: rangeFrom.value,
      rangeTo: rangeTo.value,
      selected,
      placedByHand,
      suggestionsOpen: suggestionsOpen(),
      day: day ? formatDate(day) : "",
      folded: [...folded],
    }),
    shown(on) {
      visible = on;
      if (visible) renderTimeline();
    },
  };
}
