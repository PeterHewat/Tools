/**
 * Colours as the apps write them: "#rrggbb", or "#rrggbbaa" when not fully opaque. Pure
 * functions over strings, shared by the colour picker and anything that checks contrast.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Rgba extends Rgb {
  /** 0 to 1. */
  a: number;
}

/** Reads "#rgb", "#rrggbb" or "#rrggbbaa" (the "#" optional); undefined for anything else. */
export function parseHex(value: string): Rgba | undefined {
  let hex = /^#?([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1];
  if (!hex) return undefined;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

/** "#rrggbb", with "aa" after it only when the colour is not fully opaque. */
export function toHex({ r, g, b, a = 1 }: Rgb & { a?: number }): string {
  const byte = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return "#" + byte(r) + byte(g) + byte(b) + (a < 1 ? byte(a * 255) : "");
}

/** The colour without its alpha, as "#rrggbb", and the alpha (black for anything unreadable). */
export function splitAlpha(value: string): { color: string; alpha: number } {
  const c = parseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  return { color: toHex({ ...c, a: 1 }), alpha: c.a };
}

/** `top` laid over `under` (opaque), as it would be seen. */
export function flatten(top: string, under: string): Rgb {
  const t = parseHex(top) ?? { r: 0, g: 0, b: 0, a: 1 },
    u = parseHex(under) ?? { r: 255, g: 255, b: 255, a: 1 };
  const mix = (a: number, b: number) => a * t.a + b * (1 - t.a);
  return { r: mix(t.r, u.r), g: mix(t.g, u.g), b: mix(t.b, u.b) };
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
