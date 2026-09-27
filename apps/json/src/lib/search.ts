/**
 * Finding things in a document: plain text matches for the text view, and keys or values for
 * the tree. Both stop counting at {@link MAX_MATCHES}, so a one-letter search in a large
 * document answers at once.
 */
import type { JsonNode } from "./ast.js";

export const MAX_MATCHES = 10_000;

export interface FindOptions {
  matchCase?: boolean;
}

/** Offsets where `query` starts in `text`, in order, without overlaps. */
export function findInText(
  text: string,
  query: string,
  { matchCase = false }: FindOptions = {}
): number[] {
  if (!query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const found: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0 && found.length < MAX_MATCHES;) {
    found.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return found;
}

export interface NodeMatch {
  node: JsonNode;
  /** Child positions from the root, as the tree follows them. */
  indices: number[];
}

/**
 * Values whose key contains `query`, or which are scalars whose text contains it (strings
 * without their quotes). In document order.
 */
export function findInTree(
  root: JsonNode,
  query: string,
  { matchCase = false }: FindOptions = {}
): NodeMatch[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const has = (s: string) => (matchCase ? s : s.toLowerCase()).includes(needle);
  const found: NodeMatch[] = [];
  // Children pushed in reverse, so popping visits them in document order.
  const stack: [JsonNode, number[], string | null][] = [[root, [], null]];
  while (stack.length && found.length < MAX_MATCHES) {
    const [node, indices, key] = stack.pop()!;
    const text = node.kind === "string" ? node.raw.slice(1, -1) : "raw" in node ? node.raw : "";
    if ((key !== null && has(key)) || (text && has(text))) found.push({ node, indices });
    if (node.kind === "object") {
      for (let k = node.members.length - 1; k >= 0; k--) {
        stack.push([node.members[k].value, [...indices, k], node.members[k].key]);
      }
    } else if (node.kind === "array") {
      for (let k = node.items.length - 1; k >= 0; k--)
        stack.push([node.items[k], [...indices, k], null]);
    }
  }
  return found;
}
