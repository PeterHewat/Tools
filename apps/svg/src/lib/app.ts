import { getState, setState, subscribe } from "./state.js";
import { initViewport } from "./viewport.js";
import { initRender, renderAll, renderPointer } from "./render.js";
import { bindInteraction, bindRulerGuides, cancelOperation } from "./interaction.js";
import { setTool, finishPath } from "./pen-commands.js";
import { copySelectionText, cutSelection, pasteFromText } from "./clipboard.js";
import {
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  moveZOrder,
  groupSelection,
  mergeSelection,
  ungroupSelection,
  splitAtSelectedPoint,
  joinSelected,
  stepOutSelection,
  selectAll,
} from "./selection-commands.js";
import { pushUndo, canUndo, canRedo, undo, redo, undoStepper } from "./undo.js";
import { formatExportSvg } from "./svg-export.js";
import { importSvgFile } from "./svg-import.js";
import { pngSize, renderPng } from "./png-export.js";
import { fileBase, isSvgFile, listed } from "./document-files.js";
import { canJoin } from "./model.js";
import {
  THEME_EVENT,
  bindThemeToggle,
  byId,
  copyText,
  downloadBlob,
  downloadText,
  onFileDrop,
  pickFiles,
} from "@tools/ui";
import {
  openColorPicker,
  closeColorPicker,
  isColorPickerOpenFor,
  setColorSampler,
} from "./colorpicker.js";
import { canPickFromImages, pickFromImages } from "./eyedropper.js";
import { initRulers, renderRulers } from "./rulers.js";
import { initActionBar, syncActionBar } from "./actionbar.js";
import { endTextEdit, initTextEdit, isTextEditing, positionTextEditor } from "./textedit.js";
import { initPointerKind, initPointerTracking } from "./pointer.js";
import {
  followState,
  isAlignSnap,
  setAlignSnap,
  setGridSnap,
  writeSessionView,
} from "./session.js";
import { canGroup, canMergeGroups, canUngroup } from "./groups.js";
import { MAX_ARTBOARD, type EditorState } from "./types.js";
import { restoreLayout } from "./layout.js";
import { zoomBtn, zoomMenu, fitToView, fitSelection, zoomToActualSize } from "./zoom.js";
import { addImageFiles, imageList } from "./images-panel.js";
import { primitiveList } from "./primitives-panel.js";
import { syncSvgEditor } from "./svg-source.js";
import {
  currentDoc,
  importDocumentFiles,
  saveNow,
  startDocuments,
  svgFileName,
} from "./documents.js";

const svg = byId<SVGSVGElement>("viewport-svg");
const camera = byId<SVGGElement>("camera");
const wrap = byId("canvas-wrap");

initPointerTracking();
initPointerKind(() => renderAll(getState()));
initViewport(svg, camera);
initRender({
  artboardChecks: byId<SVGRectElement>("artboard-checks-rect"),
  artboardBg: byId<SVGRectElement>("artboard-bg"),
  images: byId<SVGGElement>("layer-images"),
  grid: byId<SVGGElement>("layer-grid"),
  document: byId<SVGGElement>("layer-document"),
  overlay: byId<SVGGElement>("layer-overlay"),
  pointer: byId<SVGGElement>("layer-pointer"),
});

initTextEdit(wrap);
initActionBar(byId("action-bar"));
bindInteraction(svg, wrap);
setColorSampler({ available: canPickFromImages, pick: () => pickFromImages(wrap, svg) });

// Clicking the canvas takes the keyboard back from any field so the shortcuts work again, and
// drops any leftover page text selection, which would otherwise suppress the Ctrl+C / Ctrl+X
// shape handlers below.
svg.addEventListener(
  "pointerdown",
  () => {
    if (isTextEditing()) endTextEdit(true);
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && (a.matches?.("input, select, textarea") || a.isContentEditable))
      a.blur();
    if (window.getSelection()?.toString()) window.getSelection()?.removeAllRanges();
  },
  true
);

/* Clipboard: our own JSON between sessions, plain SVG markup accepted on paste. The SVG source
   editor is contenteditable: what is copied, cut or pasted there is its text. */
