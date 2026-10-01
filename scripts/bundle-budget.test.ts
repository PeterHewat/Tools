import { expect, test } from "bun:test";
import { checkJsBudget } from "./bundle-budget.ts";
const file = (path: string, content: string) => ({
  path,
  bytes: new TextEncoder().encode(content),
});
const files = [
  file(
    "index.html",
    '<script type="module" src="/Tools/svg/assets/entry.js"></script><link rel="modulepreload" href="/Tools/svg/assets/shared.js">'
  ),
  file("assets/entry.js", "entry"),
  file("assets/shared.js", "shared"),
  file("assets/lazy.js", "lazy"),
];
test("preloads count toward initial cost; lazy chunks still count toward total cost", () => {
  const { entry, total } = checkJsBudget("test", files, { entryGzip: 1, totalGzip: 1 });
  expect(entry).toBe(51);
  expect(total).toBe(75);
  expect(() => checkJsBudget("test", files, { entryGzip: 0.01, totalGzip: 1 })).toThrow(/exceeds/);
  expect(() => checkJsBudget("test", files, { entryGzip: 1, totalGzip: 0.01 })).toThrow(/exceeds/);
});
test("missing HTML or initial assets cannot make a budget pass silently", () => {
  expect(() => checkJsBudget("test", files.slice(1), { entryGzip: 1, totalGzip: 1 })).toThrow(
    /index/
  );
  expect(() => checkJsBudget("test", files.slice(0, 1), { entryGzip: 1, totalGzip: 1 })).toThrow(
    /missing initial/
  );
});
