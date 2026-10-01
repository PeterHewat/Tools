import { bindDock } from "./panel.js";
import { bindThemeToggle } from "./theme.js";
import { byId } from "./dom.js";

/** Wire the common workbench header and its accessible, per-tab Help dock. */
export function bindToolHelp(slug: string): void {
  bindThemeToggle(byId("theme-toggle"));
  const dock = bindDock(byId("help"), byId("help-toggle"), { key: `tools.${slug}.help` });
  byId("help").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dock.setOpen(false);
      byId("help-toggle").focus();
    }
  });
  dock.restore();
}

export function showMessage(element: HTMLElement, message: string, error = false): void {
  element.textContent = message;
  element.dataset.error = String(error);
}
