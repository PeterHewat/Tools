/**
 * The id the artboard background is exported under. It is a plain `<rect>` so the file opens
 * anywhere, and the id is what tells the importer - the live SVG panel, mostly - that this rect
 * is the document's background rather than a shape somebody drew.
 */
export const BACKGROUND_ID = "background";

const AUTO_ID_SRC = "[a-f][0-9a-f]{7}";
export const AUTO_ID = new RegExp(`^${AUTO_ID_SRC}$`);
export const NAMED_ID = new RegExp(`^${AUTO_ID_SRC}_(.+)$`);

/** A user-facing name as it appears in an id: spaces become "_", invalid characters dropped. */
export function sanitizeName(name: string | undefined): string {
  return (name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "");
}

/** The generated-id part of an exported id (`abc12345_name` -> `abc12345`), or null. */
export function elementIdFromSvgId(svgId: string | null | undefined): string | null {
  const m = (svgId || "").match(new RegExp(`^(${AUTO_ID_SRC})(?:_.*)?$`));
  return m ? m[1]! : null;
}

/** A group id as the app writes it, optionally followed by "_" and the group's name. */
export const GROUP_ID = /^(group-[A-Za-z0-9-]+)(?:_(.+))?$/;

/** The group id in an exported `<g id>` (`group-57cc1c37_top_view` -> `group-57cc1c37`). */
export function groupIdFromSvgId(svgId: string | null | undefined): string | null {
  return (svgId || "").match(GROUP_ID)?.[1] ?? null;
}
