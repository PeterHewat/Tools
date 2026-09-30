/**
 * The bar that follows the selection.
 *
 * Almost everything you do to a shape once it exists - delete it, duplicate it, move it in
 * z-order, close a path, group it - was reachable only from a keyboard shortcut or from a row
 * inside the Document panel, which on a phone covers the artboard. This puts those actions next
 * to the shape itself, on every pointer: a mouse has the shortcuts, but having to know them is
 * not the same as having them to hand.
 *
 * While the pen still has a path open it shows what that state needs instead - finish, close,
 * take back the last point, throw it away - because finishing a path on touch is otherwise an
 * undiscoverable double-tap, and every other tool shows its actions the moment the shape exists.
 *
 * On a touch screen it also stays up with nothing selected, docked above the tool bar, for the
 * two things a keyboard would otherwise do there: select everything, and paste.
 */

import { findElement, selectedElements } from "./state.js";
import {
  canJoin,
  canSplitAt,
  canToggleClosed,
  hasHandle,
  hasTwoHandles,
  isClosedShape,
  localBBox,
  toWorldPoint,
} from "./model.js";
import { canGroup, canMergeGroups, canMoveSelectionZ, canUngroup } from "./groups.js";
import { canCombine } from "./boolean.js";
import { pickedPoints } from "./points.js";
import { worldToScreen } from "./viewport.js";
import { HIT_R_COARSE, HIT_R_FINE, isCoarsePointer } from "./pointer.js";
import { setSelectMore } from "./session.js";
import { HANDLE_RADIUS, outerHandlePoints, selectionHandlePoints } from "./handles.js";
import {
  alignableCount,
  alignSelection,
  combineSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  joinSelected,
  mergeSelection,
  moveZOrder,
  removeSelectedHandle,
  selectAll,
  setElementClosed,
  setSelectedHandlesLinked,
  setSelectionLocked,
  splitAtSelectedPoint,
  toggleSelectedPointCurve,
  ungroupSelection,
} from "./selection-commands.js";
import { closeAndFinishPath, discardPath, finishPath, removeLastPenPoint } from "./pen-commands.js";
import { pasteFromClipboard } from "./clipboard.js";
import { beginTextEdit } from "./textedit.js";
import type { EditorState, Point, SceneElement } from "./types.js";

export interface Action {
  key: string;
  label: string;
  icon: string;
  danger?: boolean;
  disabled?: boolean;
  /** A switch rather than an action: shown pressed while on. */
  pressed?: boolean;
  /** Opens a page of its own - align, combine - instead of running anything. */
  menu?: () => Action[];
  /** Kept in the same row as the button after it, as backward is with forward. */
  pairedWithNext?: boolean;
  run?: () => void;
}

const GAP = 12;
/**
 * The most buttons in one row: seven fit across a 360px phone. A longer set is laid out in even
 * rows - eight as two of four, not seven and a straggler - so every button stays in view.
 */
const MAX_BUTTONS = 7;

let bar: HTMLElement;
let lastSignature = "";
/** The callbacks and presentation for the current selection, independent of button identity. */
let shownActions: readonly Action[] = [];
/** The pages opened from the bar, by key, innermost last; emptied when the selection changes. */
let pagePath: string[] = [];
let pageFor = "";

