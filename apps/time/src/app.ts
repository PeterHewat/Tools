/** What every view is given by main.ts: the settings, the tab's draft, and a way to report. */

import type { Prefs } from "./prefs.js";

export interface App {
  readonly prefs: Prefs;
  /** This view's part of the tab's draft, as last saved. */
  readonly saved: Record<string, unknown>;
  /** Keeps the tab's draft, once edits pause. */
  save(): void;
  /** Keeps the settings for the whole app. */
  savePrefs(): void;
  /** The clipboard refused: say so where it was asked. */
  clipboardFailed(where: HTMLElement): void;
  /** Opens a view, as its header button does. */
  show(view: "convert" | "meet" | "duration"): void;
  /** Called when the clock setting changes, to draw times again. */
  onPrefs(listener: () => void): void;
}

/** A view: its draft fields, and what to do as it is shown and hidden. */
export interface View {
  values(): Record<string, unknown>;
  shown(visible: boolean): void;
}

export const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
