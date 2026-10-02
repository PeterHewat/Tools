#!/usr/bin/env bun
/**
 * Writes the Codes app's index card art (`apps/codes/public/art.svg`) with the app's own
 * renderer: a styled, framed QR code that scans. Run it again after changing how codes look:
 * `bun scripts/codes-art.ts`.
 */
import { join } from "node:path";
import { ICONS } from "../packages/ui/src/icons.ts";
import { encodeQr } from "../apps/codes/src/lib/qr.ts";
import { DEFAULT_DESIGN, qrScene } from "../apps/codes/src/lib/design.ts";
import type { Paint } from "../apps/codes/src/lib/design.ts";

const BLUE = "#4f86e8",
  VIOLET = "#8a5cf0";
// The logo is drawn here as vector paths rather than the app's image, so the art stays small.
const scene = qrScene(encodeQr("https://peterhewat.github.io/Tools/", "H"), {
  ...DEFAULT_DESIGN,
  foreground: BLUE,
  gradient: { to: VIOLET, kind: "diagonal" },
  modules: "rounded",
  eyeFrame: "leaf",
  eyeBall: "leaf",
  frame: "below",
  caption: "SCAN ME",
  frameColor: "#5b6fe6",
  logo: { href: "", width: 1, height: 1 },
});

// The code, 232 wide, in the middle of the 320 × 320 card.
const width = 232,
  height = Math.round((width * scene.height) / scene.width);
const x = (320 - width) / 2,
  y = (320 - height) / 2;
let defs = "";
const fill = (paint: Paint) => {
  if (typeof paint === "string") return paint;
  if (!defs)
    defs = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${paint.x1}" y1="${paint.y1}" x2="${paint.x2}" y2="${paint.y2}"><stop stop-color="${paint.from}"/><stop offset="1" stop-color="${paint.to}"/></linearGradient>`;
  return "url(#g)";
};
const layers = scene.layers
  .map(
    (layer) =>
      `<path d="${layer.d}" fill="${fill(layer.paint)}"${layer.evenOdd ? ' fill-rule="evenodd"' : ""}/>`
  )
  .join("");
const image = scene.image!;
const r = image.width / 2;
const logo =
  `<circle cx="${image.x + r}" cy="${image.y + r}" r="${r}" fill="${VIOLET}"/>` +
  `<svg x="${image.x + r * 0.25}" y="${image.y + r * 0.25}" width="${r * 1.5}" height="${r * 1.5}" viewBox="0 0 24 24" color="#fff">${ICONS.link}</svg>`;
const c = scene.caption!;
const caption = `<text x="${c.x}" y="${c.y}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${c.size}" font-weight="700" text-anchor="middle" fill="${c.color}" letter-spacing="${Math.round(c.size / 12)}">${c.text}</text>`;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">` +
  `<defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#5b8def" stop-opacity=".16"/><stop offset="1" stop-color="#5b8def" stop-opacity=".04"/></linearGradient>${defs}</defs>` +
  `<rect width="320" height="320" fill="url(#b)"/>` +
  // A soft shadow under the card, so it lifts off either theme.
  `<rect x="${x + 4}" y="${y + 8}" width="${width - 8}" height="${height - 4}" rx="16" fill="#1d2440" opacity=".18"/>` +
  `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${scene.width} ${scene.height}">` +
  layers +
  logo +
  caption +
  `</svg></svg>\n`;

await Bun.write(join(import.meta.dir, "..", "apps", "codes", "public", "art.svg"), svg);
console.log(`apps/codes/public/art.svg: ${svg.length} bytes`);
