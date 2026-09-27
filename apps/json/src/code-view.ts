/**
 * Line numbers and syntax colours for a plain `<textarea>`.
 *
 * The textarea stays the editor — typing, selection, undo, IME and spellcheck-off all native —
 * with its text made transparent. Underneath it, a `<pre>` shows the same lines coloured, and a
 * gutter beside it numbers them. Only the lines on screen are drawn, and both layers are moved
 * to match the textarea's scroll, so a document of any length costs the same few dozen lines.
 */
import { highlightHtml } from "./lib/highlight.js";

export interface CodeView {
  /** Redraw after the text was set from code (typing and scrolling redraw by themselves). */
  refresh(): void;
  /** Mark a line (1-based) in the gutter, or clear the mark. */
  setErrorLine(line: number | null): void;
}

/** Past this, colouring is skipped: the text shows plain, and stays fast. */
const MAX_COLOURED = 5_000_000;
/** A line longer than this is drawn uncoloured: thousands of spans on one line cost too much. */
const MAX_LINE = 10_000;
/** Lines drawn above and below the visible ones, so fast scrolling does not show gaps. */
const OVERSCAN = 3;

export function createCodeView(
  root: HTMLElement,
  textarea: HTMLTextAreaElement,
  highlight: HTMLElement,
  gutter: HTMLElement
): CodeView {
  let lines: string[] = [];
  let linesOf: string | null = null;
  let errorLine: number | null = null;
  let lineHeight = 0;

  const measure = () => {
    lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 19.5;
  };

  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function render(): void {
    const value = textarea.value;
    if (value !== linesOf) {
      lines = value.split("\n");
      linesOf = value;
      root.style.setProperty("--gutter-digits", String(Math.max(2, String(lines.length).length)));
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

    highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${y}px)`;
    highlight.innerHTML = plain
      ? ""
      : lines
          .slice(first, last)
          .map((line) => (line.length > MAX_LINE ? escape(line) : highlightHtml(line)))
          .join("\n");

    gutter.style.transform = `translateY(${y}px)`;
    let numbers = "";
    for (let n = first + 1; n <= last; n++) {
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
  };
}
