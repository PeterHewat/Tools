/**
 * Expand the selection to the enclosing syntax node (a value, then its property, then the
 * object holding it…), and shrink it back one step at a time, as IDEs do on Shift+Alt+→ / ←.
 */
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";
import type { Command } from "@codemirror/view";

const pushed = StateEffect.define<EditorSelection>();
const popped = StateEffect.define<null>();

/** Selections that expanding left behind, most recent last; any other move forgets them. */
const trail = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(pushed)) return [...value, e.value];
      if (e.is(popped)) return value.slice(0, -1);
    }
    return tr.selection || tr.docChanged ? [] : value;
  },
});

/** The smallest node that strictly contains `range`; the range itself at the top. */
function enclosing(state: EditorState, range: SelectionRange): SelectionRange {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node = tree.resolveInner(range.from, side); node.parent; node = node.parent) {
      const covers = node.from <= range.from && node.to >= range.to;
      if (covers && (node.from < range.from || node.to > range.to)) {
        return EditorSelection.range(node.from, node.to);
      }
    }
  }
  // No tree (plain text), or the root: the whole document.
  return EditorSelection.range(0, state.doc.length);
}

export const expandSelection: Command = (view) => {
  const { state } = view;
  const next = EditorSelection.create(
    state.selection.ranges.map((r) => enclosing(state, r)),
    state.selection.mainIndex
  );
  if (next.eq(state.selection)) return false;
  view.dispatch({
    selection: next,
    effects: pushed.of(state.selection),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

export const shrinkSelection: Command = (view) => {
  const previous = view.state.field(trail).at(-1);
  if (!previous) return false;
  view.dispatch({ selection: previous, effects: popped.of(null), userEvent: "select" });
  return true;
};

export const expandExtension = trail;
