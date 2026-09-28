/**
 * The smallest single change that turns one text into another: what the two share at the start
 * and at the end is kept, and only the middle is replaced.
 *
 * Replacing a whole document this way keeps the caret, the scroll position, folds and marks
 * wherever the text did not change, and gives undo a step the size of what really changed.
 */

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Null when the texts are the same. Linear in their length; no line-by-line diff. */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // Never split a surrogate pair: back off onto its first half.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let end = 0;
  const room = max - start;
  while (
    end < room &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
