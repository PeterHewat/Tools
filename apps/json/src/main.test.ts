import { afterAll, expect, test } from "bun:test";

const originalBody = document.body.innerHTML;
const previousDraft = sessionStorage.getItem("tools.json.draft");
const previousExact = sessionStorage.getItem("tools.json.exact");
const previousPrefs = localStorage.getItem("tools.json.prefs");
const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")!;
const writes: string[] = [];

// happy-dom binds storage methods; wrap the global stores to observe actual writes.
function observe(storage: Storage): Storage {
  return {
    get length() {
      return storage.length;
    },
    clear: () => storage.clear(),
    key: (index) => storage.key(index),
    getItem: (key) => storage.getItem(key),
    removeItem: (key) => storage.removeItem(key),
    setItem(key, value) {
      writes.push(key);
      storage.setItem(key, value);
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: observe(localStorage),
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: observe(sessionStorage),
});
const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const page = new DOMParser().parseFromString(html, "text/html");
for (const script of page.querySelectorAll("script")) script.remove();
document.body.innerHTML = page.body.innerHTML;
sessionStorage.setItem(
  "tools.json.draft",
  JSON.stringify('{"rows":[{"name":"one"},{"name":"two"}],"other":[2]}')
);
sessionStorage.removeItem("tools.json.exact");
localStorage.removeItem("tools.json.prefs");
await import("./main.js");
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();

afterAll(() => {
  Object.defineProperty(globalThis, "localStorage", localDescriptor);
  Object.defineProperty(globalThis, "sessionStorage", sessionDescriptor);
  document.body.innerHTML = originalBody;
  for (const [storage, key, value] of [
    [sessionStorage, "tools.json.draft", previousDraft],
    [sessionStorage, "tools.json.exact", previousExact],
    [localStorage, "tools.json.prefs", previousPrefs],
  ] as const) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
});

test("views and settings save preferences without rewriting the draft", () => {
  writes.length = 0;
  const draft = sessionStorage.getItem("tools.json.draft");
  click('[data-view="yaml"]');
  click("#colours");
  click('[data-path-style="pointer"]');
  click('[data-indent="4"]');
  expect(writes).toContain("tools.json.prefs");
  expect(writes).not.toContain("tools.json.draft");
  expect(sessionStorage.getItem("tools.json.draft")).toBe(draft);
  click('[data-view="ts"]');
  click("#exact-list [data-place]");
  expect(writes).toContain("tools.json.exact");
  expect(writes).not.toContain("tools.json.draft");
});

test("clearing a document drops previous CSV tables and saves the empty draft", () => {
  click('[data-view="csv"]');
  expect(document.querySelector("#download")!.getAttribute("title")).toContain("CSV of");
  click('[data-view="json"]');
  click("#clear");
  click('[data-view="csv"]');
  expect(sessionStorage.getItem("tools.json.draft")).toBe(JSON.stringify(""));
  expect(document.querySelector<HTMLButtonElement>("#download")!.disabled).toBe(true);
  expect(document.querySelector("#download")!.getAttribute("title")).toBe("Export CSV");
  expect(document.querySelector("#export-message")!.textContent).toBe("Nothing to convert yet.");
});
