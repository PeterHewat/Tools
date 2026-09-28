/**
 * Colours from an app's own line lexer: every token becomes a `t-<kind>` class on its stretch
 * of text, only for the lines on screen, so a document of any size costs the same to draw.
 *
 * An app that has a lexer (the JSON app has one per view) keeps its colours identical in every
 * view that uses it.
 *
 * A line lexer sees one line, so it cannot know that a line starts inside a block comment
 * opened on an earlier one. Given the comment's markers, this works that out: from the line
 * before for the lines drawn one after another, and by looking back from the first line drawn.
 */
import { RangeSetBuilder, type Line, type Text } from "@codemirror/state";
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

/** A block comment's markers, as `["/*", "*\/"]`; the lexer marks comments with kind `comment`. */
export type BlockComment = readonly [open: string, close: string];

type Span = [start: number, end: number, kind: string];

/**
 * Lines longer than this are lexed only up to a little past what is on screen (a lexer reads
 * left to right, so the text after that cannot change the tokens before it), and keep their
 * tokens between redraws.
 */
const LONG_LINE = 2_000;
/** Characters lexed past the end of the visible stretch of a long line. */
const LEX_AHEAD = 1_000;
/** How far back from the first line drawn an open block comment is looked for. */
const LOOK_BACK = 200_000;

/** A token's place in its line: [start, end, kind], skipping plain text. */
export function tokenSpans(tokens: readonly Token[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const t of tokens) {
    const end = at + t.text.length;
    if (t.kind !== "plain" && end > at) out.push([at, end, t.kind]);
    at = end;
  }
  return out;
}

/** The comment span at the end of a line (up to `length`) leaves the comment open. */
function leavesOpen(spans: readonly Span[], text: string, comment: BlockComment): boolean {
  const last = spans.at(-1);
  if (!last || last[2] !== "comment" || last[1] !== text.length) return false;
  const body = text.slice(last[0], last[1]);
  const [open, close] = comment;
  return (
    body.startsWith(open) && (body.length < open.length + close.length || !body.endsWith(close))
  );
}

/**
 * Colours one line: `inComment` when it starts inside a block comment. Returns its spans and
 * whether the next line starts inside one.
 */
export function lexLine(
  lexer: LineLexer,
  text: string,
  inComment: boolean,
  comment?: BlockComment
): { spans: Span[]; open: boolean } {
  if (!comment) return { spans: tokenSpans(lexer(text)), open: false };
  if (!inComment) {
    const spans = tokenSpans(lexer(text));
    return { spans, open: leavesOpen(spans, text, comment) };
  }
  const end = text.indexOf(comment[1]);
  if (end < 0) return { spans: text ? [[0, text.length, "comment"]] : [], open: true };
  const at = end + comment[1].length;
  const rest = text.slice(at);
  const after = tokenSpans(lexer(rest));
  return {
    spans: [[0, at, "comment"], ...after.map(([a, b, k]): Span => [a + at, b + at, k])],
    open: leavesOpen(after, rest, comment),
  };
}

/**
 * Whether `pos` (a line start) is inside a block comment: the last opener before it has no
 * closer after it, and is a comment where it stands (not text inside a string).
 */
export function startsInComment(
  doc: Text,
  pos: number,
  lexer: LineLexer,
  comment: BlockComment
): boolean {
  const from = Math.max(0, pos - LOOK_BACK);
  const before = doc.sliceString(from, pos);
  const k = before.lastIndexOf(comment[0]);
  if (k < 0 || before.indexOf(comment[1], k + comment[0].length) >= 0) return false;
  const opener = from + k;
  const line = doc.lineAt(opener);
  const text = doc.sliceString(line.from, Math.min(line.to, opener + comment[0].length));
  const last = tokenSpans(lexer(text)).at(-1);
  return !!last && last[2] === "comment" && last[0] <= opener - line.from;
}

const markCache = new Map<string, Decoration>();
const markFor = (kind: string) => {
  let mark = markCache.get(kind);
  if (!mark) markCache.set(kind, (mark = Decoration.mark({ class: `t-${kind}` })));
  return mark;
};

/** Colours the visible lines with `lexer`; `comment` lets a block comment run over lines. */
export function lexerColours(lexer: LineLexer, comment?: BlockComment) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Long lines on screen, by the text lexed, so scrolling back does not re-lex them. */
      long = new Map<string, { spans: Span[]; open: boolean }>();

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
      }

      lex(doc: Text, line: Line, to: number, inComment: boolean) {
        if (line.length <= LONG_LINE) return lexLine(lexer, line.text, inComment, comment);
        const text = doc.sliceString(line.from, Math.min(line.to, to + LEX_AHEAD));
        const key = (inComment ? "1" : "0") + text;
        let lexed = this.long.get(key);
        if (!lexed) {
          if (this.long.size > 8) this.long = new Map();
          lexed = lexLine(lexer, text, inComment, comment);
          this.long.set(key, lexed);
        }
        return lexed;
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          let inComment = !!comment && startsInComment(doc, doc.lineAt(pos).from, lexer, comment);
          while (pos <= to) {
            const line = doc.lineAt(pos);
            const { spans, open } = this.lex(doc, line, to, inComment);
            for (const [start, end, kind] of spans) {
              const a = Math.max(line.from + start, from);
              const b = Math.min(line.from + end, to);
              if (a < b) builder.add(a, b, markFor(kind));
            }
            inComment = open;
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
