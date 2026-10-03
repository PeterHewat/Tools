/**
 * Exporting the drawing as a PNG, at the artboard's own size: one pixel to a unit. Anything else -
 * an icon at several sizes - is a job for the SVG, or for a tool made to resize.
 *
 * The picture is the exported SVG itself, drawn by @tools/ui's `renderPng` onto a canvas of that
 * size - so it shows exactly what the SVG does, transparent where the document is.
 */

import { MAX_ARTBOARD } from "./types.js";

/** The pixel size of the artboard: whole pixels, from one to `MAX_ARTBOARD`. */
export function pngSize(artboard: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.min(MAX_ARTBOARD, Math.max(1, Math.round(artboard.width))),
    height: Math.min(MAX_ARTBOARD, Math.max(1, Math.round(artboard.height))),
  };
}
