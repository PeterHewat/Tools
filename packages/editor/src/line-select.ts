/**
 * Selecting whole lines from the line numbers, as editors do: a click or tap selects the line
 * (its line break included), dragging down or up the gutter selects every line passed over, and
 * Shift+click extends the selection to the clicked line from where it started.
 *
 * A mouse or pen starts on pointerdown and follows pointer moves. A finger starts on touchstart,
 * which the gutter always listens for (not passively), and claims the touch there: cancelling
 * touchstart is what reliably keeps the browser from scrolling or starting a gesture of its own,
 * whatever it was doing before (a caret just placed in the text, for one). It then follows touch
 * moves, which keep coming to the element first touched. The theme also turns touch scrolling off
 * there (`touch-action: none` on `.cm-gutters`). The fold strip beside the numbers does the same,
 * except on a fold arrow.
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

/** Selects from the anchor line to the line at `block`, and returns a selector for later lines. */
function startSelecting(view: EditorView, line: BlockInfo, extend: boolean) {
  const anchor = extend
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
  return (clientY: number) => select(view.lineBlockAtHeight(clientY - view.documentTop));
}

/**
 * The line-number gutter's pointerdown and touchstart. Handled (true), so the default is
 * prevented: no mouse events after it, no caret of CodeMirror's own, and for a touch no scroll.
 */
export function selectLinesFromGutter(view: EditorView, line: BlockInfo, event: Event): boolean {
  if (event.type === "touchstart") {
    const t = event as TouchEvent;
    const first = t.touches[0];
    if (t.touches.length !== 1 || !first) return false;
    // From the finger rather than `line`: where the gutter has no element of its own (the fold
    // strip beside a line with no arrow), CodeMirror reads a clientY a touch event does not have.
    const touched = view.lineBlockAtHeight(first.clientY - view.documentTop);
    const selectAt = startSelecting(view, touched, false);
    const move = (m: TouchEvent) => {
      const touch = m.touches[0];
      if (!touch) return;
      if (m.cancelable) m.preventDefault();
      selectAt(touch.clientY);
    };
    const end = () => {
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return true;
  }

  const e = event as PointerEvent;
  // A finger is handled on its touchstart, which comes just after this.
  if (e.pointerType === "touch" || e.button !== 0) return false;
  const selectAt = startSelecting(view, line, e.shiftKey);
  const move = (m: PointerEvent) => {
    if (m.pointerId === e.pointerId) selectAt(m.clientY);
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
