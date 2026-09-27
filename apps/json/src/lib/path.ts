/**
 * Where a value sits in a document, as a path of keys and indices, and the two ways of
 * writing one down: JavaScript (`data.shapes[3].id`) and JSON Pointer (`/data/shapes/3/id`).
 */
import type { JsonNode } from "./ast.js";

export type PathSegment = string | number;

/**
 * A container's children with the path segment that reaches each (key or index), and where
 * each starts in the text: a member at its key, an item at its value.
 */
export function childrenOf(node: JsonNode): { seg: PathSegment; node: JsonNode; at: number }[] {
  if (node.kind === "object") {
    return node.members.map((m) => ({ seg: m.key, node: m.value, at: m.keyStart }));
  }
  if (node.kind === "array") return node.items.map((v, k) => ({ seg: k, node: v, at: v.start }));
  return [];
}

export interface Located {
  node: JsonNode;
  path: PathSegment[];
  /**
   * The child position at each step. Unlike keys, positions are unambiguous when an object
   * repeats a key, so the tree follows these.
   */
  indices: number[];
}

/** The deepest value at `offset`, and the path to it. A key belongs to its value. */
export function nodeAt(root: JsonNode, offset: number): Located {
  const path: PathSegment[] = [];
  const indices: number[] = [];
  let node = root;
  for (;;) {
    if (node.kind === "object") {
      const k = node.members.findIndex((m) => m.keyStart <= offset && offset <= m.value.end);
      if (k < 0) break;
      path.push(node.members[k].key);
      indices.push(k);
      node = node.members[k].value;
    } else if (node.kind === "array") {
      const k = node.items.findIndex((v) => v.start <= offset && offset <= v.end);
      if (k < 0) break;
      path.push(k);
      indices.push(k);
      node = node.items[k];
    } else {
      break;
    }
  }
  return { node, path, indices };
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
