import { afterEach, expect, test } from "bun:test";
import { readDraft, writeDraft } from "./draft.js";

const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
afterEach(() => {
  if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});
function storage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}
test("versioned session drafts preserve empty fields and fail closed on unknown or corrupt state", () => {
  const values = storage();
  expect(readDraft("codec", 1).found).toBe(false);
  expect(writeDraft("codec", 1, { left: "", checked: false })).toBe(true);
  expect(readDraft("codec", 1).value).toEqual({ left: "", checked: false });
  expect(readDraft("codec", 2).error).toContain("Clear");
  values.set("tools.codec.draft", "{broken");
  expect(readDraft("codec", 1).error).toContain("Clear");
  expect(readDraft("codec", 1).value).toEqual({});
});
test("oversized drafts remove stale state and refused storage does not throw", () => {
  const values = storage();
  writeDraft("jwt", 1, { token: "old" });
  expect(writeDraft("jwt", 1, { token: "x".repeat(2 * 1024 * 1024) })).toBe(false);
  expect(values.has("tools.jwt.draft")).toBe(false);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new Error("blocked");
    },
  });
  expect(readDraft("jwt", 1).found).toBe(false);
  expect(writeDraft("jwt", 1, {})).toBe(false);
});
