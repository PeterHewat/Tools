/**
 * The icons every Tools app draws the same: one set, so Help, Search, Copy and the rest look
 * alike wherever they appear.
 *
 * Each is the inside of a 24 × 24 `<svg>`, with its paint on the elements themselves, so it draws
 * the same inline or as a sprite `<symbol>`, whatever the page's CSS says about fill and stroke.
 * In a page's markup, an empty `<svg data-ui-icon="help"></svg>` (or `<symbol>`) is filled in
 * at build time by `withIcons` (see vite.ts); code that builds buttons uses `iconSvg`.
 *
 * Imported by the Vite config as well as by pages, so it imports nothing.
 */

const LINE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** Stroked outlines, plus the odd filled dot. */
const line = (inner: string, dots = "") => `<g ${LINE}>${inner}</g>${dots}`;
const dot = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  help: line(
    '<path d="M8.6 8.8a3.5 3.5 0 1 1 4.7 3.3c-.9.4-1.3 1-1.3 1.9v.6"/>',
    dot(12, 18.4, 1.3)
  ),
  search: line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>'),
  import: line('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  export: line('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'),
  copy: line(
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'
  ),
  trash: line(
    '<path d="M3 6h18M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>'
  ),
  close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
  settings: line(
    '<path d="M18.99 10.26 21.35 10.33 21.35 13.67 18.99 13.74 18.17 15.71 19.79 17.43 17.43 19.79 15.71 18.17 13.74 18.99 13.67 21.35 10.33 21.35 10.26 18.99 8.29 18.17 6.57 19.79 4.21 17.43 5.83 15.71 5.01 13.74 2.65 13.67 2.65 10.33 5.01 10.26 5.83 8.29 4.21 6.57 6.57 4.21 8.29 5.83 10.26 5.01 10.33 2.65 13.67 2.65 13.74 5.01 15.71 5.83 17.43 4.21 19.79 6.57 18.17 8.29Z"/><circle cx="12" cy="12" r="3"/>'
  ),
  more: dot(5, 12, 1.7) + dot(12, 12, 1.7) + dot(19, 12, 1.7),
  "chevron-up": line('<path d="M6 15l6-6 6 6"/>'),
  "chevron-down": line('<path d="M6 9l6 6 6-6"/>'),
  "chevron-right": line('<path d="M9 6l6 6-6 6"/>'),
  "expand-all": line('<path d="M17 16l-5 5-5-5M7 8l5-5 5 5"/>'),
  "collapse-all": line('<path d="M7 20l5-5 5 5M17 4l-5 5-5-5"/>'),
  /** The theme switch shows the theme it switches to (see theme.ts). */
  sun: line(
    '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>'
  ),
  moon: line('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
} as const;

export type IconName = keyof typeof ICONS;

const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** An icon as an element, for code that builds its own buttons. */
export function iconSvg(name: IconName, className = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

/** The attribute that asks the build to draw an icon into an empty `<svg>` or `<symbol>`. */
const ICON_ATTR = "data-ui-icon";

/**
 * Fills every empty `<svg data-ui-icon="…">` and `<symbol data-ui-icon="…">` in a page with its
 * icon, giving it the icon's viewBox where it has none. An unknown name fails the build rather
 * than shipping a blank button.
 */
export function withIcons(html: string): string {
  // A scan in steps, each a pattern with a single unbounded part, rather than one pattern for the
  // whole element: that one could backtrack for a long time over a tag repeating the attribute.
  let out = "";
  let done = 0;
  for (const open of html.matchAll(/<(svg|symbol)\b([^>]*)>/g)) {
    const [whole, tag, attrs] = open as unknown as [string, string, string];
    const name = /\sdata-ui-icon="([^"]*)"/.exec(attrs)?.[1];
    if (name === undefined) continue;
    // Only an empty element is filled: nothing but white space before its closing tag.
    const start = open.index + whole.length;
    const lt = html.indexOf("<", start);
    const close = `</${tag}>`;
    if (lt < 0 || html.slice(start, lt).trim() || !html.startsWith(close, lt)) continue;
    if (!isIconName(name)) throw new Error(`Unknown icon "${name}" in ${ICON_ATTR}`);
    const box = /\sviewBox=/.test(attrs) ? "" : ' viewBox="0 0 24 24"';
    out += `${html.slice(done, open.index)}<${tag}${attrs}${box}>${ICONS[name]}${close}`;
    done = lt + close.length;
  }
  return out + html.slice(done);
}
