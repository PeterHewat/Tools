/**
 * What the JSON tool says about a document beyond "valid": where an error sits on its line,
 * and how big it is.
 *
 * Plain functions over strings and parsed values, so they are tested without a DOM.
 */
import type { JsonPosition } from "@workbench/codec";

export interface Excerpt {
  /** The offending line, clipped around the error when it is long. Tabs shown as one space. */
  line: string;
  /** Spaces then `^`, lined up under the error in a monospace font. */
  caret: string;
}

/** The line holding `position`, with a caret under its column: what a compiler would print. */
export function excerptAt(text: string, position: JsonPosition, width = 80): Excerpt {
  const start = position.offset - (position.column - 1);
  const newline = text.indexOf("\n", start);
  let line = text.slice(start, newline < 0 ? text.length : newline).replace(/\r$/, "");
  let col = position.column - 1;

  if (line.length > width) {
    const from = Math.max(0, Math.min(col - Math.floor(width / 2), line.length - width));
    const head = from > 0 ? "…" : "";
    const tail = from + width < line.length ? "…" : "";
    line = head + line.slice(from, from + width) + tail;
    col = col - from + head.length;
  }
  return { line: line.replace(/\t/g, " "), caret: " ".repeat(Math.max(0, col)) + "^" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