const inField = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
document.addEventListener("copy", (e) => {
  if (inField(e.target) || window.getSelection()?.toString()) return;
  const text = copySelectionText();
  if (text) {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  }
});
document.addEventListener("cut", (e) => {
  if (inField(e.target) || window.getSelection()?.toString()) return;
  const text = cutSelection();
  if (text) {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  }
});
document.addEventListener("paste", (e) => {
  if (inField(e.target)) return;
  if (pasteFromText(e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
});

byId("btn-undo").addEventListener("click", () => undo());
byId("btn-redo").addEventListener("click", () => redo());

byId("btn-join").addEventListener("click", () => joinSelected());
byId("btn-group").addEventListener("click", () => groupSelection());
byId("btn-merge").addEventListener("click", () => mergeSelection());
byId("btn-ungroup").addEventListener("click", () => ungroupSelection());

document.querySelectorAll<HTMLElement>(".tool-btn[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool as EditorState["tool"];
    // Tapping the active drawing tool puts the canvas back to selecting, which is the way out
    // of a tool when there is no Esc key to press.
    setTool(tool !== "select" && getState().tool === tool ? "select" : tool);
  });
});

bindRulerGuides(byId<HTMLCanvasElement>("ruler-top"), byId<HTMLCanvasElement>("ruler-left"));
initRulers({
  topCanvas: byId<HTMLCanvasElement>("ruler-top"),
  leftCanvas: byId<HTMLCanvasElement>("ruler-left"),
  cornerEl: byId("ruler-corner"),
  svg,
});
window.addEventListener("resize", () => renderRulers(getState()));
window.addEventListener(THEME_EVENT, () => renderRulers(getState()));
document
  .querySelectorAll<HTMLElement>("[data-theme-toggle]")
  .forEach((btn) => bindThemeToggle(btn, "glyph"));

let lastSavedViewport: EditorState["viewport"] | null = null;

subscribe((state, { pointerOnly }) => {
  if (pointerOnly) {
    renderPointer(state);
    renderRulers(state);
    syncCursorReadout(state);
    return;
  }
  followState(state);
  renderAll(state);
  // Where you are looking belongs to the tab, not to the drawing: kept so a refresh returns it.
  if (state.viewport !== lastSavedViewport) {
    lastSavedViewport = state.viewport;
    writeSessionView({ docId: currentDoc.id, viewport: state.viewport });
  }
  renderRulers(state);
  syncPanel(state);
  syncActionBar(state);
  // The in-place text field rides along with the camera and with the element it is editing.
  if (state.ui.editingTextId) positionTextEditor();
});

/* What the panels and bars show, looked up once: they are brought up to date on every render. */
const cursorReadout = byId("cursor-pos");
const artboardWidth = byId<HTMLInputElement>("artboard-width");
const artboardHeight = byId<HTMLInputElement>("artboard-height");
const gridStep = byId<HTMLInputElement>("grid-step");
const bgSwatch = byId("bg-swatch");
const gridBtn = byId("btn-grid");
const finalBtn = byId("btn-final");
const snapBtn = byId("btn-snap");
const alignBtn = byId("btn-align");
const undoBtn = byId<HTMLButtonElement>("btn-undo");
const redoBtn = byId<HTMLButtonElement>("btn-redo");
const groupBtn = byId<HTMLButtonElement>("btn-group");
const mergeBtn = byId<HTMLButtonElement>("btn-merge");
const ungroupBtn = byId<HTMLButtonElement>("btn-ungroup");
const joinBtn = byId<HTMLButtonElement>("btn-join");
const toolButtons = [...document.querySelectorAll<HTMLElement>(".tool-btn[data-tool]")];

function setToggle(btn: HTMLElement, on: boolean): void {
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
}

function syncCursorReadout(state: EditorState): void {
  const c = state.cursor;
  const x = c.snapActive ? c.snapX : c.x;
  const y = c.snapActive ? c.snapY : c.y;
  const text = `${Math.round(x)}, ${Math.round(y)}`;
  if (cursorReadout.textContent !== text) cursorReadout.textContent = text;
}

