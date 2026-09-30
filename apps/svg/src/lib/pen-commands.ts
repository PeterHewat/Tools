import {
  getState,
  setState,
  mutateDocument,
  findElement,
  replaceElements,
  selectOnly,
} from "./state.js";
import { simplifyPathIfStraight } from "./model.js";
import { pushUndo } from "./undo.js";
import { type EditorState, type PathElement, type Point } from "./types.js";

export function setTool(tool: EditorState["tool"]): void {
  setState({ tool, selection: selectOnly(), drawing: null, dropTarget: null });
}

/** The path the pen is drawing, if any. */
function activePath(): PathElement | undefined {
  const el = findElement(getState().drawing?.activePathId);
  return el?.type === "path" ? el : undefined;
}

/** Throws the path being drawn away and stops drawing, as part of whatever step is under way. */
function dropActivePath(id: string): void {
  setState((s) => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== id),
    drawing: null,
    dropTarget: null,
  }));
}

/** Finishes the path being drawn, as one step of undo. */
export function finishPath(): void {
  if (!getState().drawing?.activePathId) return;
  pushUndo();
  endPath();
}

/** Finishes the path being drawn, as part of whatever step is under way. */
export function endPath(): void {
  const d = getState().drawing;
  const activeId = d?.activePathId;
  if (!d || !activeId) return;
  const path = activePath();
  if (!path || path.points.length < 2) {
    dropActivePath(activeId);
    return;
  }
  replaceElements([simplifyPathIfStraight(path)], {
    drawing: { ...d, activePathId: null, preview: null },
    dropTarget: null,
  });
}

/** Closes the path being drawn and finishes it: a click on its first point, or the button. */
export function closeAndFinishPath(): void {
  const path = activePath();
  if (!path || path.points.length < 2) return;
  pushUndo();
  mutateDocument(() => {
    path.closed = true;
  });
  endPath();
}

/** Throws away the path being drawn, the button form of Esc. */
export function discardPath(): void {
  const activeId = getState().drawing?.activePathId;
  if (!activeId) return;
  pushUndo();
  dropActivePath(activeId);
}

/** Takes back the last point placed by the pen, so a misplaced tap is one button to undo. */
export function removeLastPenPoint(): void {
  const path = activePath();
  if (!path?.points.length) return;
  pushUndo();
  if (path.points.length === 1) {
    dropActivePath(path.id);
    return;
  }
  mutateDocument(() => {
    path.points.pop();
  });
  setState((s) => ({ ...s, drawing: { ...s.drawing, activePathId: path.id, preview: null } }));
}

export function updatePenPreview(path: PathElement, world: Point): void {
  const last = path.points[path.points.length - 1];
  if (!last) return;
  setState((s) => ({
    ...s,
    drawing: {
      ...s.drawing,
      preview: {
        type: "rubber",
        x1: last.x,
        y1: last.y,
        x2: world.x,
        y2: world.y,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
      },
    },
  }));
}
