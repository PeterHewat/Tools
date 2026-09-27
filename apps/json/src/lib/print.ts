/**
 * Writes a parsed document back out, formatted or minified, from its source text.
 *
 * Numbers and strings are copied as they were written, so nothing is rounded or re-escaped:
 * a 64-bit ID, `1.0` and `"é"` come out exactly as they went in. Keys keep their order
 * (and duplicates stay, both of them) unless sorting is asked for. The layout is the one
 * `JSON.stringify` produces, so the output looks familiar.
 */
import type { JsonNode, Member } from "./ast.js";

export interface PrintOptions {
  /** Spaces per level, "\t" for tabs, or 0 for one line. Defaults to 2. */
  indent?: number | "\t";
  /** Sort object keys at every depth. Stable, so duplicate keys keep their order. */
  sortKeys?: boolean;
}

const byKey = (a: Member, b: Member) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** A loop over an explicit stack, like the parser, so depth never overflows it. */
export function printJson(
  root: JsonNode,
  { indent = 2, sortKeys = false }: PrintOptions = {}
): string {
  const unit = typeof indent === "string" ? indent : " ".repeat(indent);
  const newline = unit ? "\n" : "";
  const colon = unit ? ": " : ":";
  const pads: string[] = [""];
  const pad = (level: number) => (pads[level] ??= unit.repeat(level));

  const out: string[] = [];
  // Pending work, popped from the end: literal text, or a node still to write at a depth.
  const work: (string | [JsonNode, number])[] = [[root, 0]];
  while (work.length) {
    const item = work.pop()!;
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    const [node, level] = item;
    if (node.kind !== "object" && node.kind !== "array") {
      out.push(node.raw);
      continue;
    }
    const [open, closer] = node.kind === "object" ? ["{", "}"] : ["[", "]"];
    const children: [string, JsonNode][] =
      node.kind === "object"
        ? (sortKeys ? [...node.members].sort(byKey) : node.members).map((m) => [
            m.keyRaw + colon,
            m.value,
          ])
        : node.items.map((v) => ["", v]);
    if (!children.length) {
      out.push(open + closer);
      continue;
    }
    const inner = pad(level + 1);
    const seq: (string | [JsonNode, number])[] = [open + newline];
    children.forEach(([prefix, child], k) => {
      seq.push(inner + prefix, [child, level + 1]);
      seq.push((k < children.length - 1 ? "," : "") + newline);
    });
    seq.push(pad(level) + closer);
    for (let k = seq.length - 1; k >= 0; k--) work.push(seq[k]);
  }
  return out.join("");
}
