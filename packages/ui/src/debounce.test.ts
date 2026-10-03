import { expect, test } from "bun:test";
import { debounce } from "./debounce.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("runs once, after the calls pause", async () => {
  let runs = 0;
  const later = debounce(() => runs++, 20);
  later();
  later();
  later();
  expect([runs, later.pending]).toEqual([0, true]);
  await pause(40);
  expect([runs, later.pending]).toEqual([1, false]);
});

test("flush runs what is waiting now, and nothing when nothing waits; cancel drops it", async () => {
  let runs = 0;
  const later = debounce(() => runs++, 20);
  later.flush();
  expect(runs).toBe(0);
  later();
  later.flush();
  expect([runs, later.pending]).toEqual([1, false]);
  later();
  later.cancel();
  await pause(40);
  expect(runs).toBe(1);
});
