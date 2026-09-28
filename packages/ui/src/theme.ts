/**
 * Light and dark, shared by every Tools page.
 *
 * Until someone chooses, a page follows the browser (`prefers-color-scheme`). The first press of
 * a toggle stores a choice, and from then on it is light or dark: there is deliberately no way
 * back to "follow the browser", because a three-way switch is one more state to explain for a
 * setting people pick once. The choice lives under one key for the whole site, so every app
 * opens in the theme the last one was left in.
 *
 * The stored choice is written to `<html data-theme>`; the shared CSS keys its light tokens off
 * that attribute or, when it is absent, off the media query.
 */

// By package name, not "./icons.js": the Vite config loads this file too (see vite.ts).
import { ICONS } from "@tools/ui/icons";

export type Theme = "light" | "dark";

export const THEME_KEY = "tools.theme";

/** Fired on `window` whenever the theme in effect changes, however it changed. */
export const THEME_EVENT = "tools:theme";

/**
 * Inlined into every page's `<head>` by the Vite plugin, so a stored theme applies before the
 * first paint rather than flashing the other one while the module loads. It also sets the
 * page's `color-scheme`, so what the browser paints before the stylesheet (its own background)
 * is the chosen theme's, not the system's.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark"){var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t}}catch(e){}`;

function darkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

/** A choice made where storage is refused: it holds for this page, and is gone on reload. */
let unsaved: Theme | null = null;

/** The theme someone chose, or null while the page still follows the browser. */
export function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* storage refused */
  }
  return unsaved;
}

/** The theme in effect: the stored choice, else the browser's. Dark when neither says. */
export function currentTheme(): Theme {
  const stored = storedTheme();
  if (stored) return stored;
  const q = darkQuery();
  return q && !q.matches ? "light" : "dark";
}

function apply(): void {
  const stored = storedTheme();
  const root = document.documentElement;
  if (stored) root.dataset.theme = stored;
  else delete root.dataset.theme;
  // Set inline before the first paint by THEME_BOOT_SCRIPT, so it must follow every change.
  root.style.colorScheme = stored ?? "";
  // The browser chrome follows the page: the tokens are resolved by now, so read the real one.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && bg) meta.content = bg;
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: currentTheme() }));
}

/** Stores a choice and applies it. Where storage is refused it still applies for this page. */
export function setTheme(theme: Theme): void {
  unsaved = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* applies to this page only */
  }
  apply();
}

let watching = false;

/** Keeps the page in step with the browser's setting and with other open Tools tabs. */
function watch(): void {
  if (watching) return;
  watching = true;
  darkQuery()?.addEventListener("change", () => {
    if (!storedTheme()) apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY) apply();
  });
  apply();
}

/**
 * Makes `button` switch between light and dark. It shows the theme it would switch *to*, and
 * says so in its label. Any number of buttons can be bound; they all stay in step.
 */
export function bindThemeToggle(button: HTMLElement, iconClass = "ui-theme-icon"): void {
  const render = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    const label = `Switch to ${next} theme`;
    // Built as elements: the class is the caller's, and must never be read as markup. Only the
    // two icons, which are constants here, go through innerHTML.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", iconClass);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[next === "light" ? "sun" : "moon"];
    button.replaceChildren(svg);
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  button.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  });
  window.addEventListener(THEME_EVENT, render);
  render();
  watch();
}
