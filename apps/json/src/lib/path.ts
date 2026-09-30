/**
 * Where a value sits in a document, as a path of keys and indices, and the two ways of
 * writing one down: JavaScript (`data.shapes[3].id`) and JSON Pointer (`/data/shapes/3/id`).
 */
import type { JsonNode } from "./ast.js";

export type PathSegment = string | number;

export interface Located {
  node: JsonNode;
  path: PathSegment[];
  /** The values from the root down to `node`, both included. */
  chain: JsonNode[];
}

/** The deepest value at `offset`, and the path to it. A key belongs to its value. */
export function nodeAt(root: JsonNode, offset: number): Located {
  const path: PathSegment[] = [];
  const chain: JsonNode[] = [root];
  let node = root;
  for (;;) {
    if (node.kind === "object") {
      const k = node.members.findIndex((m) => m.keyStart <= offset && offset <= m.value.end);
      if (k < 0) break;
      path.push(node.members[k].key);
      node = node.members[k].value;
      chain.push(node);
    } else if (node.kind === "array") {
      const k = node.items.findIndex((v) => v.start <= offset && offset <= v.end);
      if (k < 0) break;
      path.push(k);
      node = node.items[k];
      chain.push(node);
    } else {
      break;
    }
  }
  return { node, path, chain };
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
