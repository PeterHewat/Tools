import { afterEach, describe, expect, test } from "bun:test";
import {
  createInitialState,
  getState,
  getDocumentRevision,
  mutateDocument,
  replaceState,
  selectOnly,
  setState,
  snapshotDocument,
  subscribeDocument,
} from "./state.js";
import { createRect } from "./model.js";
import { clearHistory, pushUndo, redo, undo } from "./undo.js";

afterEach(() => {
  clearHistory();
  replaceState(createInitialState());
});

describe("document history", () => {
  test("undo and redo restore drawing data while preserving the current viewport and tool", () => {
    const rect = createRect(0, 0, 40, 40);
    replaceState({ ...createInitialState(), elements: [rect], selection: selectOnly([rect.id]) });
    pushUndo();
    mutateDocument((doc) => {
      (doc.elements[0] as typeof rect).x = 100;
    });
    const viewport = { panX: 200, panY: 300, zoom: 2 };
    setState({ viewport, tool: "ellipse", finalOnly: true });
    expect(undo()).toBe(true);
    expect((getState().elements[0] as typeof rect).x).toBe(0);
    expect(getState().viewport).toBe(viewport);
    expect(getState().tool).toBe("ellipse");
    expect(getState().finalOnly).toBe(true);
    expect(redo()).toBe(true);
    expect((getState().elements[0] as typeof rect).x).toBe(100);
    expect(getState().viewport).toBe(viewport);
    expect(snapshotDocument()).not.toHaveProperty("viewport");
    expect(snapshotDocument()).not.toHaveProperty("drawing");
  });

  test("dirty revisions follow actual document changes, not history reservation or selection", () => {
    replaceState(createInitialState());
    const before = getDocumentRevision();
    let notices = 0;
    const unsubscribe = subscribeDocument(() => notices++);
    pushUndo();
    setState({ selection: selectOnly(), viewport: { panX: 0, panY: 0, zoom: 2 }, tool: "pen" });
    expect(getDocumentRevision()).toBe(before);
    expect(notices).toBe(0);
    setState({ background: { color: "#ffffff", opacity: 1 } });
    expect(getDocumentRevision()).toBe(before + 1);
    expect(notices).toBe(1);
    expect(undo()).toBe(true);
    expect(getDocumentRevision()).toBe(before + 2);
    expect(notices).toBe(2);
    unsubscribe();
  });
});
