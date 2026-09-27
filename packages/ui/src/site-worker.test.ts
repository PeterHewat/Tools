import { describe, expect, test } from "bun:test";
import { isPrecached, siteWorker } from "./site-worker.js";

const file = (path: string, text = path) => ({ path, bytes: new TextEncoder().encode(text) });
const precacheOf = (source: string): string[] =>
  JSON.parse(/const PRECACHE = (.*);/.exec(source)![1]!) as string[];
const versionOf = (source: string) => /const VERSION = "(\w+)";/.exec(source)![1];

describe("site worker", () => {
  const files = [
    file("index.html"),
    file("svg/index.html"),
    file("svg/assets/app-1234.js"),
    file("json/index.html"),
    file("manifest.webmanifest"),
    file("404.html"),
    file("sw.js"),
    file("svg/sw.js"),
  ];

  test("precaches every app and the index, in one sorted list", () => {
    expect(precacheOf(siteWorker(files))).toEqual([
      "index.html",
      "json/index.html",
      "manifest.webmanifest",
      "svg/assets/app-1234.js",
      "svg/index.html",
    ]);
  });

  test("leaves out itself, the apps' retired workers and the not-found page", () => {
    for (const p of ["sw.js", "svg/sw.js", "404.html"]) expect(isPrecached(p)).toBe(false);
    expect(isPrecached("svg/sws.js")).toBe(true);
  });

  test("a change to any file in any app is a new version; order is not", () => {
    const v = versionOf(siteWorker(files));
    expect(versionOf(siteWorker([...files].reverse()))).toBe(v);
    const changed = files.map((f) => (f.path === "json/index.html" ? file(f.path, "new") : f));
    expect(versionOf(siteWorker(changed))).not.toBe(v);
  });

  test("a change to what is left out is not", () => {
    const v = versionOf(siteWorker(files));
    const changed = files.map((f) => (f.path === "404.html" ? file(f.path, "new") : f));
    expect(versionOf(siteWorker(changed))).toBe(v);
  });
});
