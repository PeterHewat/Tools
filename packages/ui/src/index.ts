/** Browser helpers shared by every Tools app. */

export * from "./dom.js";
export * from "./icons.js";
export * from "./menu.js";
export * from "./panel.js";
export * from "./storage.js";
export * from "./theme.js";
export * from "./tool.js";
export * from "./draft.js";
export * from "./color.js";
export * from "./color-picker.js";
export * from "./png.js";

declare global {
  interface ImportMetaEnv {
    /** The site root, e.g. `/Tools/`: set by `@tools/ui/vite` for every page it builds. */
    readonly TOOLS_SITE_BASE?: string;
  }
}

/**
 * Registers the site's service worker, so every tool keeps working offline.
 *
 * There is one, at the site root (see `site-worker.ts`): whichever page a visit starts on, it
 * precaches the index and every app. These are tools people return to, and several keep their
 * data in the browser, so a tool that needs the network to open is a worse tool. Silently does
 * nothing where service workers are unavailable (private windows, `file://`, plain http, older
 * browsers) — the app still runs. Skipped under the dev server, whose modules must never come
 * from a cache.
 */
export function registerServiceWorker(): void {
  if (import.meta.env?.DEV) return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const root = import.meta.env?.TOOLS_SITE_BASE ?? "/";
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${root}sw.js`, { scope: root }).catch(() => {
      /* offline support is a bonus, never a hard requirement */
    });
  });
}
