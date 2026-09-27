/**
 * JSON stored inside a string — a common sight in logs, message queues and API payloads,
 * where a document was stringified before being embedded — unwrapped into real JSON, and the
 * reverse.
 */
import { parse, type JsonNode } from "./ast.js";
import { printJson, type PrintOptions } from "./print.js";

/**
 * The document with the string `node` replaced by the JSON it holds, laid out to sit at the
 * string's depth; null when the string does not hold a JSON object or array.
 */
export function unwrapString(
  text: string,
  node: JsonNode,
  indent: PrintOptions["indent"] = 2
): string | null {
  if (node.kind !== "string") return null;
  const inner = parse(JSON.parse(node.raw) as string);
  if (!inner.ok || inner.edits.length) return null;
  if (inner.root.kind !== "object" && inner.root.kind !== "array") return null;
  // Minified text stays minified. Otherwise indent like the document already is (its first
  // indented line is one level deep), falling back to `indent`, and start at the string's line.
  const oneLine = !text.includes("\n");
  const unit = /\n([ \t]+)\S/.exec(text)?.[1];
  const lineStart = text.lastIndexOf("\n", node.start - 1) + 1;
  const lead = /^[ \t]*/.exec(text.slice(lineStart, node.start))![0];
  const layout = oneLine ? 0 : unit ? (unit[0] === "\t" ? "\t" : unit.length) : indent;
  const printed = printJson(inner.root, { indent: layout }).replace(/\n/g, `\n${lead}`);
  return text.slice(0, node.start) + printed + text.slice(node.end);
}

/** The document with `node` replaced by a string holding its JSON, minified. */
export function wrapAsString(text: string, node: JsonNode): string {
  return (
    text.slice(0, node.start) +
    JSON.stringify(printJson(node, { indent: 0 })) +
    text.slice(node.end)
  );
}
