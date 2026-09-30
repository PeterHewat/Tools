import { completeStyle } from "./model.js";
import { cleanColor, cleanUnit, isElementType } from "./utils.js";
import { ofGroupsInUse } from "./groups.js";
import { MAX_ARTBOARD, PROJECT_VERSION } from "./types.js";
import type { EditorState, ProjectFile, SceneElement } from "./types.js";

export function serializeProject(state: EditorState): ProjectFile {
  return {
    version: PROJECT_VERSION,
    artboard: state.artboard,
    background: state.background,
    grid: state.grid,
    images: state.images,
    elements: state.elements,
    ...optional("groupNames", ofGroupsInUse(state.elements, state.groupNames)),
    ...optional("groupHues", ofGroupsInUse(state.elements, state.groupHues)),
    ...(state.guides.x.length || state.guides.y.length ? { guides: state.guides } : {}),
    tool: state.tool,
    finalOnly: state.finalOnly,
  };
}

/** `{ [key]: record }` when the record has anything in it, else nothing: an optional field. */
function optional<K extends string, T>(key: K, record: Record<string, T>) {
  return Object.keys(record).length ? ({ [key]: record } as Record<K, Record<string, T>>) : {};
}

/** Keys whose strings are the person's own words, escaped wherever they are shown. */
const FREE_TEXT = new Set(["name", "text", "fileName", "fontFamily"]);
const MARKUP = /[<>"&]/;

/**
 * Whether data read from outside - a document file, pasted shapes - holds only plain values.
 * Colours, ids and numbers are written into markup in more places than it is sensible to escape
 * each of them, and a file this app wrote never has markup characters in them; one that does was
 * made to break out of an attribute. Free text may hold anything: it is always escaped.
 */
export function isInert(value: unknown, key = ""): boolean {
  if (typeof value === "string") return FREE_TEXT.has(key) || !MARKUP.test(value);
  // IndexedDB keeps undefined properties and NaN, where JSON would not: neither is markup.
  if (value == null || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every((v) => isInert(v, key));
  if (typeof value !== "object") return false;
  // A group's name is keyed by the group's id, which is checked like any other id.
  const inner = (k: string) => (key === "groupNames" ? "name" : k);
  return Object.entries(value).every(([k, v]) => !MARKUP.test(k) && isInert(v, inner(k)));
}

/** What a reference image may point at: pixels carried in the document, never the network. */
const IMAGE_URL = /^data:image\/[\w.+-]+[;,]/;
/** Element, group and image ids as the app writes them. */
const PLAIN_ID = /^[A-Za-z][\w-]*$/;

/**
 * An element from outside, made safe to draw: its colours are `#rrggbb` and its opacities run
 * 0..1, so neither can carry CSS or a URL into a style or a paint, and a style it lacks is the
 * default one, as every element holds a complete set. Null when its id or type is not one the
 * app writes.
 */
export function cleanElement(raw: unknown): SceneElement | null {
  const el = raw as SceneElement | null;
  if (!el || !PLAIN_ID.test(el.id) || !isElementType(el.type)) return null;
  const out = { ...structuredClone(el), ...completeStyle(el) };
  if (el.groups)
    out.groups = Array.isArray(el.groups)
      ? el.groups.filter((g) => typeof g === "string" && PLAIN_ID.test(g))
      : [];
  return out;
}

/**
 * A stored document, checked and made safe to draw (see `cleanElement`); reference images must
 * be `data:` images. The fields a file may leave out come back filled in. Throws on something that is not a document, on one written by a newer
 * version of the app than this one, and on one with markup hidden in it or nothing usable left.
 */
export function readProject(raw: unknown): Required<ProjectFile> {
  const json = raw as Partial<ProjectFile> | null;
  const version = json?.version;
  const positive = (n: unknown) => typeof n === "number" && n > 0 && Number.isFinite(n);
  if (
    !json ||
    typeof version !== "number" ||
    version < 1 ||
    !positive(json.artboard?.width) ||
    !positive(json.artboard?.height) ||
    !json.grid ||
    !json.background ||
    !Array.isArray(json.elements) ||
    !Array.isArray(json.images)
  ) {
    throw new Error("This is not an SVG app document.");
  }
  if (version > PROJECT_VERSION) {
    throw new Error(
      "This document was saved by a newer version of this app. Reload the page to update, then open it again."
    );
  }
  const damaged = () => new Error("This document is damaged and cannot be opened.");
  if (!isInert(json)) throw damaged();
  const doc = json as ProjectFile;
  const elements = doc.elements.map(cleanElement).filter((e): e is SceneElement => !!e);
  const images = doc.images
    .filter((img) => PLAIN_ID.test(img?.id) && IMAGE_URL.test(img?.dataUrl))
    .map((img) => ({ ...img, opacity: cleanUnit(img.opacity) }));
  if ((doc.elements.length || doc.images.length) && !elements.length && !images.length) {
    throw damaged();
  }
  return {
    ...doc,
    artboard: {
      width: Math.min(doc.artboard.width, MAX_ARTBOARD),
      height: Math.min(doc.artboard.height, MAX_ARTBOARD),
    },
    background: {
      color: cleanColor(doc.background.color),
      opacity: cleanUnit(doc.background.opacity, 0),
    },
    elements,
    images,
    groupNames: doc.groupNames ?? {},
    groupHues: doc.groupHues ?? {},
    guides: doc.guides ?? { x: [], y: [] },
  };
}
