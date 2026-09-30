import { afterEach, describe, expect, test } from "bun:test";
import { readStored, writeStored } from "./storage.js";

const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

afterEach(() => {
  delete g.localStorage;
  delete g.sessionStorage;
});

describe("stored values", () => {
  test("come back as they went in, in either area", () => {
    g.localStorage = memory();
    g.sessionStorage = memory();
    expect(writeStored("k", { a: [1, "two"] })).toBe(true);
    expect(readStored("k")).toEqual({ a: [1, "two"] });
    writeStored("k", "tab only", "session");
    expect(readStored("k", "session")).toBe("tab only");
    writeStored("k", undefined);
    expect(readStored("k")).toBeUndefined();
  });

  test("are undefined when absent or unreadable", () => {
    g.localStorage = memory();
    expect(readStored("none")).toBeUndefined();
    g.localStorage.setItem("bad", "{not json");
    expect(readStored("bad")).toBeUndefined();
  });

  test("never throw where storage is refused", () => {
    const refusing = memory();
    refusing.getItem = () => {
      throw new Error("blocked");
    };
    refusing.setItem = () => {
      throw new Error("quota");
    };
    g.localStorage = refusing;
    expect(readStored("k")).toBeUndefined();
    expect(writeStored("k", 1)).toBe(false);
  });
});