function syncPanel(state: EditorState): void {
  artboardWidth.value = String(state.artboard.width);
  artboardHeight.value = String(state.artboard.height);
  gridStep.value = String(state.grid.step);
  bgSwatch.style.setProperty("--c", state.background.color);
  bgSwatch.style.setProperty("--a", String(state.background.opacity));
  setToggle(gridBtn, state.grid.visible);
  setToggle(finalBtn, state.finalOnly);
  setToggle(snapBtn, state.grid.snap);
  setToggle(alignBtn, isAlignSnap());
  const percent = `${Math.round(state.viewport.zoom * 100)}%`;
  if (zoomBtn.textContent !== percent) zoomBtn.textContent = percent;
  zoomMenu.querySelectorAll<HTMLElement>("[data-zoom]").forEach((btn) => {
    const on = Math.abs(Number(btn.dataset.zoom) - state.viewport.zoom) < 1e-6;
    btn.classList.toggle("active", on);
    btn.parentElement?.setAttribute("aria-selected", String(on));
  });

  syncCursorReadout(state);

  for (const btn of toolButtons) btn.classList.toggle("active", btn.dataset.tool === state.tool);
  wrap.classList.toggle("mode-hand", state.spacePan);
  wrap.classList.toggle("mode-select", state.tool === "select" && !state.spacePan);

  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();

  imageList.sync(state);
  primitiveList.sync(state);
  syncSvgEditor(state);
  syncGroupButtons(state);
}

/** Group / Merge / Ungroup / Join are only enabled when they would actually do something. */
function syncGroupButtons(state: EditorState): void {
  const ids = new Set(state.selection.elementIds);
  const sel = state.elements.filter((e) => ids.has(e.id));
  groupBtn.disabled = !canGroup(state.elements, ids);
  mergeBtn.disabled = !canMergeGroups(state.elements, ids);
  ungroupBtn.disabled = !canUngroup(state.elements, ids);
  joinBtn.disabled = !(sel.length === 2 && sel.every(canJoin));
}

/* ---------- Toolbar ---------- */

/**
 * Sizes and steps are whole numbers from 1 to `MAX_ARTBOARD`: a larger one is held to that, and
 * anything else puts the field back as it was.
 */
function bindNumber(id: string, apply: (v: number) => void): void {
  byId(id).addEventListener("change", (e) => {
    const v = Math.round(parseFloat((e.target as HTMLInputElement).value));
    if (!Number.isFinite(v) || v < 1) {
      syncPanel(getState());
      return;
    }
    pushUndo();
    apply(Math.min(v, MAX_ARTBOARD));
    syncPanel(getState());
  });
}

bindNumber("artboard-width", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, width: v } }))
);
bindNumber("artboard-height", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, height: v } }))
);
bindNumber("grid-step", (v) => setState((s) => ({ ...s, grid: { ...s.grid, step: v } })));

bgSwatch.addEventListener("click", () => {
  if (isColorPickerOpenFor(bgSwatch)) {
    closeColorPicker();
    return;
  }
  const start = getState().background;
  const step = undoStepper();
  openColorPicker({
    anchor: bgSwatch,
    color: start.color,
    alpha: start.opacity,
    onChange: (color, opacity) => {
      step();
      setState((s) => ({ ...s, background: { color, opacity } }));
    },
  });
});

byId("btn-grid").addEventListener("click", () => {
  setState((s) => ({ ...s, grid: { ...s.grid, visible: !s.grid.visible } }));
});
byId("btn-snap").addEventListener("click", () => setGridSnap(!getState().grid.snap));
byId("btn-align").addEventListener("click", () => setAlignSnap(!isAlignSnap()));

byId("btn-final").addEventListener("click", () => {
  setState((s) => ({ ...s, finalOnly: !s.finalOnly }));
});

