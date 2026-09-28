/**
 * Selecting whole lines from the line numbers, as editors do: a click or tap selects the line
 * (its line break included), dragging down or up the gutter selects every line passed over, and
 * Shift+click extends the selection to the clicked line from where it started.
 *
 * Pointer events, so a finger drags as a mouse does. A touch on the line numbers would otherwise
 * scroll the editor, and the browser would only send a mouse event for a plain tap; the theme
 * turns off touch scrolling there (`touch-action: none` on `.cm-lineNumbers`).
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

/**
 * The line-number gutter's pointerdown: selects lines, and follows the pointer while it is down.
 * Handled (true), so the browser sends no mouse events after it and CodeMirror does not place a
 * caret of its own.
 */
export function selectLinesFromGutter(view: EditorView, line: BlockInfo, event: Event): boolean {
  const e = event as PointerEvent;
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
  const move = (m: PointerEvent) => {
    if (m.pointerId === e.pointerId) select(view.lineBlockAtHeight(m.clientY - view.documentTop));
  };
  const up = (u: PointerEvent) => {
    if (u.pointerId !== e.pointerId) return;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
  return true;
}
