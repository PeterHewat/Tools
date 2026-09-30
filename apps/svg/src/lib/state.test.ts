import { describe, expect, it } from "bun:test";
import {
  createInitialState,
  replaceDocument,
  replaceState,
  selectOnly,
  snapshotDocument,
  getState,
} from "./state.js";
import { createDocument } from "./project-file.js";
import { createRect, DEFAULT_STROKE } from "./model.js";
import type { ReferenceImage } from "./types.js";

it("opening a document keeps tab controls but clears its previous editing UI", () => {
  const rect = createRect(0, 0, 10, 10);
  replaceState({
    ...createInitialState(),
    elements: [rect],
    selection: selectOnly([rect.id]),
    selectMore: true,
    alignSnap: true,
    tool: "pen",
    finalOnly: true,
    drawing: { activePathId: rect.id },
  });
  replaceDocument(createDocument());
  expect(getState().tool).toBe("pen");
  expect(getState().finalOnly).toBe(true);
  expect(getState().alignSnap).toBe(true);
  expect(getState().selectMore).toBe(false);
  expect(getState().selection.elementIds).toEqual([]);
  expect(getState().drawing).toBeNull();
  expect(getState().elements).toEqual([]);
  replaceState(createInitialState());
});

function image(dataUrl: string): ReferenceImage {
  return {
    id: "img-1",
    name: "ref.png",
    fileName: "ref.png",
    dataUrl,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 0.5,
    visible: true,
  };
}

describe("snapshotDocument", () => {
  it("shares the image data URL rather than copying it", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(1024)}`;
    replaceState({ ...createInitialState(), images: [image(dataUrl)] });

    const snap = snapshotDocument();

    // Same string object, so a hundred undo steps cost one copy of the pixels, not a hundred.
    expect(snap.images[0]!.dataUrl).toBe(dataUrl);
  });

  it("still copies the image transform, so undo can restore it", () => {
    replaceState({ ...createInitialState(), images: [image("data:,")] });
    const snap = snapshotDocument();

    getState().images[0]!.x = 250;

    expect(snap.images[0]!.x).toBe(0);
    expect(snap.images[0]!.opacity).toBe(0.5);
  });

  it("deep-copies elements, so a later mutation cannot reach into the snapshot", () => {
    replaceState({
      ...createInitialState(),
      elements: [
        {
          type: "polyline",
          id: "a1b2c3d4",
          name: "polyline 1",
          points: [{ x: 1, y: 2 }],
          ...DEFAULT_STROKE,
        },
      ],
    });

    const snap = snapshotDocument();
    const live = getState().elements[0]!;
    if ("points" in live) live.points[0]!.x = 99;

    const snapped = snap.elements[0]!;
    expect("points" in snapped && snapped.points[0]!.x).toBe(1);
  });
});
