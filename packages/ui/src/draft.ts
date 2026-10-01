import { writeStored } from "./storage.js";

const MAX_DRAFT = 2 * 1024 * 1024;
export interface Draft {
  found: boolean;
  value: Record<string, unknown>;
  error?: string;
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
export function writeDraft(slug: string, version: number, value: Record<string, unknown>): boolean {
  if (JSON.stringify(value).length > MAX_DRAFT) {
    writeStored(`tools.${slug}.draft`, undefined, "session");
    return false;
  }
  return writeStored(`tools.${slug}.draft`, { version, value }, "session");
}
/** Only form controls explicitly named by the app become part of a draft. */
export function restoreFields(value: Record<string, unknown>, ids: readonly string[]): void {
  for (const id of ids) {
    const field = document.getElementById(id) as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    const saved = value[id];
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
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
        field instanceof HTMLInputElement && field.type === "checkbox"
          ? field.checked
          : field.value,
      ];
    })
  );
}
