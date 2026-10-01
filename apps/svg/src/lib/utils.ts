import { ELEMENT_TYPES, type ElementType, type Point } from "./types.js";

const ELEMENT_TYPE_SET: ReadonlySet<string> = new Set(ELEMENT_TYPES);

/** `path,line,rect,…` — for querySelectorAll on an imported document; a circle is an ellipse. */
export const ELEMENT_SELECTOR = [...ELEMENT_TYPES, "circle"].join(",");

/** Matches a generated default name: "path 1", "rect_2", … */
export const AUTO_NAME_RE = new RegExp(`^(${ELEMENT_TYPES.join("|")})[ _](\\d+)$`);

export function isElementType(type: string): type is ElementType {
  return ELEMENT_TYPE_SET.has(type);
}

/** A name the app generated, as opposed to one the user typed. */
export function isDefaultName(name: string | undefined): boolean {
  return !name || AUTO_NAME_RE.test(name);
}

/** Element ids are 8 hex chars starting with a letter (valid as an XML id); others keep a prefix. */
export function uid(prefix = "el"): string {
  const hex = crypto.randomUUID().slice(0, 8);
  if (ELEMENT_TYPE_SET.has(prefix)) {
    return "abcdef"[parseInt(hex[0]!, 16) % 6] + hex.slice(1);
  }
  return `${prefix}-${hex}`;
}

/** A colour as the app stores it, `#rrggbb`; anything else is black. */
export function cleanColor(c: unknown): string {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#000000";
}

/** An opacity: a finite number held to 0..1, else `fallback`. */
export function cleanUnit(n: unknown, fallback = 1): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export { escapeXml, escapeAttr } from "@tools/ui";