export function initActionBar(element: HTMLElement): void {
  bar = element;
  lastSignature = "";
  shownActions = [];
  pagePath = [];
  pageFor = "";
  // A press on the bar is a press on the bar, not on the canvas underneath it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** A path is worth closing only once the closing edge would actually show. */
function worthClosing(el: SceneElement): boolean {
  if (!canToggleClosed(el)) return false;
  return isClosedShape(el) || el.points.length > 2;
}

/** What the bar offers while the pen still has a path open. */
function drawingActions(state: EditorState): Action[] {
  const path = findElement(state.drawing?.activePathId);
  const points = path && "points" in path ? path.points.length : 0;
  return [
    {
      key: "undo-point",
      label: "Remove the last point",
      icon: "icon-undo",
      disabled: points < 1,
      run: removeLastPenPoint,
    },
    {
      key: "close",
      label: "Close the path and finish",
      icon: "icon-close-path",
      disabled: points < 2,
      run: closeAndFinishPath,
    },
    {
      key: "finish",
      label: "Finish the path",
      icon: "icon-check",
      disabled: points < 2,
      run: finishPath,
    },
    {
      key: "discard",
      label: "Throw this path away",
      icon: "icon-trash",
      danger: true,
      run: discardPath,
    },
  ];
}

/** Select all and paste: shown on touch with nothing selected, where there is no keyboard. */
function idleActions(state: EditorState): Action[] {
  return [
    {
      key: "select-all",
      label: "Select everything",
      icon: "icon-select-all",
      disabled: !state.elements.some((e) => !e.hidden),
      run: selectAll,
    },
    { key: "paste", label: "Paste", icon: "icon-paste", run: () => void pasteFromClipboard() },
  ];
}

/** Whether the idle bar is up: touch, the select tool, nothing selected and nothing drawn. */
function idle(state: EditorState): boolean {
  return (
    isCoarsePointer() &&
    state.tool === "select" &&
    !state.selection.elementIds.length &&
    !state.drawing?.activePathId
  );
}

/** Closing or opening the path, when there is a path and closing it would show. */
function closeAction(el: SceneElement): Action | null {
  if (!worthClosing(el)) return null;
  const closed = isClosedShape(el);
  return {
    key: "toggle-closed",
    label: closed ? "Open the path" : "Close the path",
    icon: closed ? "icon-open-path" : "icon-close-path",
    run: () => setElementClosed(el.id, !closed),
  };
}

/**
 * What the bar offers when one point of a path is selected.
 *
 * Everything else the bar can do - duplicate, z-order, group - acts on the whole shape, which
 * reads as a lie next to a highlighted point, and delete is the one button whose meaning really
 * does change with the selection. So the bar narrows to the point, and says so.
 */
function pointActions(el: SceneElement, index: number, handle?: "in" | "out"): Action[] {
  const out: Action[] = [];
  const p = el.type === "path" ? el.points[index] : undefined;
  const curved = !!p && (hasHandle(p, "in") || hasHandle(p, "out"));
  // Double-clicking the point does the same; the button is there so nobody has to know that.
  if (canToggleClosed(el)) {
    out.push(
      curved
        ? {
            key: "corner",
            label: "Make it a corner: remove its handles",
            icon: "icon-corner",
            run: toggleSelectedPointCurve,
          }
        : {
            key: "curve",
            label: "Make it a curve: give it handles",
            icon: "icon-curve",
            run: toggleSelectedPointCurve,
          }
    );
  }
  // The handle grabbed last can go on its own, leaving the curve on the other side.
  if (p && handle && hasHandle(p, handle)) {
    out.push({
      key: `remove-${handle}`,
      label: "Remove this handle: straight on its side",
      icon: "icon-remove-handle",
      run: removeSelectedHandle,
    });
  }
  // Only a point with two handles has a pair to link or break.
  if (p && hasTwoHandles(p)) {
    out.push(
      p.smooth
        ? {
            key: "toggle-linked",
            label: "Break the handles: each moves on its own",
            icon: "icon-unlink",
            run: () => setSelectedHandlesLinked(false),
          }
        : {
            key: "toggle-linked",
            label: "Link the handles: they mirror each other",
            icon: "icon-link",
            run: () => setSelectedHandlesLinked(true),
          }
    );
  }
  // The two ends of an open path have nothing to split.
  if (canSplitAt(el, index)) {
    out.push({
      key: "split",
      label: "Split the path at this point",
      icon: "icon-split",
      run: splitAtSelectedPoint,
    });
  }
  const close = closeAction(el);
  if (close) out.push(close);
  out.push({
    key: "delete-point",
    label: "Delete this point",
    icon: "icon-trash",
    danger: true,
    run: () => deleteSelection(false),
  });
  return out;
}

/**
 * Align, as one button opening a page: the six lines to align on, and the two ways to spread
 * things out once there are three to spread. One thing on its own aligns to the artboard.
 */
function alignAction(count: number): Action {
  const one = count === 1;
  const onto = one ? "the artboard's" : "their";
  return {
    key: "align",
    label: one ? "Align to the artboard" : "Align and distribute",
    icon: "icon-align-hcenter",
    menu: () => [
      {
        key: "align-left",
        label: `Align left edges to ${onto} left`,
        icon: "icon-align-left",
        run: () => alignSelection("left"),
      },
      {
        key: "align-hcenter",
        label: `Centre horizontally on ${onto} middle`,
        icon: "icon-align-hcenter",
        run: () => alignSelection("hcenter"),
      },
      {
        key: "align-right",
        label: `Align right edges to ${onto} right`,
        icon: "icon-align-right",
        run: () => alignSelection("right"),
      },
      {
        key: "align-top",
        label: `Align top edges to ${onto} top`,
        icon: "icon-align-top",
        run: () => alignSelection("top"),
      },
      {
        key: "align-vcenter",
        label: `Centre vertically on ${onto} middle`,
        icon: "icon-align-vcenter",
        run: () => alignSelection("vcenter"),
      },
      {
        key: "align-bottom",
        label: `Align bottom edges to ${onto} bottom`,
        icon: "icon-align-bottom",
        run: () => alignSelection("bottom"),
      },
      ...(count >= 3
        ? [
            {
              key: "distribute-x",
              label: "Space evenly across",
              icon: "icon-distribute-x",
              run: () => distributeSelection("x"),
            },
            {
              key: "distribute-y",
              label: "Space evenly down",
              icon: "icon-distribute-y",
              run: () => distributeSelection("y"),
            },
          ]
        : []),
    ],
  };
}

/** What the bar offers with several points picked: what acts on all of them at once. */
function pointsActions(state: EditorState): Action[] {
  const picked = pickedPoints(state.selection);
  const curvable = picked.filter((r) => {
    const el = findElement(r.pathId);
    return !!el && canToggleClosed(el);
  });
  const allCurves = curvable.every((r) => {
    const el = findElement(r.pathId);
    const p = el?.type === "path" ? el.points[r.index] : undefined;
    return !!p && (hasHandle(p, "in") || hasHandle(p, "out"));
  });
  const out: Action[] = [];
  if (curvable.length) {
    out.push(
      allCurves
        ? {
            key: "corners",
            label: "Make them corners: remove their handles",
            icon: "icon-corner",
            run: toggleSelectedPointCurve,
          }
        : {
            key: "curves",
            label: "Make them curves: give them handles",
            icon: "icon-curve",
            run: toggleSelectedPointCurve,
          }
    );
  }
  out.push(alignAction(picked.length));
  out.push({
    key: "delete-points",
    label: `Delete these ${picked.length} points`,
    icon: "icon-trash",
    danger: true,
    run: () => deleteSelection(false),
  });
  return out;
}

function selectionActions(state: EditorState): Action[] {
  const sel = selectedElements();
  const out: Action[] = [];
  const single = sel.length === 1 ? sel[0]! : null;

  if (pickedPoints(state.selection).length > 1) return pointsActions(state);
  const pe = state.selection.pathEdit;
  const edited = pe ? findElement(pe.pathId) : null;
  if (pe && edited) return pointActions(edited, pe.index, pe.handle);

  if (single?.type === "text") {
    out.push({
      key: "edit",
      label: "Edit text",
      icon: "icon-text",
      run: () => beginTextEdit(single.id),
    });
  }
  const close = single ? closeAction(single) : null;
  if (close) out.push(close);
  if (sel.length === 2 && sel.every(canJoin)) {
    out.push({ key: "join", label: "Join the two paths", icon: "icon-join", run: joinSelected });
  }

  const selected = new Set(state.selection.elementIds);
  if (canGroup(state.elements, selected)) {
    out.push({ key: "group", label: "Group", icon: "icon-group", run: groupSelection });
  }
  if (canMergeGroups(state.elements, selected)) {
    out.push({
      key: "merge",
      label: "Merge into one group",
      icon: "icon-merge",
      run: mergeSelection,
    });
  }
  if (canUngroup(state.elements, selected)) {
    out.push({ key: "ungroup", label: "Ungroup", icon: "icon-ungroup", run: ungroupSelection });
  }

  out.push(alignAction(alignableCount()));
  // Union, subtract, intersect and exclude: one button, opening a page of four.
  if (sel.length >= 2 && sel.every(canCombine)) {
    out.push({
      key: "combine",
      label: "Combine the shapes into one",
      icon: "icon-combine",
      menu: () => [
        {
          key: "union",
          label: "Union: everything the shapes cover",
          icon: "icon-union",
          run: () => combineSelection("union"),
        },
        {
          key: "subtract",
          label: "Subtract: the backmost shape, less the others",
          icon: "icon-subtract",
          run: () => combineSelection("subtract"),
        },
        {
          key: "intersect",
          label: "Intersect: only where they all overlap",
          icon: "icon-intersect",
          run: () => combineSelection("intersect"),
        },
        {
          key: "exclude",
          label: "Exclude: everything but where they overlap",
          icon: "icon-exclude",
          run: () => combineSelection("exclude"),
        },
      ],
    });
  }

  const ids = new Set(state.selection.elementIds);
  const more = state.selectMore;
  out.unshift({
    // Shift for a finger: while on, a tap adds a shape to the selection or takes it out.
    key: "select-more",
    label: more ? "Stop adding to the selection" : "Add to the selection: tap more shapes",
    icon: "icon-select-more",
    pressed: more,
    run: () => setSelectMore(!more),
  });
  // Locked shapes are reached from their rows; unlocking them is here once they are selected.
  const anyLocked = sel.some((e) => e.locked);
  out.push({
    key: "toggle-locked",
    label: anyLocked ? "Unlock: clickable on the canvas again" : "Lock: out of reach on the canvas",
    icon: anyLocked ? "icon-unlock" : "icon-lock",
    run: () => setSelectionLocked(!anyLocked),
  });
  // Duplicate and z-order, then select everything, then delete: last, where it is always found.
  out.push(
    { key: "duplicate", label: "Duplicate", icon: "icon-copy", run: duplicateSelection },
    {
      key: "back",
      label: "Send backward (Shift: to the back)",
      icon: "icon-chevron-down",
      pairedWithNext: true,
      disabled: !canMoveSelectionZ(state.elements, ids, -1),
      run: () => moveZOrder("back"),
    },
    {
      key: "forward",
      label: "Bring forward (Shift: to the front)",
      icon: "icon-chevron-up",
      disabled: !canMoveSelectionZ(state.elements, ids, 1),
      run: () => moveZOrder("forward"),
    }
  );
  // Always there, so the bar keeps its shape; greyed out once there is nothing more to select.
  out.push({
    key: "select-all",
    label: "Select everything",
    icon: "icon-select-all",
    disabled: !state.elements.some((e) => !e.hidden && !e.locked && !ids.has(e.id)),
    run: selectAll,
  });
  out.push({
    key: "delete",
    label: "Delete",
    icon: "icon-trash",
    danger: true,
    run: () => deleteSelection(),
  });
  return out;
}

const backAction = (): Action => ({
  key: "page-back",
  label: "Back",
  icon: "icon-back",
  run: () => {
    pagePath = pagePath.slice(0, -1);
    lastSignature = "";
  },
});

/**
 * How many buttons go in a row: all of them up to the limit, then as few rows as can be, as even
 * as can be - without a row ending between a pair (`pairs` holds the index of each pair's first).
 */
export function columnsFor(
  count: number,
  max = MAX_BUTTONS,
  pairs: readonly number[] = []
): number {
  const splits = (cols: number) => pairs.some((i) => (i + 1) % cols === 0);
  for (let rows = Math.ceil(count / max); rows <= count; rows++) {
    for (let cols = Math.ceil(count / rows); cols <= max; cols++) {
      if (Math.ceil(count / cols) !== rows) break;
      if (!splits(cols)) return cols;
    }
  }
  const rows = Math.ceil(count / max);
  return Math.max(1, Math.ceil(count / rows));
}

/** The buttons to show: the actions themselves, or the page a menu button has opened. */
function currentButtons(actions: readonly Action[]): Action[] {
  let shown = [...actions];
  for (const key of pagePath) {
    const opener = shown.find((a) => a.key === key);
    if (!opener?.menu) {
      pagePath = [];
      return [...actions];
    }
    shown = [backAction(), ...opener.menu()];
  }
  return shown;
}

function build(actions: readonly Action[]): void {
  bar.replaceChildren();
  const pairs = actions.flatMap((a, i) => (a.pairedWithNext ? [i] : []));
  bar.style.setProperty("--bar-cols", String(columnsFor(actions.length, MAX_BUTTONS, pairs)));
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ui-btn ui-icon-btn";
    const key = action.key;
    btn.addEventListener("click", () => {
      const current = shownActions.find((a) => a.key === key);
      if (!current || current.disabled) return;
      if (current.menu) {
        pagePath = [...pagePath, key];
        lastSignature = "";
      } else {
        current.run?.();
      }
      // A page change redraws at once; an action redraws with the state it changed.
      if (current.menu || key === "page-back") syncActionBar(latest!);
    });
    bar.appendChild(btn);
  }
}

