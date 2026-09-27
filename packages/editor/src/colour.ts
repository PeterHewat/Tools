/**
 * Colours from an app's own line lexer: every token becomes a `t-<kind>` class on its stretch
 * of text, only for the lines on screen, so a document of any size costs the same to draw.
 *
 * An app that has a lexer (the JSON app has one per view) keeps its colours identical in every
 * view that uses it, and in whatever else it draws with the same classes (the JSON tree).
 */
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

export interface Token {
  /** Class suffix: `key` is drawn with `t-key`. `plain` is left undecorated. */
  kind: string;
  text: string;
}

export type LineLexer = (line: string) => readonly Token[];

/** Lines longer than this keep their tokens between redraws, since lexing them is the cost. */
const LONG_LINE = 2_000;

/** A token's place in its line: [start, end, kind], skipping plain text. */
export function tokenSpans(tokens: readonly Token[]): [number, number, string][] {
  const out: [number, number, string][] = [];
  let at = 0;
  for (const t of tokens) {
    const end = at + t.text.length;
    if (t.kind !== "plain" && end > at) out.push([at, end, t.kind]);
    at = end;
  }
  return out;
}

const markCache = new Map<string, Decoration>();
const markFor = (kind: string) => {
  let mark = markCache.get(kind);
  if (!mark) markCache.set(kind, (mark = Decoration.mark({ class: `t-${kind}` })));
  return mark;
};

/** Colours the visible lines with `lexer`. */
export function lexerColours(lexer: LineLexer) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Spans of the long lines on screen, by content, so scrolling along one does not re-lex it. */
      long = new Map<string, [number, number, string][]>();

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
      }

      spansOf(line: string) {
        if (line.length <= LONG_LINE) return tokenSpans(lexer(line));
        let spans = this.long.get(line);
        if (!spans) {
          if (this.long.size > 8) this.long = new Map();
          spans = tokenSpans(lexer(line));
          this.long.set(line, spans);
        }
        return spans;
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to;) {
            const line = doc.lineAt(pos);
            for (const [start, end, kind] of this.spansOf(line.text)) {
              const a = Math.max(line.from + start, from);
              const b = Math.min(line.from + end, to);
              if (a < b) builder.add(a, b, markFor(kind));
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
