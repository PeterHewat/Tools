import { getState, selectedElements, setState } from "./state.js";
import { clampZoom, zoomAt } from "./viewport.js";
import { unionBox } from "./selection-transform.js";
import type { BBox } from "./types.js";
import { bindMenu, byId } from "@tools/ui";

/**
 * Zoom is one control: it says what the zoom is, and opens a list to set it.
 *
 * Three buttons - minus, 100%, plus - took three slots to do what one does, and on a phone that
 * was most of the reason the view controls had to hide behind a menu at all. The label follows
 * the viewport however it changed, so a pinch or a wheel is read back here too.
 */
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
export const zoomBtn = byId("btn-zoom-level");
export const zoomMenu = byId("zoom-menu");

const item = (attrs: string, label: string) =>
  `<li role="option" aria-selected="false"><button type="button" class="ui-menu-item" ${attrs}>${label}</button></li>`;
zoomMenu.innerHTML =
  item('data-fit="artboard" title="Shift+1"', "Fit artboard") +
  item('data-fit="selection" title="Shift+2"', "Fit selection") +
  ZOOM_LEVELS.map((z) => item(`data-zoom="${z}"`, `${Math.round(z * 100)}%`)).join("");

// A menu like every other in Tools: a click outside or Esc closes it, and Esc does only that,
// rather than also stepping out of a selection.
const menu = bindMenu(zoomBtn, zoomMenu, {
  align: "center",
  onOpen: () => {
    // Fitting the selection means something only with one.
    const fit = zoomMenu.querySelector<HTMLButtonElement>('[data-fit="selection"]');
    if (fit) fit.disabled = !selectedElements().length;
  },
});

zoomMenu.addEventListener("click", (e) => {
  const fit = (e.target as HTMLElement).closest<HTMLElement>("[data-fit]");
  if (fit) {
    if (fit.dataset.fit === "selection") fitSelection();
    else fitToView();
    menu.close();
    return;
  }
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
  if (!target) return;
  zoomTo(Number(target.dataset.zoom));
  menu.close();
});

/* ---------- Fitting the view ---------- */

const svg = byId<SVGSVGElement>("viewport-svg");
const topBar = byId("top-bar");
const toolBar = byId("tool-bar");

/** Space left around what is fitted, in screen pixels. */
const FIT_PADDING = 40;

/** Shows the whole artboard as large as it fits in what the toolbars leave free. */
export function fitToView(): void {
  const { width, height } = getState().artboard;
  fitBox({ x: 0, y: 0, width, height });
}

/** Shows the selection as large as it fits; nothing happens with nothing selected. */
export function fitSelection(): void {
  const box = unionBox(selectedElements());
  if (box) fitBox(box);
}

/** 100%, about the middle of the canvas. */
export function zoomToActualSize(): void {
  zoomTo(1);
}

/**
 * Shows `box` as large as it fits, centred in what is free. A box with no extent on one side - a
 * flat line - is fitted by the other, and a single point keeps the zoom.
 *
 * On a phone the toolbars float over the canvas rather than taking a strip of it, so the free
 * part leaves their height out, or the top and bottom of what is fitted land underneath them.
 */
function fitBox(box: BBox): void {
  const rect = svg.getBoundingClientRect();
  const top = covered(topBar, "top", rect);
  const usableH = Math.max(1, rect.height - top - covered(toolBar, "bottom", rect));
  const fits = [
    box.width > 0 ? (rect.width - FIT_PADDING * 2) / box.width : Infinity,
    box.height > 0 ? (usableH - FIT_PADDING * 2) / box.height : Infinity,
  ];
  // No cap of its own: "fit" means fill what is free, and clampZoom already has the last word.
  const want = Math.min(...fits);
  const zoom = clampZoom(Number.isFinite(want) ? want : getState().viewport.zoom);
  setState({
    viewport: {
      panX: rect.width / 2 - (box.x + box.width / 2) * zoom,
      panY: top + usableH / 2 - (box.y + box.height / 2) * zoom,
      zoom,
    },
  });
}

/**
 * How much of the canvas a floating toolbar covers from one edge. On a wider screen the bars are
 * in the flow and this is zero.
 */
function covered(bar: HTMLElement, edge: "top" | "bottom", canvas: DOMRect): number {
  // Not offsetParent: that is null for a fixed element, which is exactly the case here.
  if (!bar.getClientRects().length) return 0;
  const r = bar.getBoundingClientRect();
  const over = edge === "top" ? r.bottom - canvas.top : canvas.bottom - r.top;
  return over <= 0 ? 0 : Math.min(over + 8, canvas.height / 3);
}

/** Picking a level zooms about the middle of the canvas, the way the wheel works on the cursor. */
function zoomTo(level: number): void {
  const rect = svg.getBoundingClientRect();
  const factor = level / getState().viewport.zoom;
  setState({ viewport: zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor) });
}
