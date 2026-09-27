/**
 * Line numbers and syntax colours for a plain `<textarea>`.
 *
 * The textarea stays the editor — typing, selection, undo, IME and spellcheck-off all native —
 * with its text made transparent. Underneath it, a `<pre>` shows the same lines coloured, and a
 * gutter beside it numbers them. Only what is on screen is drawn: the visible lines, and of a
 * very long line only the visible stretch. Both layers move with the textarea's scroll, so a
 * document of any size costs the same small amount of drawing.
 */
import { highlightHtml, highlightLine, type Mark, type Token } from "./lib/highlight.js";

export interface CodeView {
  /** Redraw after the text was set from code (typing and scrolling redraw by themselves). */
  refresh(): void;
  /** Mark a line in the gutter, numbered as the whole document counts, or clear the mark. */
  setErrorLine(line: number | null): void;
  /** The document line number of the textarea's first line: 1, or a later page's start. */
  setFirstLine(line: number): void;
  /** Marks stretches of the textarea's text (sorted offsets), e.g. find results. */
  setMarks(marks: readonly Mark[]): void;
}

/** Past this, colouring is skipped: the text shows plain, and stays fast. */
const MAX_COLOURED = 20_000_000;
/** Lines longer than this are coloured only around the visible columns. */
const LONG_LINE = 2_000;
/** Characters coloured either side of the visible ones on a long line. */
const COLUMN_OVERSCAN = 400;
/** Lines drawn above and below the visible ones, so fast scrolling does not show gaps. */
const OVERSCAN = 3;

export function createCodeView(
  root: HTMLElement,
  textarea: HTMLTextAreaElement,
  highlight: HTMLElement,
  gutter: HTMLElement
): CodeView {
  let lines: string[] = [];
  /** Offset where each line starts, for placing marks. */
  let starts: number[] = [];
  let marks: readonly Mark[] = [];
  let linesOf: string | null = null;
  let errorLine: number | null = null;
  let firstLine = 1;
  let lineHeight = 0;
  let charWidth = 0;
  /** Tokens of the long lines on screen, by content, so scrolling along one does not re-lex it. */
  let longTokens = new Map<string, Token[]>();

  const measure = () => {
    const style = getComputedStyle(textarea);
    lineHeight = parseFloat(style.lineHeight) || 19.5;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    highlight.append(probe);
    charWidth = probe.getBoundingClientRect().width / 100 || 7.8;
    probe.remove();
  };

  const tokensOf = (line: string) => {
    let tokens = longTokens.get(line);
    if (!tokens) {
      if (longTokens.size > 16) longTokens = new Map();
      tokens = highlightLine(line);
      longTokens.set(line, tokens);
    }
    return tokens;
  };

  /** The marks touching a line, in that line's offsets. */
  function marksOn(index: number): Mark[] {
    if (!marks.length) return [];
    const start = starts[index];
    const end = start + lines[index].length;
    let lo = 0;
    let hi = marks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid].end <= start) lo = mid + 1;
      else hi = mid;
    }
    const out: Mark[] = [];
    for (let k = lo; k < marks.length && marks[k].start < end; k++) {
      const m = marks[k];
      out.push({ start: Math.max(0, m.start - start), end: m.end - start, current: m.current });
    }
    return out;
  }

  function render(): void {
    const value = textarea.value;
    if (value !== linesOf) {
      lines = value.split("\n");
      linesOf = value;
      starts = new Array<number>(lines.length);
      for (let k = 0, at = 0; k < lines.length; k++) {
        starts[k] = at;
        at += lines[k].length + 1;
      }
      const lastNumber = firstLine + lines.length - 1;
      root.style.setProperty("--gutter-digits", String(Math.max(2, String(lastNumber).length)));
    }
    const plain = value.length > MAX_COLOURED;
    root.classList.toggle("plain", plain);
    if (!lineHeight) measure();

    const top = textarea.scrollTop;
    const first = Math.max(0, Math.floor(top / lineHeight) - OVERSCAN);
    const last = Math.min(
      lines.length,
      Math.ceil((top + textarea.clientHeight) / lineHeight) + OVERSCAN
    );
    const y = first * lineHeight - top;
    const left = textarea.scrollLeft;
    const from = Math.max(0, Math.floor(left / charWidth) - COLUMN_OVERSCAN);
    const to = Math.ceil((left + textarea.clientWidth) / charWidth) + COLUMN_OVERSCAN;

    highlight.style.transform = `translate(${-left}px, ${y}px)`;
    highlight.innerHTML = plain
      ? ""
      : lines
          .slice(first, last)
          .map((line, k) => {
            const lineMarks = marksOn(first + k);
            return line.length > LONG_LINE
              ? highlightHtml(line, from, to, tokensOf(line), lineMarks)
              : highlightHtml(line, 0, Infinity, undefined, lineMarks);
          })
          .join("\n");

    gutter.style.transform = `translateY(${y}px)`;
    let numbers = "";
    for (let n = firstLine + first; n < firstLine + last; n++) {
      numbers += (n === errorLine ? `<span class="err">${n}</span>` : n) + "\n";
    }
    gutter.innerHTML = numbers;
  }

  // Synchronous, not on the next frame: the textarea's own text is invisible, so a frame with
  // stale colours would show the old text under the caret.
  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", render);
  new ResizeObserver(() => {
    measure();
    render();
  }).observe(textarea);

  return {
    refresh: render,
    setErrorLine(line) {
      if (line === errorLine) return;
      errorLine = line;
      render();
    },
    setMarks(next) {
      marks = next;
      render();
    },
    setFirstLine(line) {
      if (line === firstLine) return;
      firstLine = line;
      linesOf = null; // the gutter width depends on it
      render();
    },
  };
}
