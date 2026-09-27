/**
 * The arrays a document could be turned into a CSV table from, for the CSV view's picker.
 *
 * Nearest the root first, in document order at each depth. Inside an array only its first item
 * is looked into: the same nested array in every row of a big table is one choice, not
 * thousands.
 */
import type { JsonNode } from "./ast.js";
import type { PathSegment } from "./path.js";

export interface Table {
  node: JsonNode & { kind: "array" };
  path: PathSegment[];
  /** Holds objects: rows with named columns, a table proper. */
  objects: boolean;
}

/** Past this many, the picker would be no use: the rest are left out. */
export const MAX_TABLES = 100;

export function tablesIn(root: JsonNode): Table[] {
  const found: Table[] = [];
  const queue: { node: JsonNode; path: PathSegment[] }[] = [{ node: root, path: [] }];
  for (let k = 0; k < queue.length && found.length < MAX_TABLES; k++) {
    const { node, path } = queue[k];
    if (node.kind === "array") {
      found.push({ node, path, objects: node.items.some((i) => i.kind === "object") });
      if (node.items.length) queue.push({ node: node.items[0], path: [...path, 0] });
    } else if (node.kind === "object") {
      for (const m of node.members) queue.push({ node: m.value, path: [...path, m.key] });
    }
  }
  return found;
}

/** The table to show when nothing says otherwise: the first of objects, else the first. */
export function defaultTable(tables: readonly Table[]): Table | undefined {
  return tables.find((t) => t.objects) ?? tables[0];
}
