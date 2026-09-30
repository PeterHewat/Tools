import { afterAll, expect, test } from "bun:test";
import { createRect } from "./model.js";
import {
  createInitialState,
  getDocumentRevision,
  getState,
  replaceState,
  selectOnly,
} from "./state.js";
import { clearHistory, undo } from "./undo.js";

const originalBody = document.body.innerHTML;
const html = await Bun.file(new URL("../../index.html", import.meta.url)).text();
const page = new DOMParser().parseFromString(html, "text/html");
for (const script of page.querySelectorAll("script")) script.remove();
document.body.innerHTML = page.body.innerHTML;
const { primitiveList } = await import("./primitives-panel.js");

afterAll(() => {
  replaceState(createInitialState());
  document.body.innerHTML = originalBody;
});

test("selection updates retain shape and group rows, fields and focus", () => {
  const first = createRect(0, 0, 40, 40, { groups: ["group-example"] });
  const second = createRect(60, 0, 40, 40, { groups: ["group-example"] });
  const state = { ...createInitialState(), elements: [first, second] };
  replaceState(state);
  primitiveList.sync(state);
  const list = document.getElementById("primitive-list")!;
  const row = list.querySelector<HTMLElement>(`[data-element-id="${first.id}"]`)!;
  const name = row.querySelector<HTMLInputElement>('[data-field="name"]')!;
  const group = list.querySelector<HTMLElement>('[data-group-id="group-example"]')!;
  name.focus();
  name.value = "Name being typed";
  const selected = { ...state, selection: selectOnly([first.id, second.id]) };
  primitiveList.sync(selected);
  expect(list.querySelector(`[data-element-id="${first.id}"]`)).toBe(row);
  expect(list.querySelector('[data-group-id="group-example"]')).toBe(group);
  expect(document.activeElement).toBe(name);
  expect(name.value).toBe("Name being typed");
  expect(row.querySelector('[data-action="toggle-dot"]')!.getAttribute("aria-checked")).toBe(
    "true"
  );
  expect(group.querySelector('[data-action="toggle-dot"]')!.getAttribute("aria-checked")).toBe(
    "true"
  );
  primitiveList.sync({ ...state, selection: selectOnly([second.id]) });
  expect(row.querySelector('[data-action="toggle-dot"]')!.getAttribute("aria-checked")).toBe(
    "false"
  );
  expect(group.querySelector('[data-action="toggle-dot"]')!.getAttribute("aria-checked")).toBe(
    "false"
  );
});

test("field typing dirties every document edit but spends only one undo step", () => {
  clearHistory();
  const rect = createRect(0, 0, 40, 40, { groups: ["group-fields"] });
  const state = {
    ...createInitialState(),
    elements: [rect, createRect(60, 0, 40, 40, { groups: ["group-fields"] })],
  };
  replaceState(state);
  primitiveList.sync(state);
  const name = document.querySelector<HTMLInputElement>(
    `[data-element-id="${rect.id}"] [data-field="name"]`
  )!;
  const originalName = rect.name;
  const revision = getDocumentRevision();
  name.focus();
  for (const value of ["First", "Second"]) {
    name.value = value;
    name.dispatchEvent(new Event("input", { bubbles: true }));
  }
  expect(getState().elements[0]!.name).toBe("Second");
  expect(getDocumentRevision()).toBe(revision + 2);
  expect(undo()).toBe(true);
  expect(getState().elements[0]!.name).toBe(originalName);
  expect(undo()).toBe(false);

  const groupName = document.querySelector<HTMLInputElement>(
    '[data-group-id="group-fields"] [data-group-name]'
  )!;
  groupName.focus();
  for (const value of ["Group", "Group renamed"]) {
    groupName.value = value;
    groupName.dispatchEvent(new Event("input", { bubbles: true }));
  }
  expect(getState().groupNames["group-fields"]).toBe("Group renamed");
  expect(undo()).toBe(true);
  expect(getState().groupNames["group-fields"]).toBeUndefined();
  expect(undo()).toBe(false);
});
