/**
 * The people and patterns Find a time keeps, as stored in the browser and carried in a share
 * link. This is a saved format: it is read field by field, keeping what is valid and giving a
 * default for anything missing or unknown, so what someone saved still opens after a change.
 * `version` is for a later change that cannot be read that way. A plan with a higher version than
 * this page knows was written by a later Time: it is not read, and the page says so.
 */

import { parseDate } from "./civil.js";
import { LEVELS } from "./availability.js";
import type { DateException, Level, Person, TimeWindow, WeeklyWindow } from "./availability.js";

export const PLAN_VERSION = 1;

export interface Plan {
  people: Person[];
  /** Call length in minutes. */
  duration: number;
}

export const DEFAULT_DURATION = 60;
const MAX_PEOPLE = 20;
const MAX_WINDOWS = 30;
const MAX_NAME = 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMinute = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

let counter = 0;
/** A person's id, unique within a plan: only the page uses it, to keep track of who is who. */
export function newId(): string {
  return `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function readWindow(raw: unknown): TimeWindow | undefined {
  if (!isRecord(raw) || !isMinute(raw.start, 1439) || !isMinute(raw.end, 1439)) return undefined;
  const level = LEVELS.includes(raw.level as Level) ? (raw.level as Level) : "acceptable";
  return { start: raw.start, end: raw.end, level };
}

function readWeekly(raw: unknown): WeeklyWindow | undefined {
  const window = readWindow(raw);
  if (!window || !isRecord(raw) || !Array.isArray(raw.days)) return undefined;
  const days = [...new Set(raw.days.filter((d): d is number => isMinute(d, 7) && d >= 1))].sort();
  return days.length ? { ...window, days } : undefined;
}

function readException(raw: unknown): DateException | undefined {
  if (!isRecord(raw) || typeof raw.date !== "string" || !parseDate(raw.date)) return undefined;
  const windows = Array.isArray(raw.windows)
    ? raw.windows.map(readWindow).filter((w) => w !== undefined)
    : [];
  return { date: raw.date, windows: windows.slice(0, MAX_WINDOWS) };
}

function readPerson(raw: unknown, ids: Set<string>): Person | undefined {
  if (!isRecord(raw) || typeof raw.zone !== "string" || !raw.zone) return undefined;
  let id = typeof raw.id === "string" && raw.id && !ids.has(raw.id) ? raw.id : newId();
  while (ids.has(id)) id = newId();
  ids.add(id);
  const list = <T>(value: unknown, read: (item: unknown) => T | undefined): T[] =>
    Array.isArray(value)
      ? value
          .map(read)
          .filter((x): x is T => x !== undefined)
          .slice(0, MAX_WINDOWS)
      : [];
  const exceptions = list(raw.exceptions, readException);
  return {
    id,
    name: typeof raw.name === "string" ? raw.name.slice(0, MAX_NAME) : "",
    zone: raw.zone,
    windows: list(raw.windows, readWeekly),
    // One exception a date: the first one kept.
    exceptions: exceptions.filter((x, i) => exceptions.findIndex((y) => y.date === x.date) === i),
    relaxed: raw.relaxed === true,
  };
}

/** Whether a later Time wrote this, in a form this one does not know. */
export function isNewerPlan(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.version === "number" && raw.version > PLAN_VERSION;
}

/** A plan from whatever was stored or shared; undefined when it is not one this page can read. */
export function readPlan(raw: unknown): Plan | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.people) || isNewerPlan(raw)) return undefined;
  const ids = new Set<string>();
  const people = raw.people
    .slice(0, MAX_PEOPLE)
    .map((p) => readPerson(p, ids))
    .filter((p) => p !== undefined);
  const duration =
    Number.isInteger(raw.duration) &&
    (raw.duration as number) >= 5 &&
    (raw.duration as number) <= 24 * 60
      ? (raw.duration as number)
      : DEFAULT_DURATION;
  return { people, duration };
}

/** The plan as stored and shared. */
export function writePlan(plan: Plan): Record<string, unknown> {
  return { version: PLAN_VERSION, people: plan.people, duration: plan.duration };
}

/** The share link's form: no ids, which belong to the page that made them. */
export function sharePlan(plan: Plan): Record<string, unknown> {
  return {
    version: PLAN_VERSION,
    people: plan.people.map(({ id: _, ...person }) => person),
    duration: plan.duration,
  };
}

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [6, 7];

/** A new person: acceptable from 08:00 to 22:00 every day, preferred on weekday evenings. */
export function newPerson(name: string, zone: string): Person {
  return {
    id: newId(),
    name,
    zone,
    windows: [
      { days: ALL_DAYS, start: 8 * 60, end: 22 * 60, level: "acceptable" },
      { days: WEEKDAYS, start: 18 * 60, end: 21 * 60, level: "preferred" },
      { days: WEEKEND, start: 10 * 60, end: 18 * 60, level: "preferred" },
    ],
    exceptions: [],
    relaxed: false,
  };
}
