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

/** UTF-8 length without encoding: what `TextEncoder` would produce, lone surrogates as U+FFFD. */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * The size in bytes `printJson` would produce, counted without building the text. The status
 * line shows both sizes after every pause in typing; on a document of megabytes, printing it
 * twice to measure it would stall the page.
 */
export function printedSize(root: JsonNode, { indent = 2 }: PrintOptions = {}): number {
  const unit = typeof indent === "string" ? indent.length : indent;
  let size = 0;
  const stack: [JsonNode, number][] = [[root, 0]];
  while (stack.length) {
    const [node, level] = stack.pop()!;
    if (node.kind !== "object" && node.kind !== "array") {
      size += utf8Length(node.raw);
      continue;
    }
    const n = node.kind === "object" ? node.members.length : node.items.length;
    size += 2; // brackets
    if (!n) continue;
    size += n - 1; // commas
    if (node.kind === "object") {
      for (const m of node.members) {
        size += utf8Length(m.keyRaw) + (unit ? 2 : 1); // key, then ": " or ":"
        stack.push([m.value, level + 1]);
      }
    } else {
      for (const v of node.items) stack.push([v, level + 1]);
    }
    // A line break after the opening bracket and after each child, each child's indent, and
    // the closing bracket's indent.
    if (unit) size += 1 + n * (unit * (level + 1) + 1) + unit * level;
  }
  return size;
}
