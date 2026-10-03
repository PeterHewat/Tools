/**
 * A scene (`design.ts`) as SVG. The PNG is this SVG drawn at its size (@tools/ui's `renderPng`):
 * each module a whole number of pixels, on whole-unit coordinates, so square edges stay sharp.
 */
import { escapeAttr, escapeXml } from "@tools/ui";
import type { Paint, Scene } from "./design.js";

/** The export sizes, by the width each aims for in pixels. */
export const SIZES = { s: 512, m: 1024, l: 2048 } as const;
export type SizeName = keyof typeof SIZES;

export interface Size {
  width: number;
  height: number;
  /** Pixels to a module: a whole number, so every module edge falls on a pixel edge. */
  perModule: number;
}
/** The size nearest the named one at which each module is a whole number of pixels. */
export function exportSize(scene: Scene, name: SizeName): Size {
  const modules = scene.width / scene.unit;
  const perModule = Math.max(1, Math.round(SIZES[name] / modules));
  return {
    width: perModule * modules,
    height: (perModule * scene.height) / scene.unit,
    perModule,
  };
}

/** The scene as SVG, its width and height those of the export: integers throughout. */
export function sceneSvg(scene: Scene, size: Size): string {
  const defs: string[] = [];
  // Layers that share a gradient (the modules and the corners) share its definition.
  const ids = new Map<Paint, string>();
  const fill = (paint: Paint) => {
    if (typeof paint === "string") return escapeAttr(paint);
    if (ids.has(paint)) return `url(#${ids.get(paint)})`;
    const id = "g" + defs.length;
    ids.set(paint, id);
    const stops = `<stop stop-color="${escapeAttr(paint.from)}"/><stop offset="1" stop-color="${escapeAttr(paint.to)}"/>`;
    defs.push(
      paint.kind === "linear"
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${paint.x1}" y1="${paint.y1}" x2="${paint.x2}" y2="${paint.y2}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${paint.x1}" cy="${paint.y1}" r="${paint.r}">${stops}</radialGradient>`
    );
    return `url(#${id})`;
  };
  const body: string[] = [];
  if (scene.background)
    body.push(`<rect width="100%" height="100%" fill="${escapeAttr(scene.background)}"/>`);
  for (const layer of scene.layers)
    if (layer.d)
      body.push(
        `<path d="${layer.d}" fill="${fill(layer.paint)}"` +
          (layer.evenOdd ? ' fill-rule="evenodd"' : "") +
          (layer.crisp ? ' shape-rendering="crispEdges"' : "") +
          "/>"
      );
  if (scene.image) {
    const { logo, x, y, width, height } = scene.image;
    body.push(
      logo.markup !== undefined
        ? `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${logo.width} ${logo.height}">${logo.markup}</svg>`
        : `<image xlink:href="${escapeAttr(logo.href ?? "")}" x="${x}" y="${y}" width="${width}" height="${height}"/>`
    );
  }
  if (scene.caption) {
    const c = scene.caption;
    body.push(
      `<text x="${c.x}" y="${c.y}" font-family="${escapeAttr(c.font)}" font-size="${c.size}" font-weight="${c.weight}" text-anchor="middle" fill="${escapeAttr(c.color)}">${escapeXml(c.text)}</text>`
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    (scene.image?.logo.href !== undefined ? ` xmlns:xlink="http://www.w3.org/1999/xlink"` : "") +
    ` width="${size.width}" height="${size.height}" viewBox="0 0 ${scene.width} ${scene.height}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    "</svg>"
  );
}
