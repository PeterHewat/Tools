/** Line numbers for offsets into a text, cheaply for many offsets at once. */

export function lineCount(text: string): number {
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
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
