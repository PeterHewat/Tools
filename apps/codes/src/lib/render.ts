/** A scene (`design.ts`) as SVG, or drawn on a canvas for PNG: the same picture either way. */
import { escapeAttr, escapeXml } from "@tools/ui";
import type { Paint, Scene } from "./design.js";

export interface Size {
  width: number;
  height: number;
}
/** The export's size in pixels for a width, its height following the scene's proportions. */
export function exportSize(scene: Scene, width: number): Size {
  if (!Number.isInteger(width) || width < 64 || width > 4096)
    throw new Error("Export width must be an integer from 64 to 4096 pixels.");
  const minimum = Math.ceil(scene.width);
  if (width < minimum)
    throw new Error(`Increase export width to at least ${minimum} pixels for this code.`);
  return { width, height: Math.round((width * scene.height) / scene.width) };
}

const n3 = (value: number) => String(Math.round(value * 1000) / 1000);

export function sceneSvg(scene: Scene, width: number): string {
  const size = exportSize(scene, width);
  const defs: string[] = [];
  const fill = (paint: Paint) => {
    if (typeof paint === "string") return escapeAttr(paint);
    const id = "g" + defs.length;
    const stops = `<stop offset="0" stop-color="${escapeAttr(paint.from)}"/><stop offset="1" stop-color="${escapeAttr(paint.to)}"/>`;
    defs.push(
      paint.kind === "linear"
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n3(paint.x1)}" y1="${n3(paint.y1)}" x2="${n3(paint.x2)}" y2="${n3(paint.y2)}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n3(paint.x1)}" cy="${n3(paint.y1)}" r="${n3(paint.r)}">${stops}</radialGradient>`
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
    const { href, x, y, width: w, height: h } = scene.image;
    body.push(
      `<image xlink:href="${escapeAttr(href)}" x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" preserveAspectRatio="xMidYMid meet"/>`
    );
  }
  if (scene.caption) {
    const c = scene.caption;
    body.push(
      `<text x="${n3(c.x)}" y="${n3(c.y)}" font-family="${escapeAttr(c.font)}" font-size="${n3(c.size)}" font-weight="${c.weight}" text-anchor="middle" fill="${escapeAttr(c.color)}">${escapeXml(c.text)}</text>`
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    (scene.image ? ` xmlns:xlink="http://www.w3.org/1999/xlink"` : "") +
    ` width="${size.width}" height="${size.height}" viewBox="0 0 ${n3(scene.width)} ${n3(scene.height)}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    "</svg>"
  );
}

/**
 * Draws the scene at its export size. A module is a whole number of pixels, so square modules
 * stay sharp; the pixels to spare go around the code, in its background.
 */
export function drawScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  size: Size,
  image?: CanvasImageSource
): void {
  const scale = Math.max(1, Math.floor(size.width / scene.width));
  const ox = Math.floor((size.width - scene.width * scale) / 2),
    oy = Math.max(0, Math.floor((size.height - scene.height * scale) / 2));
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  if (scene.background) {
    context.fillStyle = scene.background;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.setTransform(scale, 0, 0, scale, ox, oy);
  const paint = (value: Paint): string | CanvasGradient => {
    if (typeof value === "string") return value;
    const gradient =
      value.kind === "linear"
        ? context.createLinearGradient(value.x1, value.y1, value.x2, value.y2)
        : context.createRadialGradient(value.x1, value.y1, 0, value.x1, value.y1, value.r);
    gradient.addColorStop(0, value.from);
    gradient.addColorStop(1, value.to);
    return gradient;
  };
  for (const layer of scene.layers) {
    if (!layer.d) continue;
    context.fillStyle = paint(layer.paint);
    context.fill(new Path2D(layer.d), layer.evenOdd ? "evenodd" : "nonzero");
  }
  if (scene.image && image) {
    const { x, y, width, height } = scene.image;
    context.drawImage(image, x, y, width, height);
  }
  if (scene.caption) {
    const c = scene.caption;
    context.font = `${c.weight} ${c.size}px ${c.font}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillStyle = c.color;
    context.fillText(c.text, c.x, c.y);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}
