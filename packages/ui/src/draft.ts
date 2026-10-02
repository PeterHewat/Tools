import { isOn, setOn } from "./dom.js";
import { writeStored } from "./storage.js";

const isSwitch = (field: Element) => field.getAttribute("role") === "switch";

const MAX_DRAFT = 2 * 1024 * 1024;
export interface Draft {
  found: boolean;
  value: Record<string, unknown>;
  error?: string;
  /** The last draft was too large to keep: `value` is empty, and the app may say so. */
  dropped?: boolean;
}
/** Beta drafts are versioned and fail closed, rather than silently reinterpreting old state. */
export function readDraft(slug: string, version: number): Draft {
  const incompatible = (): Draft => ({
    found: true,
    value: {},
    error: `Saved ${slug} draft is incompatible. Clear this app's session storage to start again.`,
  });
  let stored: string | null;
  try {
    stored = sessionStorage.getItem(`tools.${slug}.draft`);
  } catch {
    return { found: false, value: {} };
  }
  if (stored === null) return { found: false, value: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return incompatible();
  }
  if (raw && typeof raw === "object" && "dropped" in raw && raw.dropped === true)
    return "version" in raw && raw.version === version
      ? { found: true, value: {}, dropped: true }
      : incompatible();
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== version ||
    !("value" in raw) ||
    !raw.value ||
    typeof raw.value !== "object" ||
    Array.isArray(raw.value)
  )
    return incompatible();
  return { found: true, value: raw.value as Record<string, unknown> };
}
/**
 * Keeps this tab's draft. One over 2 MB is not kept: what is left is a mark that it was
 * dropped, read back as `dropped`, and false is returned.
 */
export function writeDraft(slug: string, version: number, value: Record<string, unknown>): boolean {
  if (new TextEncoder().encode(JSON.stringify({ version, value })).byteLength > MAX_DRAFT) {
    dropDraft(slug, version);
    return false;
  }
  return writeStored(`tools.${slug}.draft`, { version, value }, "session");
}
/** Marks this tab's draft as dropped, too large to keep. */
export function dropDraft(slug: string, version: number): void {
  writeStored(`tools.${slug}.draft`, { version, dropped: true }, "session");
}
/** Only form controls explicitly named by the app become part of a draft. */
export function restoreFields(value: Record<string, unknown>, ids: readonly string[]): void {
  for (const id of ids) {
    const field = document.getElementById(id) as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    const saved = value[id];
    if (!field) continue;
    if (isSwitch(field)) {
      if (typeof saved === "boolean") setOn(field, saved);
    } else if (field instanceof HTMLInputElement && field.type === "checkbox") {
      if (typeof saved === "boolean") field.checked = saved;
    } else if (typeof saved === "string") {
      if (
        !(field instanceof HTMLSelectElement) ||
        [...field.options].some((option) => option.value === saved)
      )
        field.value = saved;
    }
  }
}
export function fieldValues(ids: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    ids.map((id) => {
      const field = document.getElementById(id) as
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      return [
        id,
        isSwitch(field)
          ? isOn(field)
          : field instanceof HTMLInputElement && field.type === "checkbox"
            ? field.checked
            : field.value,
      ];
    })
  );
}
