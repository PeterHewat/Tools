/** Line numbers for offsets into a text, cheaply for many offsets at once. */

export interface TextPosition {
  /** 0-based offset into the text. */
  offset: number;
  /** 1-based, as editors count. */
  line: number;
  column: number;
}

/** Line and column of one offset. */
export function positionAt(text: string, offset: number): TextPosition {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { offset, line, column: offset - lineStart + 1 };
}

/** Offset where each line starts: with {@link lineOf}, line numbers for many offsets cheaply. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The 1-based line holding an offset, by binary search over {@link lineStarts}. */
export function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
