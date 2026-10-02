#!/usr/bin/env bun
/**
 * Writes the Codes app's index card art (`apps/codes/public/art.svg`): the app's example code
 * (`EXAMPLE`, which a new tab starts with too), drawn by the app's own renderer, so the card and
 * the app always show the same code. Run it again after changing either:
 * `bun scripts/codes-art.ts`.
 */
import { join } from "node:path";
import { encodeQr } from "../apps/codes/src/lib/qr.ts";
import { EXAMPLE, qrScene } from "../apps/codes/src/lib/design.ts";
import { presetLogo } from "../apps/codes/src/lib/logo.ts";
import { sceneSvg } from "../apps/codes/src/lib/render.ts";

const design = { ...EXAMPLE.design, logo: presetLogo(EXAMPLE.logo, EXAMPLE.design.foreground) };
// A logo means error correction H, as in the app.
const scene = qrScene(encodeQr(EXAMPLE.link, "H"), design);

// The code, 232 wide, in the middle of the 320 × 320 card.
const width = 232,
  height = Math.round((width * scene.height) / scene.width);
const x = (320 - width) / 2,
  y = (320 - height) / 2;
const code = sceneSvg(scene, { width, height, perModule: 0 }).replace(
  `<svg xmlns="http://www.w3.org/2000/svg"`,
  `<svg x="${x}" y="${y}"`
);

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">` +
  `<defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#5b8def" stop-opacity=".16"/><stop offset="1" stop-color="#5b8def" stop-opacity=".04"/></linearGradient></defs>` +
  `<rect width="320" height="320" fill="url(#b)"/>` +
  // A soft shadow under the card, so it lifts off either theme.
  `<rect x="${x + 4}" y="${y + 8}" width="${width - 8}" height="${height - 4}" rx="16" fill="#1d2440" opacity=".18"/>` +
  code +
  `</svg>\n`;

await Bun.write(join(import.meta.dir, "..", "apps", "codes", "public", "art.svg"), svg);
console.log(`apps/codes/public/art.svg: ${svg.length} bytes`);
