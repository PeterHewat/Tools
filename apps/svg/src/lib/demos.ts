/**
 * Demo drawings: a few finished pieces added to the Documents list, to show what the app draws
 * and to take apart. Each is a file in the app's `public/`, written as the app exports it, so it
 * opens exactly as drawn: smooth curves on few points, shapes cut and joined with Combine,
 * gradients that fade out.
 *
 * The first is the drawing a first visit opens on: `art.svg`, the same file the index page shows
 * across the top of the SVG app's card, so there is one picture to keep, not two. An isometric
 * workbench whose named groups (desk, laptop, ruler, pencil, mug, plant) read like a layers list.
 *
 * This list is the one place a demo is named: its file, its name in the list, and its tags.
 */

import { importSvgFile, serializeProject } from "./io.js";
import { createInitialState } from "./state.js";
import type { ProjectFile } from "./types.js";

export interface Demo {
  /** The file, from the app's `public/`, and what a browser remembers it by once added. */
  file: string;
  name: string;
  tags: string[];
}

export const DEMOS: readonly Demo[] = [
  { file: "art.svg", name: "Workbench", tags: ["isometric", "desk", "gradient"] },
  { file: "demos/jellyfish.svg", name: "Jellyfish", tags: ["sea", "gradient", "cute"] },
  { file: "demos/goldfish.svg", name: "Goldfish", tags: ["fish", "gradient", "cute"] },
  { file: "demos/starfish.svg", name: "Starfish", tags: ["sea", "outline", "cute"] },
  { file: "demos/crab.svg", name: "Crab", tags: ["sea", "crustacean", "outline", "cute"] },
  { file: "demos/octopus.svg", name: "Octopus", tags: ["sea", "outline", "cute"] },
];

/** The name of a demo's backdrop: the gradient behind the drawing, filling the artboard. */
export const BACKDROP_NAME = "backdrop";

/**
 * The drawing with its backdrop locked, so taking it apart never grabs what is behind it. The
 * lock is the document's, as the SVG cannot carry one.
 */
function withBackdropLocked<T extends { name: string; locked?: boolean }>(
  elements: readonly T[]
): T[] {
  return elements.map((e) => (e.name === BACKDROP_NAME ? { ...e, locked: true } : e));
}

/**
 * A demo's file as a document, ready to store, its backdrop locked. Throws when the file cannot
 * be read.
 */
export function demoDocument(svg: string): ProjectFile {
  const { artboard, background, elements, groupNames } = importSvgFile(svg);
  const base = createInitialState();
  return serializeProject({
    ...base,
    artboard: artboard ?? base.artboard,
    background: background ?? base.background,
    elements: withBackdropLocked(elements),
    groupNames,
  });
}

/** Where a demo is fetched from: the app's own folder, precached for offline with the build. */
export const demoUrl = (d: Demo): string => `${import.meta.env.BASE_URL}${d.file}`;

/**
 * The demos a browser has not been given yet. Added ones are remembered by file, so one that is
 * deleted stays deleted, and a demo added to this list later still reaches everyone.
 */
export function demosToAdd(given: readonly string[]): Demo[] {
  return DEMOS.filter((d) => !given.includes(d.file));
}
