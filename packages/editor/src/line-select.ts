/**
 * Selecting whole lines from the line numbers, as editors do: a click selects the line (its line
 * break included), dragging down or up the gutter selects every line passed over, and Shift+click
 * extends the selection to the clicked line from where it started.
 */
import { EditorSelection } from "@codemirror/state";
import type { BlockInfo, EditorView } from "@codemirror/view";

/** A line's stretch with its line break, so selected lines copy and delete as whole lines. */
function lineSpan(view: EditorView, block: BlockInfo): { from: number; to: number } {
  const length = view.state.doc.length;
  return { from: block.from, to: block.to < length ? block.to + 1 : block.to };
}

/** From one line (the anchor's) to another, in whichever direction the second lies. */
export function linesBetween(
  anchor: { from: number; to: number },
  head: { from: number; to: number }
): { anchor: number; head: number } {
  return head.from < anchor.from
    ? { anchor: anchor.to, head: head.from }
    : { anchor: anchor.from, head: head.to };
}

/** The line-number gutter's mousedown: selects lines, and follows the pointer while it is held. */
export function selectLinesFromGutter(view: EditorView, line: BlockInfo, event: Event): boolean {
  const e = event as MouseEvent;
  if (e.button !== 0) return false;
  const anchor = e.shiftKey
    ? lineSpan(view, view.lineBlockAt(view.state.selection.main.anchor))
    : lineSpan(view, line);
  const select = (block: BlockInfo) => {
    const { anchor: a, head } = linesBetween(anchor, lineSpan(view, block));
    view.dispatch({
      selection: EditorSelection.range(a, head),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
  };
  view.focus();
  select(line);
  const move = (m: MouseEvent) => select(view.lineBlockAtHeight(m.clientY - view.documentTop));
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  return true;
}
