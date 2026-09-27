/**
 * What the JSON tool says about a document, beyond "valid": its size and shape, where an error
 * sits on its line, and which numbers `JSON.parse` could not hold exactly.
 *
 * Plain functions over strings and parsed values, so they are tested without a DOM.
 */
import type { JsonPosition } from "@workbench/codec";

export interface Shape {
  /** Every value, containers included: `{"a":[1,2]}` has four. */
  values: number;
  /** Levels of nesting: 0 for a bare scalar, 1 for `[1]`. */
  depth: number;
  /**
   * Integers outside ±2^53 − 1. `JSON.parse` rounds them to the nearest double, so formatting
   * writes back a different number (64-bit IDs are the usual victims).
   */
  unsafeIntegers: number;
}

/** Walks a parsed value with an explicit stack, so deeply nested input cannot overflow it. */
export function shapeOf(root: unknown): Shape {
  const shape: Shape = { values: 0, depth: 0, unsafeIntegers: 0 };
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [value, level] = stack.pop()!;
    shape.values += 1;
    if (typeof value === "number") {
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) shape.unsafeIntegers += 1;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    shape.depth = Math.max(shape.depth, level + 1);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) stack.push([child, level + 1]);
  }
  return shape;
}

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

/** UTF-8 size, the number a file on disk would have. */
export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
