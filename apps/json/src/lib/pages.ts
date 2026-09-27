/**
 * A long document split into pages of whole lines, so the editor only ever holds one page.
 *
 * A browser's textarea slows down with every line it holds, whatever the page does: past a few
 * tens of thousands of lines each keystroke takes a noticeable pause. The page is what the
 * textarea shows; the text before and after it is kept aside, and joining the three gives the
 * document back exactly, edits to the page included.
 */

export interface Page {
  /** Everything before the page, ending with the line break that precedes it. */
  before: string;
  /** The page's lines, without a trailing line break. */
  body: string;
  /** Everything after the page, starting with the line break that ends it. */
  after: string;
  /** 1-based number of the page's first line in the document. */
  firstLine: number;
  /** 0-based page number, clamped into range. */
  index: number;
  count: number;
}

/** Lines per page: small enough to type into smoothly, large enough to rarely turn a page. */
export const PAGE_LINES = 5_000;

export function lineCount(text: string): number {
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
}

/** Offset where 0-based line `n` starts; the text's length when it has fewer lines. */
function lineStart(text: string, n: number, from = 0, fromLine = 0): number {
  let at = from;
  for (let line = fromLine; line < n; line++) {
    const next = text.indexOf("\n", at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}

export function pageOf(text: string, index: number, size = PAGE_LINES): Page {
  const lines = lineCount(text);
  const count = Math.max(1, Math.ceil(lines / size));
  const k = Math.min(Math.max(0, index), count - 1);
  const first = k * size;
  const start = lineStart(text, first);
  const last = first + size >= lines;
  const end = last ? text.length : lineStart(text, first + size, start, first) - 1;
  return {
    before: text.slice(0, start),
    body: text.slice(start, end),
    after: text.slice(end),
    firstLine: first + 1,
    index: k,
    count,
  };
}

/** The page holding a character offset. */
export function pageAt(text: string, offset: number, size = PAGE_LINES): number {
  let line = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return Math.floor(line / size);
}
