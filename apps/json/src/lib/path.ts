/**
 * Where a value sits in a document, as a path of keys and indices, and the two ways of
 * writing one down: JavaScript (`data.shapes[3].id`) and JSON Pointer (`/data/shapes/3/id`).
 */
import type { JsonNode } from "./ast.js";

export type PathSegment = string | number;

/** The deepest value at `offset`, and the path to it. A key belongs to its value. */
export function nodeAt(root: JsonNode, offset: number): { node: JsonNode; path: PathSegment[] } {
  const path: PathSegment[] = [];
  let node = root;
  for (;;) {
    if (node.kind === "object") {
      const member = node.members.find((m) => m.keyStart <= offset && offset <= m.value.end);
      if (!member) break;
      path.push(member.key);
      node = member.value;
    } else if (node.kind === "array") {
      const index = node.items.findIndex((v) => v.start <= offset && offset <= v.end);
      if (index < 0) break;
      path.push(index);
      node = node.items[index];
    } else {
      break;
    }
  }
  return { node, path };
}

/** Follows a path down from the root; undefined when the document has no such value. */
export function nodeAtPath(root: JsonNode, path: readonly PathSegment[]): JsonNode | undefined {
  let node: JsonNode | undefined = root;
  for (const seg of path) {
    if (node?.kind === "object") node = node.members.findLast((m) => m.key === seg)?.value;
    else if (node?.kind === "array" && typeof seg === "number") node = node.items[seg];
    else return undefined;
  }
  return node;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** `data.shapes[3].id`, with bracket quotes for keys that are not identifiers. Empty at the root. */
export function jsPath(path: readonly PathSegment[]): string {
  return path
    .map((seg, k) =>
      typeof seg === "number"
        ? `[${seg}]`
        : IDENT.test(seg)
          ? (k ? "." : "") + seg
          : `[${JSON.stringify(seg)}]`
    )
    .join("");
}

/** RFC 6901: `/data/shapes/3/id`, with `~` and `/` escaped. Empty at the root. */
export function jsonPointer(path: readonly PathSegment[]): string {
  return path.map((seg) => "/" + String(seg).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}
