import { readStored, writeStored } from "@tools/ui";
import type { ExportKind } from "./exports.js";

export type ViewMode = "json" | ExportKind;
export type PathStyle = "js" | "pointer";
export type Indent = "2" | "4" | "tab";
export interface Prefs {
  indent: Indent;
  sortKeys: boolean;
  view: ViewMode;
  pathStyle: PathStyle;
  colours: boolean;
}

const PREFS_KEY = "tools.json.prefs";
const DRAFT_KEY = "tools.json.draft";
const EXACT_KEY = "tools.json.exact";
const MAX_SAVED = 2_000_000;
const VIEWS: readonly ViewMode[] = ["json", "yaml", "csv", "ts", "schema"];

/** Each released setting is read independently, retaining older and partial preferences. */
export function parsePrefs(value: unknown): Prefs {
  const raw = value && typeof value === "object" ? (value as Partial<Prefs>) : {};
  return {
    indent: raw.indent === "4" || raw.indent === "tab" ? raw.indent : "2",
    sortKeys: raw.sortKeys === true,
    view: raw.view && VIEWS.includes(raw.view) ? raw.view : "json",
    pathStyle: raw.pathStyle === "pointer" ? "pointer" : "js",
    colours: raw.colours !== false,
  };
}

export const readPrefs = () => parsePrefs(readStored(PREFS_KEY));
export const writePrefs = (prefs: Prefs) => writeStored(PREFS_KEY, prefs);
export const readDraft = () => readStored(DRAFT_KEY, "session");
export const writeDraft = (text: string, dropped: boolean) =>
  writeStored(DRAFT_KEY, text.length > MAX_SAVED || dropped ? false : text, "session");
export function readExactChoices(): string[] {
  const raw = readStored(EXACT_KEY, "session");
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}
export const writeExactChoices = (places: ReadonlySet<string>) =>
  writeStored(EXACT_KEY, [...places], "session");
