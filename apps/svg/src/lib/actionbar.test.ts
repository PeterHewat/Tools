import { describe, expect, test } from "bun:test";
import { columnsFor, initActionBar, syncActionBar } from "./actionbar.js";
import { createPolygon } from "./model.js";
import { createInitialState, getState, replaceState, selectOnly, setState } from "./state.js";
import { clearHistory } from "./undo.js";
import { initViewport } from "./viewport.js";

describe("the bar's rows", () => {
  test("up to seven buttons stay on one row", () => {
    expect(columnsFor(1)).toBe(1);
    expect(columnsFor(7)).toBe(7);
  });

  test("a longer set splits into rows as even as can be", () => {
    expect(columnsFor(8)).toBe(4);
    expect(columnsFor(9)).toBe(5);
    expect(columnsFor(14)).toBe(7);
    expect(columnsFor(15)).toBe(5);
  });

  test("a pair stays in one row", () => {
    // Eight as four and four would end the first row between buttons 3 and 4.
    expect(columnsFor(8, 7, [3])).toBe(5);
    expect(columnsFor(8, 7, [2])).toBe(4);
    // Nothing fits in two rows without a split, so a third row it is.
    expect(columnsFor(6, 3, [2])).toBe(2);
  });
});

describe("current selection actions", () => {
  test("an unchanged button acts on the newly selected shape and refreshes its label", () => {
    const first = createPolygon([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ]);
    const second = createPolygon([
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 60, y: 40 },
    ]);
    replaceState({
      ...createInitialState(),
      elements: [first, second],
      selection: selectOnly([first.id]),
    });
    clearHistory();
    const bar = document.createElement("div");
    initViewport(
      {
        createSVGPoint: () => ({ x: 0, y: 0 }),
        getScreenCTM: () => null,
      } as unknown as SVGSVGElement,
      document.createElementNS("http://www.w3.org/2000/svg", "g")
    );
    initActionBar(bar);
    syncActionBar(getState());
    const button = bar.querySelector<HTMLButtonElement>('[aria-label="Open the path"]')!;
    expect(button).not.toBeNull();
    setState({ selection: selectOnly([second.id]) });
    syncActionBar(getState());
    expect(bar.querySelector('[aria-label="Open the path"]')).toBe(button);
    button.click();
    expect(getState().elements[0]!.type).toBe("polygon");
    expect(getState().elements[1]!.type).toBe("polyline");
    expect(getState().selection.elementIds).toEqual([second.id]);
    syncActionBar(getState());
    expect(bar.querySelector('[aria-label="Close the path"]')).toBe(button);
    button.click();
    expect(getState().elements[1]!.type).toBe("polygon");
    clearHistory();
    replaceState(createInitialState());
  });
});
