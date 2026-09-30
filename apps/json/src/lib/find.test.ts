import { afterAll, expect, test } from "bun:test";
import type { Mark } from "@tools/editor";
import { bindFind } from "./find.js";

const originalBody = document.body.innerHTML;
document.body.innerHTML = `
  <button id="find-open"></button><div id="findbar" class="hidden">
  <input id="find-input"><span id="find-count"></span>
  <button id="find-case" aria-pressed="false"></button>
  <button id="find-prev"></button><button id="find-next"></button><button id="find-close"></button></div>`;
afterAll(() => {
  document.body.innerHTML = originalBody;
});

function editor() {
  return {
    selection: { from: 0, to: 0, head: 0 },
    marks: [] as readonly Mark[],
    select(from: number, to: number): void {
      this.selection = { from, to, head: to };
    },
    setMarks(marks: readonly Mark[]): void {
      this.marks = marks;
    },
    focus(): void {},
  };
}

test("find follows the current view, clears old marks and cancels pending steps when closed", async () => {
  const source = editor();
  const converted = editor();
  let current = { editor: source, text: "apple APPLE", mode: "json" };
  const find = bindFind([source, converted], () => current);
  const input = document.getElementById("find-input") as HTMLInputElement;
  const count = document.getElementById("find-count")!;
  const click = (id: string) => document.getElementById(id)!.click();
  click("find-open");
  input.value = "apple";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(count.textContent).toBe("1 of 2");
  expect(source.marks).toHaveLength(2);
  click("find-case");
  expect(count.textContent).toBe("1 of 1");

  current = { editor: converted, text: "apple banana", mode: "yaml" };
  find.changed();
  find.refresh();
  find.viewChanged();
  expect(count.textContent).toBe("1 matches");
  expect(source.marks).toHaveLength(0);
  expect(converted.marks).toEqual([{ start: 0, end: 5, current: false }]);
  click("find-next");
  expect(converted.selection.to).toBe(5);
  expect(count.textContent).toBe("1 of 1");

  input.value = "banana";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  click("find-close");
  await Bun.sleep(150);
  expect(source.marks).toHaveLength(0);
  expect(converted.marks).toHaveLength(0);
  expect(converted.selection.to).toBe(5);
});
