import { getState } from "./state.js";
import { renderRulers, setRulerOffset } from "./rulers.js";
import { isCoarsePointer } from "./pointer.js";
import { bindDock, byId } from "@tools/ui";

/**
 * Where the tools move to the bottom bar: the phone layout's media query in styles.css, which
 * shows that bar. The two must match, or the tools land in a bar that is not shown.
 */
const PHONE = "(width < 591px)";
const phoneQuery = window.matchMedia(PHONE);
/**
 * Where a side panel goes full width and covers the canvas (panels.css, and the `.panel-open`
 * media query in styles.css): wider than the phone layout, since the panels need more room.
 */
const COVER = "(max-width: 720px)";
const narrowQuery = window.matchMedia(COVER);
const toolGroup = byId("tool-group-tools");

/**
 * The tools are one element, moved between the top bar and the bottom bar - never duplicated.
 * Snap rides with them: it is a drawing aid, so on a phone it belongs under the thumb rather
 * than up among the view controls.
 */
function placeTools(): void {
  const home = phoneQuery.matches ? byId("tool-bar") : byId("tool-slot");
  if (toolGroup.parentElement !== home) home.appendChild(toolGroup);
}
placeTools();
phoneQuery.addEventListener("change", placeTools);
narrowQuery.addEventListener("change", () => {
  if (narrowQuery.matches && docDock.isOpen()) helpDock.setOpen(false);
  layoutPanels();
});

/* ---------- The Document panel docked left, Help docked right (@tools/ui bindDock) ---------- */

/**
 * On a phone either panel covers the canvas and the two would sit on top of each other, so opening
 * one closes the other. On a wider screen they dock on opposite sides and can both stay open.
 */
function closeOtherOnPhone(other: () => ReturnType<typeof bindDock>) {
  return (open: boolean) => {
    if (open && narrowQuery.matches) other().setOpen(false);
    layoutPanels();
  };
}

const docDock = bindDock(byId("menu-document"), byId("menu-document-btn"), {
  key: "svg.panel.document",
  onToggle: closeOtherOnPhone(() => helpDock),
});
const helpDock = bindDock(byId("help-panel"), byId("btn-help"), {
  key: "svg.panel.help",
  onToggle: closeOtherOnPhone(() => docDock),
});

function layoutPanels(): void {
  // On a phone an open panel covers the canvas, and the rulers go with it.
  const anyOpen = docDock.isOpen() || helpDock.isOpen();
  document.body.classList.toggle("panel-open", narrowQuery.matches && anyOpen);
  docDock.place();
  helpDock.place();
  setRulerOffset(docDock.isOpen() ? docDock.panel.offsetWidth : 0);
  renderRulers(getState());
}

window.addEventListener("resize", layoutPanels);

/** Reopens what was open when the page was last shown. Needs the rulers and render set up. */
export function restoreLayout(): void {
  docDock.restore();
  helpDock.restore();
}

/**
 * Help answers for the pointer you are using. The starting side is the one detected, but it is a
 * switch rather than a rule: a laptop with a touch screen is both, and the other side is often
 * exactly what you wanted to read.
 */
const helpBody = byId("help-body");

function setHelpMode(mode: "mouse" | "touch"): void {
  helpBody.classList.toggle("help--mouse", mode === "mouse");
  helpBody.classList.toggle("help--touch", mode === "touch");
  helpBody.scrollTop = 0;
  document.querySelectorAll<HTMLElement>("[data-help-mode]").forEach((btn) => {
    const on = btn.dataset.helpMode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

document.querySelectorAll<HTMLElement>("[data-help-mode]").forEach((btn) => {
  btn.addEventListener("click", () =>
    setHelpMode(btn.dataset.helpMode === "touch" ? "touch" : "mouse")
  );
});
setHelpMode(isCoarsePointer() ? "touch" : "mouse");

/* Collapsible sections (remembered). */
const SECTIONS_KEY = "svg.sections";
const sectionOpen: Record<string, boolean> = {
  documents: true,
  images: false,
  svg: true,
  primitives: true,
};
try {
  Object.assign(sectionOpen, JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}"));
} catch {
  /* defaults */
}

function applySections(): void {
  docDock.panel.querySelectorAll<HTMLElement>(".doc-section").forEach((sec) => {
    sec.classList.toggle("collapsed", !sectionOpen[sec.dataset.section ?? ""]);
  });
}

export function setSectionOpen(key: string, open: boolean): void {
  sectionOpen[key] = open;
  applySections();
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionOpen));
  } catch {
    /* not remembered */
  }
}

docDock.panel.querySelectorAll<HTMLElement>(".doc-toggle").forEach((btn) => {
  const key = btn.closest<HTMLElement>(".doc-section")?.dataset.section;
  if (key) btn.addEventListener("click", () => setSectionOpen(key, !sectionOpen[key]));
});
applySections();
