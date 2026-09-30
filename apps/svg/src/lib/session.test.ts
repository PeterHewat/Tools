import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addTurn,
  forgetTurns,
  setAlignSnap,
  setGridSnap,
  setSelectMore,
  turnedBy,
} from "./session.js";
import {
  createInitialState,
  getDocumentRevision,
  getState,
  replaceState,
  selectOnly,
  setState,
} from "./state.js";
import { createRect } from "./model.js";
import { clearHistory, pushUndo, undo } from "./undo.js";

afterEach(() => {
  clearHistory();
  replaceState(createInitialState());
});

test("session switches survive document undo and end when the selection is cleared", () => {
  const rect = createRect(0, 0, 10, 10);
  replaceState({ ...createInitialState(), elements: [rect], selection: selectOnly([rect.id]) });
  pushUndo();
  setState({ background: { color: "#ffffff", opacity: 1 } });
  const revision = getDocumentRevision();
  setSelectMore(true);
  setAlignSnap(true);
  expect(getDocumentRevision()).toBe(revision);
  expect(undo()).toBe(true);
  expect(getState().selectMore).toBe(true);
  expect(getState().alignSnap).toBe(true);
  setState({ selection: selectOnly() });
  expect(getState().selectMore).toBe(false);
});

test("grid and shape snapping are mutually exclusive, including restored document state", () => {
  replaceState(createInitialState());
  setGridSnap(true);
  setAlignSnap(true);
  expect(getState().grid.snap).toBe(false);
  expect(getState().alignSnap).toBe(true);
  setGridSnap(true);
  expect(getState().alignSnap).toBe(false);
  replaceState({
    ...createInitialState(),
    alignSnap: true,
    grid: { step: 16, visible: true, snap: true },
  });
  expect(getState().alignSnap).toBe(false);
});

describe("turn tally", () => {
  beforeEach(forgetTurns);

  test("adds up the turns of one set, whatever order its ids come in", () => {
    addTurn(["a", "b"], 5);
    addTurn(["b", "a"], 15);
    expect(turnedBy(["a", "b"])).toBe(20);
  });

  test("another set starts from 0, and the first is forgotten", () => {
    addTurn(["a"], 30);
    expect(turnedBy(["b"])).toBe(0);
    addTurn(["b"], 10);
    expect(turnedBy(["b"])).toBe(10);
    expect(turnedBy(["a"])).toBe(0);
  });

  test("forgetting puts every set back to 0", () => {
    addTurn(["a"], 30);
    forgetTurns();
    expect(turnedBy(["a"])).toBe(0);
  });
});
