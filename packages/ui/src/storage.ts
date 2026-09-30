/**
 * Web storage that never throws. Private windows, blocked site data and a full quota all make
 * `localStorage` and `sessionStorage` throw; everything the apps keep there is a convenience, so
 * a refusal means "not remembered", never a failure.
 */

export type StorageArea = "local" | "session";

const area = (where: StorageArea): Storage => (where === "local" ? localStorage : sessionStorage);

/** The value stored under `key`, as JSON; undefined when there is none or it cannot be read. */
export function readStored(key: string, where: StorageArea = "local"): unknown {
  try {
    const raw = area(where).getItem(key);
    return raw == null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Stores `value` under `key` as JSON; undefined removes it. False when storage refused it. */
export function writeStored(key: string, value: unknown, where: StorageArea = "local"): boolean {
  try {
    if (value === undefined) area(where).removeItem(key);
    else area(where).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
