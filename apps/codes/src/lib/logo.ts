/**
 * The preset logos: a shared icon in white on a disc of the code's colour, as SVG markup in a
 * 24 × 24 box. Drawn into the code as vector rather than as an image, so the preview never
 * waits for one to decode, and a change of colour is a change of one attribute.
 */
import { ICONS, escapeAttr } from "@tools/ui";
import type { IconName } from "@tools/ui";
import type { Logo } from "./design.js";

export const LOGOS: readonly IconName[] = [
  "link",
  "mail",
  "phone",
  "message",
  "chat",
  "wifi",
  "contact",
  "calendar",
];

export function presetLogo(name: IconName, fill: string): Logo {
  return {
    markup:
      `<circle cx="12" cy="12" r="12" fill="${escapeAttr(fill)}"/>` +
      `<g transform="translate(5 5) scale(0.5833)" color="#fff">${ICONS[name]}</g>`,
    width: 24,
    height: 24,
  };
}

/** The logo as a standalone SVG, for a picture of it (a button's). */
export const logoSvg = (logo: Logo): string =>
  `<svg viewBox="0 0 ${logo.width} ${logo.height}" aria-hidden="true">${logo.markup ?? ""}</svg>`;