function updateButtons(): void {
  shownActions.forEach((action, index) => {
    const btn = bar.children[index] as HTMLButtonElement;
    btn.title = action.label;
    btn.setAttribute("aria-label", action.label);
    if (btn.dataset.icon !== action.icon) {
      btn.innerHTML = `<svg class="glyph" aria-hidden="true"><use href="#${action.icon}" /></svg>`;
      btn.dataset.icon = action.icon;
    }
    btn.classList.toggle("action-danger", !!action.danger);
    if (action.pressed === undefined) btn.removeAttribute("aria-pressed");
    else btn.setAttribute("aria-pressed", String(action.pressed));
    if (action.menu) btn.setAttribute("aria-haspopup", "true");
    else btn.removeAttribute("aria-haspopup");
    btn.disabled = !!action.disabled;
  });
}

interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The screen rectangle around one selected point and its curve handles. The bar only acts on
 * that point, so it sits beside it: against the whole shape it could land a screen away from
 * what it acts on.
 */
function pointRect(state: EditorState): AnchorRect | null {
  // Every picked point, and the curve handles of the one picked last.
  const spots: { at: Point; reach: number }[] = [];
  const coarse = isCoarsePointer();
  const handleReach = coarse ? HIT_R_COARSE : HIT_R_FINE;
  // A point keeps room round it to see the segments leaving it and to grab it again; its
  // handles keep their target clear.
  const pointReach = coarse ? 48 : 32;
  const pe = state.selection.pathEdit;
  for (const ref of pickedPoints(state.selection)) {
    const el = findElement(ref.pathId);
    if (!el) continue;
    const local = pointAt(el, ref.index);
    if (!local) continue;
    spots.push({ at: toWorldPoint(el, local), reach: pointReach });
    if (el.type === "path" && pe?.pathId === ref.pathId && pe.index === ref.index) {
      const { hIn, hOut } = el.points[ref.index]!;
      for (const h of [hIn, hOut])
        if (h) spots.push({ at: toWorldPoint(el, h), reach: handleReach });
    }
  }
  if (!spots.length) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const { at, reach } of spots) {
    const s = worldToScreen(at.x, at.y);
    left = Math.min(left, s.x - reach);
    right = Math.max(right, s.x + reach);
    top = Math.min(top, s.y - reach);
    bottom = Math.max(bottom, s.y + reach);
  }
  return { left, right, top, bottom };
}