byId("btn-save-svg").addEventListener("click", () => {
  downloadText(svgFileName(), formatExportSvg(getState(), true), "image/svg+xml");
});
const pngBtn = byId<HTMLButtonElement>("btn-export-png");
pngBtn.addEventListener("click", async () => {
  const { width, height } = pngSize(getState().artboard);
  pngBtn.disabled = true;
  try {
    const png = await renderPng(formatExportSvg(getState(), true), width, height);
    downloadBlob(`${fileBase(currentDoc.name)}.png`, png);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : String(err));
  } finally {
    pngBtn.disabled = false;
  }
});
byId("btn-copy-svg").addEventListener("click", async (e) => {
  e.stopPropagation();
  const text = formatExportSvg(getState(), true);
  if (!(await copyText(text, byId("btn-copy-svg")))) {
    downloadText(svgFileName(), text, "image/svg+xml");
  }
});
byId("btn-import-svg").addEventListener("click", async () => {
  const [file] = await pickFiles(".svg,image/svg+xml");
  if (!file) return;
  let imported: ReturnType<typeof importSvgFile>;
  try {
    imported = importSvgFile(await file.text());
  } catch (err) {
    window.alert(`Could not import ${file.name}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const { artboard, background, elements, groupNames, skipped } = imported;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: [...s.elements, ...elements],
    groupNames: { ...s.groupNames, ...groupNames },
    artboard: artboard ?? s.artboard,
    background: background ?? s.background,
  }));
  if (skipped.length) {
    window.alert(
      `Imported ${file.name}, leaving out what the app cannot hold: ${listed(skipped)}.`
    );
  }
});

/* ---------- Files dropped on the page ---------- */

/**
 * Anywhere on the page: an SVG or a document file (`.svg.json`) opens as a new document, as
 * the Documents list's import does, and a picture becomes a reference image of the document
 * open, as the Reference images +. Adding an SVG's shapes to the drawing is Import SVG's job.
 */
onFileDrop(document.body, (files) => void dropFiles(files));

async function dropFiles(files: readonly File[]): Promise<void> {
  const isPicture = (f: File) => f.type.startsWith("image/") && !isSvgFile(f);
  // The pictures first, so they land in the document that was open when they were dropped.
  await addImageFiles(files.filter(isPicture));
  const documents = files.filter((f) => !isPicture(f));
  if (documents.length) await importDocumentFiles(documents);
}

/* ---------- Keyboard ---------- */

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  const isToggle = t.matches?.("input[type=checkbox], input[type=radio], input[type=range]");
  // Only real text entry swallows shortcuts (the SVG source editor is contenteditable); a
  // focused checkbox or button must not.
  if (t.matches?.("textarea, select") || t.isContentEditable || (t.matches?.("input") && !isToggle))
    return;
  if (isToggle && e.code === "Space") return;
  const key = e.key.toLowerCase();
  if (e.code === "Space") {
    e.preventDefault();
    setState({ spacePan: true });
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Y on Windows, Cmd+Shift+Z on a Mac; both work everywhere.
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if (key === "y") {
      e.preventDefault();
      redo();
    }
    if (key === "s") {
      e.preventDefault();
      if (e.shiftKey) byId("btn-save-svg").click();
      else void saveNow();
    }
    if (key === "d") {
      e.preventDefault();
      duplicateSelection();
    }
    if (key === "a") {
      e.preventDefault();
      selectAll();
    }
    // By code, not key: Option+G on a Mac types a character rather than "g".
    if (e.altKey && e.code === "KeyG") {
      e.preventDefault();
      mergeSelection();
    } else if (key === "g") {
      e.preventDefault();
      if (e.shiftKey) ungroupSelection();
      else groupSelection();
    }
    if (key === "[") {
      e.preventDefault();
      moveZOrder("back");
    }
    if (key === "]") {
      e.preventDefault();
      moveZOrder("forward");
    }
    return;
  }
  // The view, as most editors have it: by code, since Shift turns the digit into a symbol.
  if (e.shiftKey && e.code === "Digit0") {
    zoomToActualSize();
    return;
  }
  if (e.shiftKey && e.code === "Digit1") {
    fitToView();
    return;
  }
  if (e.shiftKey && e.code === "Digit2") {
    fitSelection();
    return;
  }
  if (key === "s") setTool("select");
  if (key === "p") setTool("pen");
  if (key === "r") setTool("rect");
  if (key === "e") setTool("ellipse");
  if (key === "t") setTool("text");
  if (key === "g") setGridSnap(!getState().grid.snap);
  if (key === "escape") {
    const st = getState();
    if (isTextEditing()) endTextEdit(false);
    else if (st.drawing || st.tool !== "select" || !stepOutSelection()) cancelOperation();
  }
  if (key === "enter" && getState().tool === "pen") finishPath();
  if (key === "x") splitAtSelectedPoint();
  if (key === "j") joinSelected();
  if (key === "delete" || key === "backspace") {
    e.preventDefault();
    deleteSelection();
  }
  const nudge: Record<string, [number, number]> = {
    arrowleft: [-1, 0],
    arrowright: [1, 0],
    arrowup: [0, -1],
    arrowdown: [0, 1],
  };
  const dir = nudge[key];
  if (dir) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudgeSelection(dir[0] * step, dir[1] * step);
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") setState({ spacePan: false });
});

restoreLayout();
renderAll(getState());
fitToView();

startDocuments();
