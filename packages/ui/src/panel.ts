/**
 * A panel docked to one side under the header (`.ui-dock`, in panels.css): Help in every app,
 * the SVG app's Document panel. It stays open beside the work until its button closes it, and a
 * reload of the tab reopens it; a new tab starts with it closed.
 */

import { readStored, writeStored } from "./storage.js";

export interface Dock {
  readonly panel: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Reopens the panel if it was open when this tab was last shown. */
  restore(): void;
  /** Moves the panel's top to the header's bottom edge, which moves as the header wraps. */
  place(): void;
}

export interface DockOptions {
  /** The sessionStorage key its open state is kept under, e.g. `tools.json.help`. */
  key: string;
  /** After it opens or closes, and after `place` on those occasions. */
  onToggle?: (open: boolean) => void;
}

/** Makes `button` open and close `panel`, which starts closed (`hidden`). */
export function bindDock(panel: HTMLElement, button: HTMLElement, options: DockOptions): Dock {
  const header = document.querySelector<HTMLElement>("[data-tools-header]");
  const place = () => {
    if (header) panel.style.top = `${header.getBoundingClientRect().bottom}px`;
  };
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    writeStored(options.key, open || undefined, "session");
    place();
    options.onToggle?.(open);
  };
  const dock: Dock = {
    panel,
    isOpen: () => !panel.hidden,
    setOpen,
    restore() {
      if (readStored(options.key, "session")) setOpen(true);
    },
    place,
  };
  panel.hidden = true;
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => setOpen(!dock.isOpen()));
  window.addEventListener("resize", place);
  return dock;
}