/** Where point `index` of a shape is: a path's, polyline's or polygon's point, or a line's end. */
function pointAt(el: SceneElement, index: number): Point | null {
  if (el.type === "line") return index === 0 ? { x: el.x1, y: el.y1 } : { x: el.x2, y: el.y2 };
  return "points" in el ? (el.points[index] ?? null) : null;
}

/** The screen rectangle the bar sits beside: a selected point, the selection, or the path being drawn. */
function anchorRect(state: EditorState): AnchorRect | null {
  const drawing = findElement(state.drawing?.activePathId);
  if (!drawing && state.selection.pathEdit) {
    const around = pointRect(state);
    if (around) return around;
  }
  const shapes = drawing ? [drawing] : selectedElements();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const { zoom } = state.viewport;
  for (const el of shapes) {
    // The local box turned into place - the same outline the selection draws - so the bar sits
    // against what you can see rather than against a larger upright box around it.
    const box = localBBox(el);
    if (!box) continue;
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    for (const corner of corners) {
      const world = toWorldPoint(el, corner);
      const p = worldToScreen(world.x, world.y);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    // Handles standing outside the outline count as part of the selection, on whichever side
    // the rotation put them, so the bar never lands on top of one.
    const rotatable = !drawing && shapes.length === 1;
    for (const world of outerHandlePoints(el, zoom, rotatable)) {
      const p = worldToScreen(world.x, world.y);
      left = Math.min(left, p.x - HANDLE_RADIUS);
      right = Math.max(right, p.x + HANDLE_RADIUS);
      top = Math.min(top, p.y - HANDLE_RADIUS);
      bottom = Math.max(bottom, p.y + HANDLE_RADIUS);
    }
  }
  // Several shapes have handles of their own, around the box they share.
  for (const world of drawing ? [] : selectionHandlePoints(shapes, zoom)) {
    const p = worldToScreen(world.x, world.y);
    left = Math.min(left, p.x - HANDLE_RADIUS);
    right = Math.max(right, p.x + HANDLE_RADIUS);
    top = Math.min(top, p.y - HANDLE_RADIUS);
    bottom = Math.max(bottom, p.y + HANDLE_RADIUS);
  }
  if (!Number.isFinite(left)) return null;
  return { left, right, top, bottom };
}

/**
 * The strip of window the toolbars leave free. The bar stays inside it: pushed to the top of the
 * canvas it would slide under the toolbar, where half of it is unreachable.
 */
function freeBand(): { top: number; bottom: number } {
  const visible = (el: HTMLElement | null) => (el?.getClientRects().length ? el : null);
  const topBar = visible(document.querySelector<HTMLElement>(".top-bar"));
  const toolBar = visible(document.getElementById("tool-bar"));
  const top = topBar ? topBar.getBoundingClientRect().bottom + GAP : 8;
  const bottom = toolBar ? toolBar.getBoundingClientRect().top - GAP : window.innerHeight - 8;
  return { top: Math.max(8, top), bottom: Math.min(window.innerHeight - 8, bottom) };
}

/** Puts the bar just above the selection, or below it when there is no room. */
function position(state: EditorState): void {
  // Measured from the left edge: where it last stood limits how wide a wrapping bar lays out.
  bar.style.left = "8px";
  const size = bar.getBoundingClientRect();
  if (idle(state)) {
    // Nothing to sit beside: it docks at the bottom of the free band, over the tool bar.
    const band = freeBand();
    bar.style.left = `${Math.max(8, (window.innerWidth - size.width) / 2)}px`;
    bar.style.top = `${band.bottom - size.height}px`;
    return;
  }
  const at = anchorRect(state);
  if (!at) return;
  const x = Math.min(
    Math.max((at.left + at.right) / 2 - size.width / 2, 8),
    window.innerWidth - size.width - 8
  );
  const band = freeBand();
  const above = at.top - size.height - GAP;
  const y = above >= band.top ? above : at.bottom + GAP;
  bar.style.left = `${Math.max(8, x)}px`;
  bar.style.top = `${Math.max(band.top, Math.min(y, band.bottom - size.height))}px`;
}

let latest: EditorState | null = null;

/** Called on every state change: shows, rebuilds and repositions the bar as needed. */
export function syncActionBar(state: EditorState): void {
  const drawing = !!state.drawing?.activePathId;
  const show =
    !state.finalOnly &&
    !state.ui.editingTextId &&
    (drawing || !!state.selection.elementIds.length || idle(state));
  bar.classList.toggle("hidden", !show);
  if (!show) {
    lastSignature = "";
    shownActions = [];
    return;
  }
  latest = state;
  // A page opened for one selection means nothing for the next.
  const owner = `${drawing}|${state.selection.elementIds.join(",")}|${state.selection.pathEdit?.pathId ?? ""}|${pickedPoints(state.selection).length}`;
  if (owner !== pageFor) {
    pageFor = owner;
    pagePath = [];
  }
  const actions = currentButtons(
    drawing ? drawingActions(state) : idle(state) ? idleActions(state) : selectionActions(state)
  );
  shownActions = actions;
  // Only structural changes rebuild the buttons; callbacks and appearance always stay current.
  const signature = actions.map((a) => `${a.key}${a.pairedWithNext ? "-pair" : ""}`).join(",");
  if (signature !== lastSignature) {
    build(actions);
    lastSignature = signature;
  }
  updateButtons();
  position(state);
}
