/**
 * A menu under the button that opens it (`.ui-menu`, in panels.css): Settings and "⋯" in the
 * JSON app, zoom in the SVG app. It is a popover, so it opens above everything else on the page,
 * and a click anywhere outside it or Esc closes it; picking an item is the caller's to close.
 */

export interface MenuOptions {
  /** Which edge of the button the menu lines up with. */
  align?: "start" | "center" | "end";
  /** Just before it opens, while it is still hidden: fill it or bring it up to date here. */
  onOpen?: () => void;
}

/** From the button to the menu, and from the menu's edge to the window's. */
const GAP = 4;
const MARGIN = 8;

/** Makes `button` open and close `menu`, which becomes a popover. */
export function bindMenu(
  button: HTMLElement,
  menu: HTMLElement,
  options: MenuOptions = {}
): { close: () => void } {
  menu.popover = "auto";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  const isOpen = () => menu.matches(":popover-open");
  const close = () => {
    if (isOpen()) menu.hidePopover();
  };

  /** Under the button, lined up as asked, and moved in to stay inside the window. */
  const place = () => {
    const r = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left =
      options.align === "end"
        ? r.right - width
        : options.align === "center"
          ? r.left + (r.width - width) / 2
          : r.left;
    menu.style.left = `${Math.max(MARGIN, Math.min(left, innerWidth - width - MARGIN))}px`;
    menu.style.top = `${r.bottom + GAP}px`;
    menu.style.maxHeight = `${Math.max(120, innerHeight - r.bottom - GAP - MARGIN)}px`;
  };

  // Pressing the button while the menu is open closes it by light dismiss before the click
  // arrives, and the click would open it again: remember what the press saw. Only a pointer's
  // click follows a press; one from the keyboard (detail 0) must not read a press that never
  // became a click, such as a finger dragged off the button.
  let openAtPress = false;
  button.addEventListener("pointerdown", () => {
    openAtPress = isOpen();
  });
  button.addEventListener("pointercancel", () => {
    openAtPress = false;
  });
  button.addEventListener("click", (e) => {
    const wasOpen = (e.detail > 0 && openAtPress) || isOpen();
    openAtPress = false;
    if (wasOpen) return close();
    options.onOpen?.();
    menu.showPopover();
    // Shown by now, so it has a size to place, and nothing has been painted yet.
    place();
  });
  menu.addEventListener("toggle", (e) => {
    button.setAttribute("aria-expanded", String((e as ToggleEvent).newState === "open"));
  });
  window.addEventListener("resize", () => {
    if (isOpen()) place();
  });
  // Esc closes the menu and only that: an app's own Esc (leaving a selection, closing find)
  // must not happen too. Capturing on window runs before anyone else's listener.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      button.focus();
    },
    true
  );
  return { close };
}
