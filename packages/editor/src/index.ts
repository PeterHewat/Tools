/**
 * The code editor the apps share: CodeMirror 6 behind the few calls the apps need
 * (ADR 003). Apps import from here, never from `@codemirror/*` or `@lezer/*`.
 *
 * Offsets are UTF-16 offsets into the text, as `String` counts them; lines are 1-based.
 * Files dropped on the editor are left to the app (`onFileDrop` from `@tools/ui` on `dom`).
 */
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  isolateHistory,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import {
  bracketMatching,
  codeFolding,
  ensureSyntaxTree,
  foldedRanges,
  foldEffect,
  foldGutter,
  foldKeymap,
  foldNodeProp,
  indentOnInput,
  indentUnit,
  syntaxTree,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import { gotoLine, highlightSelectionMatches, selectNextOccurrence } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type StateCommand,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  drawSelection,
  dropCursor,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
  rectangularSelection,
  type BlockInfo,
  type DecorationSet,
  type KeyBinding,
} from "@codemirror/view";
import { iconSvg } from "@tools/ui";
import { lexerColours, type BlockComment, type LineLexer } from "./colour.js";
import { expandExtension, expandSelection, shrinkSelection } from "./expand.js";
import { foldSummary } from "./fold-summary.js";
import { selectLinesFromGutter } from "./line-select.js";
import { minimalChange } from "./text-diff.js";
import { siteTheme, syntaxColours } from "./theme.js";

export type { BlockComment, LineLexer, Token } from "./colour.js";

/** Structure: folding, bracket matching and indentation follow the language's syntax. */
export type Language = "json" | "xml" | null;

/** How text is coloured: an app's line lexer, the language's own syntax colours, or not at all. */
export type Colours =
  LineLexer | { lexer: LineLexer; blockComment?: BlockComment } | "syntax" | null;

/** A stretch of text drawn with a class; `line` puts the class on each whole line it touches. */
export interface Highlight {
  from: number;
  to: number;
  class: string;
  line?: boolean;
}

/** A find result; the current one is filled in. */
export interface Mark {
  start: number;
  end: number;
  current?: boolean;
}

/**
 * A remark shown after the text at an offset, such as what a JSON member means. It is not part
 * of the text: never edited, selected or copied with it.
 */
export interface Note {
  at: number;
  text: string;
  /** Added to `cm-note`, as `cm-note-warn` is. */
  class?: string;
}

export interface EditorError {
  /** Where the problem is. */
  from: number;
  /** End of the underline; by default the end of the word or symbol at `from`. */
  to?: number;
  message: string;
}

export interface EditorKey {
  /** CodeMirror's key names: "Mod-Enter", "Shift-Alt-ArrowRight", "F3"… */
  key: string;
  /** True when the key was handled. */
  run: () => boolean;
}

export interface EditorOptions {
  text?: string;
  language?: Language;
  colours?: Colours;
  readOnly?: boolean;
  /** Accessible name of the text. */
  label?: string;
  placeholder?: string;
  lineWrapping?: boolean;
  /**
   * The text is data, kept exactly as it is: only "\n" breaks a line (a "\r" stays a character),
   * control and invisible characters are drawn as symbols, and brackets are not closed as typed.
   */
  exact?: boolean;
  /** Indent unit: a number of spaces, or a tab. Two spaces by default. */
  indent?: number | "\t";
  /** Extra keys, tried before the editor's own. */
  keys?: readonly EditorKey[];
  /** The text changed; `user` when typed, pasted or undone rather than set with `setText`. */
  onChange?: (user: boolean) => void;
  /** The caret or selection moved (also after a change). */
  onSelection?: () => void;
  onFocus?: (focused: boolean) => void;
  /**
   * What `canFold` and `hasFolds` say may have changed: something was folded or unfolded, the
   * text changed, or more of it was parsed. Called at most once a frame.
   */
  onFolds?: () => void;
}

export interface Editor {
  /** The editor's outermost element, for classes, file drops and layout. */
  readonly dom: HTMLElement;
  readonly text: string;
  readonly lineCount: number;
  /** The main selection, `from` ≤ `to`; `head` is where the caret is. */
  readonly selection: { from: number; to: number; head: number };
  readonly focused: boolean;
  /**
   * Replaces the text. "edit" (the default) and "sync" change only what differs, so the caret,
   * scroll and folds stay put where the text did not change: an "edit" is one step of undo (a
   * Format, a Fix), a "sync" is not (the text follows something else, as the SVG app's source
   * follows its drawing). "new" replaces all of it, caret at the start, history started again
   * (a file opened).
   */
  setText(text: string, how?: SetTextMode): void;
  /**
   * Selects a stretch, unfolding what hides it. `scroll`: "center" (default) brings it to the
   * middle of the view, "top" to the top, "nearest" just into view, false leaves the scroll.
   */
  select(from: number, to?: number, options?: { scroll?: ScrollTo | false; focus?: boolean }): void;
  /** 1-based line and column of an offset. */
  position(offset: number): { line: number; column: number };
  /** Text of a 1-based line. */
  line(line: number): string;
  focus(): void;
  setMarks(marks: readonly Mark[]): void;
  setHighlights(highlights: readonly Highlight[]): void;
  setNotes(notes: readonly Note[]): void;
  setError(error: EditorError | null): void;
  setColours(colours: Colours): void;
  setReadOnly(readOnly: boolean): void;
  setIndent(indent: number | "\t"): void;
  /** Numbers the gutter from elsewhere, one entry per line (null leaves it blank); null numbers lines. */
  setLineLabels(labels: readonly (number | string | null)[] | null): void;
  /** Folds every object, array or element, except the one holding the whole document. */
  foldAll(): void;
  unfoldAll(): void;
  /** Fold all would fold something: a value over several lines is still open. */
  readonly canFold: boolean;
  /** Something is folded, so Unfold all has something to do. */
  readonly hasFolds: boolean;
  /**
   * Scrolls the editor, and only the editor, to show an offset without moving the selection:
   * the page and any panel holding the editor stay where they are.
   */
  scrollTo(offset: number, where?: ScrollTo): void;
}

export type ScrollTo = "center" | "top" | "nearest";

export type SetTextMode = "edit" | "sync" | "new";

/** Past this many characters, a language's structure is not worth parsing: the text stays plain. */
const MAX_STRUCTURED = 30_000_000;

// ---------- Decorations set from outside: marks, highlights, the error ----------

function decorationField<T>(build: (value: T, state: EditorState) => DecorationSet) {
  const set = StateEffect.define<T>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) if (e.is(set)) return build(e.value, tr.state);
      return tr.docChanged ? deco.map(tr.changes) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { set, field };
}

const findMark = Decoration.mark({ class: "cm-find" });
const findCurrent = Decoration.mark({ class: "cm-find cm-find-current" });

const marks = decorationField<readonly Mark[]>((list, state) => {
  const builder = new RangeSetBuilder<Decoration>();
  const length = state.doc.length;
  for (const m of list) {
    const from = Math.min(m.start, length);
    const to = Math.min(m.end, length);
    if (from < to) builder.add(from, to, m.current ? findCurrent : findMark);
  }
  return builder.finish();
});

const highlights = decorationField<readonly Highlight[]>((list, state) => {
  const length = state.doc.length;
  const ranges = [];
  for (const h of list) {
    const from = Math.min(h.from, length);
    const to = Math.min(h.to, length);
    if (h.line) {
      const deco = Decoration.line({ class: h.class });
      const last = state.doc.lineAt(to).number;
      for (let n = state.doc.lineAt(from).number; n <= last; n++) {
        ranges.push(deco.range(state.doc.line(n).from));
      }
    } else if (from < to) {
      ranges.push(Decoration.mark({ class: h.class }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
});

class NoteWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string
  ) {
    super();
  }
  override eq(other: NoteWidget) {
    return other.text === this.text && other.className === this.className;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.className ? `cm-note ${this.className}` : "cm-note";
    span.textContent = this.text;
    return span;
  }
}

const notes = decorationField<readonly Note[]>((list, state) =>
  Decoration.set(
    list
      .filter((note) => note.at >= 0 && note.at <= state.doc.length)
      .map((note) =>
        Decoration.widget({
          widget: new NoteWidget(note.text, note.class ?? ""),
          side: 1,
        }).range(note.at)
      ),
    true
  )
);

interface PlacedError {
  from: number;
  to: number;
  message: string;
}

/** An error where there is nothing to underline: the end of a line or of the text. */
class ErrorPoint extends WidgetType {
  constructor(readonly message: string) {
    super();
  }
  override eq(other: ErrorPoint) {
    return other.message === this.message;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-error-mark-empty";
    span.title = this.message;
    span.textContent = "​";
    return span;
  }
}

const errorLine = new (class extends GutterMarker {
  override elementClass = "cm-error-line";
})();

const setErrorEffect = StateEffect.define<PlacedError | null>();
const errorField = StateField.define<PlacedError | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setErrorEffect)) return e.value;
    if (!value || !tr.docChanged) return value;
    return { ...value, from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to, 1) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (err) => {
      if (!err) return Decoration.none;
      if (err.from < err.to) {
        const mark = Decoration.mark({
          class: "cm-error-mark",
          attributes: { title: err.message },
        });
        return Decoration.set(mark.range(err.from, err.to));
      }
      return Decoration.set(
        Decoration.widget({ widget: new ErrorPoint(err.message), side: 1 }).range(err.from)
      );
    }),
    gutterLineClass.compute([f], (state) => {
      const err = state.field(f);
      const builder = new RangeSetBuilder<GutterMarker>();
      if (err) {
        const start = state.doc.lineAt(Math.min(err.from, state.doc.length)).from;
        builder.add(start, start, errorLine);
      }
      return builder.finish();
    }),
  ],
});

/** End of the word, number or string-ish run at `from`, or one symbol; `from` at a line end. */
function errorEnd(state: EditorState, from: number): number {
  const line = state.doc.lineAt(from);
  const rest = line.text.slice(from - line.from);
  if (!rest) return from;
  const word = /^[\w$.+-]+/.exec(rest);
  return from + (word ? word[0].length : 1);
}

// ---------- Keys ----------

/** Tab: indent the selected lines, or insert one indent unit at the caret. */
const indentOrInsert: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  const unit = state.facet(indentUnit);
  dispatch(
    state.update(state.replaceSelection(unit), { scrollIntoView: true, userEvent: "input" })
  );
  return true;
};

const editorKeys: readonly KeyBinding[] = [
  ...closeBracketsKeymap,
  { key: "Mod-g", run: gotoLine, preventDefault: true },
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Shift-Alt-ArrowRight", run: expandSelection },
  { key: "Shift-Alt-ArrowLeft", run: shrinkSelection },
  ...defaultKeymap,
  ...historyKeymap,
  ...foldKeymap,
  { key: "Tab", run: indentOrInsert, shift: indentLess },
];

// ---------- Folding ----------

type Range = { from: number; to: number };

/** Offsets of the first and last characters that are not white space; null for blank text. */
function contentBounds(doc: Text): [number, number] | null {
  let first = -1;
  let at = 0;
  for (const it = doc.iter(); !it.next().done; at += it.value.length) {
    const k = it.value.search(/\S/);
    if (k >= 0) {
      first = at + k;
      break;
    }
  }
  if (first < 0) return null;
  let end = doc.length;
  for (const it = doc.iter(-1); !it.next().done; end -= it.value.length) {
    const k = it.value.trimEnd().length;
    if (k > 0) return [first, end - it.value.length + k - 1];
  }
  return null;
}

/**
 * Visits what Fold all folds, outermost first, until `visit` returns true: every foldable range
 * over more than one line, except the one that holds the whole document (JSON's outer object,
 * XML's root element), which would fold the text to a single line. Decided by where the ranges
 * are rather than by the tree's shape, which a parse of broken text can bend.
 */
function visitFoldTargets(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  visit: (range: Range) => boolean | void
): void {
  const bounds = contentBounds(state.doc);
  if (!bounds) return;
  const [first, last] = bounds;
  const cursor = tree.cursor();
  for (;;) {
    const fold = cursor.type.prop(foldNodeProp);
    const range = fold?.(cursor.node, state);
    if (
      range &&
      range.to > range.from &&
      !(range.from <= first + 1 && range.to >= last) &&
      state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number &&
      visit(range)
    ) {
      return;
    }
    if (cursor.firstChild()) continue;
    while (!cursor.nextSibling()) if (!cursor.parent()) return;
  }
}

const rangeKey = (from: number, to: number) => `${from}:${to}`;

function foldedKeys(state: EditorState): Set<string> {
  const keys = new Set<string>();
  foldedRanges(state).between(0, state.doc.length, (f, t) => void keys.add(rangeKey(f, t)));
  return keys;
}

/** Something Fold all would fold is still open (in the part of the text parsed so far). */
function canFoldMore(state: EditorState): boolean {
  const folded = foldedKeys(state);
  let open = false;
  visitFoldTargets(state, syntaxTree(state), (r) => (open = !folded.has(rangeKey(r.from, r.to))));
  return open;
}

/** Line selection from the fold gutter, except on a fold arrow, which is left to fold. */
function selectOffMarker(view: EditorView, line: BlockInfo, event: Event): boolean {
  if ((event.target as Element | null)?.closest?.(".cm-fold-marker")) return false;
  return selectLinesFromGutter(view, line, event);
}

function markerDom(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = `cm-fold-marker${open ? " open" : ""}`;
  span.title = open ? "Fold" : "Unfold";
  span.append(iconSvg(open ? "chevron-down" : "chevron-right"));
  return span;
}

const folding: Extension = [
  codeFolding({
    preparePlaceholder: foldSummary,
    placeholderDOM(_view, onclick, prepared: unknown) {
      const span = document.createElement("span");
      span.className = "cm-foldPlaceholder";
      span.textContent = typeof prepared === "string" && prepared ? `… ${prepared}` : "…";
      span.title = "Unfold";
      span.setAttribute("aria-label", "folded code");
      span.onclick = onclick;
      return span;
    },
  }),
  foldGutter({
    markerDOM: markerDom,
    // The strip beside the numbers selects lines as they do; a fold arrow still folds.
    domEventHandlers: { pointerdown: selectOffMarker, touchstart: selectOffMarker },
  }),
];

// ---------- The editor ----------

/** Marks transactions made by `setText`, so `onChange` can tell them from typing. */
const fromCode = Annotation.define<boolean>();

function languageExtension(language: Language, size: number): Extension {
  if (size > MAX_STRUCTURED) return [];
  if (language === "json") return json();
  if (language === "xml") return xml();
  return [];
}

function colourExtension(colours: Colours): Extension {
  if (colours === "syntax") return syntaxColours;
  if (!colours) return [];
  return typeof colours === "function"
    ? lexerColours(colours)
    : lexerColours(colours.lexer, colours.blockComment);
}

const indentString = (indent: number | "\t") => (indent === "\t" ? "\t" : " ".repeat(indent));

function numbers(labels: readonly (number | string | null)[] | null): Extension {
  return lineNumbers({
    ...(labels && {
      formatNumber: (n: number) => (labels[n - 1] == null ? "" : String(labels[n - 1])),
    }),
    domEventHandlers: { pointerdown: selectLinesFromGutter, touchstart: selectLinesFromGutter },
  });
}

/**
 * An invisible character in exact text: a control character as its Unicode control picture
 * (␀, ␍, ␛…), any other as its code point, both named on hover. A tab keeps its width, as a
 * `cm-tab` the app may draw.
 */
function specialChar(code: number, description: string | null): HTMLElement {
  const span = document.createElement("span");
  const point = "U+" + code.toString(16).toUpperCase().padStart(4, "0");
  span.className = "cm-specialChar";
  span.textContent =
    code < 0x20 ? String.fromCharCode(0x2400 + code) : code === 0x7f ? "\u2421" : point;
  span.title = description ? `${description} (${point})` : point;
  return span;
}

export function createEditor(parent: HTMLElement, options: EditorOptions = {}): Editor {
  const language = new Compartment();
  const colours = new Compartment();
  const indent = new Compartment();
  const gutter = new Compartment();
  const undo = new Compartment();
  const readOnly = new Compartment();
  /** An `onFolds` call is waiting for the next frame. */
  let foldsPending = false;
  const languageChoice: Language = options.language ?? null;
  const text = options.text ?? "";

  const extensions: Extension[] = [
    Prec.highest(keymap.of((options.keys ?? []).map((k) => ({ key: k.key, run: () => k.run() })))),
    gutter.of(numbers(null)),
    folding,
    highlightActiveLineGutter(),
    options.exact
      ? [
          EditorState.lineSeparator.of("\n"),
          highlightSpecialChars({ render: specialChar, addSpecialChars: /\t/ }),
        ]
      : [highlightSpecialChars(), closeBrackets()],
    undo.of(history()),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    keymap.of(editorKeys),
    expandExtension,
    marks.field,
    highlights.field,
    notes.field,
    errorField,
    siteTheme,
    language.of(languageExtension(languageChoice, text.length)),
    colours.of(colourExtension(options.colours ?? null)),
    indent.of(indentUnit.of(indentString(options.indent ?? 2))),
    readOnly.of(EditorState.readOnly.of(options.readOnly ?? false)),
    // Files dropped on the editor are the app's to open, not text to insert.
    EditorView.domEventHandlers({
      drop: (e) => e.dataTransfer?.types.includes("Files") ?? false,
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const user = u.transactions.some((tr) => tr.docChanged && !tr.annotation(fromCode));
        options.onChange?.(user);
      }
      if (u.docChanged || u.selectionSet) options.onSelection?.();
      if (u.focusChanged) options.onFocus?.(u.view.hasFocus);
      const onFolds = options.onFolds;
      if (
        onFolds &&
        !foldsPending &&
        (u.docChanged ||
          foldedRanges(u.startState) !== foldedRanges(u.state) ||
          syntaxTree(u.startState) !== syntaxTree(u.state))
      ) {
        foldsPending = true;
        requestAnimationFrame(() => {
          foldsPending = false;
          onFolds();
        });
      }
    }),
  ];
  if (options.lineWrapping) extensions.push(EditorView.lineWrapping);
  if (options.placeholder) extensions.push(placeholderText(options.placeholder));
  if (options.label) {
    extensions.push(EditorView.contentAttributes.of({ "aria-label": options.label }));
  }

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions }),
  });

  const scrollEffect = (from: number, to: number, where: ScrollTo) =>
    EditorView.scrollIntoView(EditorSelection.range(from, to), {
      y: where === "top" ? "start" : where,
      yMargin: where === "top" ? 20 : 5,
    });

  const clamp = (n: number) => Math.max(0, Math.min(n, view.state.doc.length));

  /** Structure depends on size: a text grown past the limit drops it, and back. */
  const reconfigureLanguageFor = (size: number): StateEffect<unknown> | null => {
    const was = view.state.doc.length > MAX_STRUCTURED;
    const now = size > MAX_STRUCTURED;
    return was === now ? null : language.reconfigure(languageExtension(languageChoice, size));
  };

  return {
    dom: view.dom,
    get text() {
      return view.state.doc.toString();
    },
    get lineCount() {
      return view.state.doc.lines;
    },
    get selection() {
      const { from, to, head } = view.state.selection.main;
      return { from, to, head };
    },
    get focused() {
      return view.hasFocus;
    },

    setText(next, how = "edit") {
      const current = view.state.doc.toString();
      const languageEffect = reconfigureLanguageFor(next.length);
      if (how === "new") {
        // Everything replaced, with the history dropped and started again.
        view.dispatch({
          changes: { from: 0, to: current.length, insert: next },
          selection: EditorSelection.cursor(0),
          effects: [undo.reconfigure([]), ...(languageEffect ? [languageEffect] : [])],
          annotations: [fromCode.of(true), Transaction.addToHistory.of(false)],
          scrollIntoView: true,
        });
        view.dispatch({ effects: undo.reconfigure(history()) });
        return;
      }
      const change = minimalChange(current, next);
      if (!change) return;
      view.dispatch({
        changes: change,
        effects: languageEffect ? [languageEffect] : [],
        annotations: [
          fromCode.of(true),
          how === "edit" ? isolateHistory.of("full") : Transaction.addToHistory.of(false),
        ],
        userEvent: "input.replace",
      });
    },

    select(from, to = from, { scroll = "center", focus = false } = {}) {
      from = clamp(from);
      to = clamp(to);
      const [a, b] = from <= to ? [from, to] : [to, from];
      const hidden: StateEffect<unknown>[] = [];
      foldedRanges(view.state).between(a, b, (f, t) => {
        // Touching a fold at its edge does not hide the selection; overlapping it does.
        if (f < b && t > a) hidden.push(unfoldEffect.of({ from: f, to: t }));
      });
      view.dispatch({
        selection: EditorSelection.range(from, to),
        effects: scroll ? [...hidden, scrollEffect(a, b, scroll)] : hidden,
        userEvent: "select",
      });
      if (focus) view.focus();
    },

    position(offset) {
      const line = view.state.doc.lineAt(clamp(offset));
      return { line: line.number, column: clamp(offset) - line.from + 1 };
    },

    line(n) {
      const doc = view.state.doc;
      return n >= 1 && n <= doc.lines ? doc.line(n).text : "";
    },

    focus: () => view.focus(),

    setMarks(list) {
      view.dispatch({ effects: marks.set.of(list) });
    },

    setHighlights(list) {
      view.dispatch({ effects: highlights.set.of(list) });
    },

    setNotes(list) {
      view.dispatch({ effects: notes.set.of(list) });
    },

    setError(error) {
      const current = view.state.field(errorField);
      if (!error) {
        if (current) view.dispatch({ effects: setErrorEffect.of(null) });
        return;
      }
      const from = clamp(error.from);
      const to = clamp(error.to ?? errorEnd(view.state, from));
      if (
        current &&
        current.from === from &&
        current.to === to &&
        current.message === error.message
      )
        return;
      view.dispatch({ effects: setErrorEffect.of({ from, to, message: error.message }) });
    },

    setColours(next) {
      view.dispatch({ effects: colours.reconfigure(colourExtension(next)) });
    },

    setReadOnly(next) {
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(next)) });
    },

    setIndent(next) {
      view.dispatch({ effects: indent.reconfigure(indentUnit.of(indentString(next))) });
    },

    setLineLabels(labels) {
      view.dispatch({ effects: gutter.reconfigure(numbers(labels)) });
    },

    foldAll() {
      const { state } = view;
      const tree = ensureSyntaxTree(state, state.doc.length, 2_000) ?? syntaxTree(state);
      const folded = foldedKeys(state);
      const effects: StateEffect<unknown>[] = [];
      visitFoldTargets(state, tree, (r) => {
        if (!folded.has(rangeKey(r.from, r.to))) effects.push(foldEffect.of(r));
      });
      if (effects.length) view.dispatch({ effects });
    },

    get canFold() {
      return canFoldMore(view.state);
    },

    get hasFolds() {
      return foldedRanges(view.state).size > 0;
    },

    unfoldAll: () => void unfoldAll(view),

    scrollTo(offset, where = "center") {
      const at = clamp(offset);
      const scroller = view.scrollDOM;
      // Line heights off screen are estimates until drawn: place it, then again once measured.
      const place = (top: number, height: number) => {
        const room = scroller.clientHeight;
        if (where === "nearest") {
          if (top < scroller.scrollTop) scroller.scrollTop = top - 5;
          else if (top + height > scroller.scrollTop + room)
            scroller.scrollTop = top + height - room + 5;
        } else {
          scroller.scrollTop = where === "top" ? top - 20 : top - (room - height) / 2;
        }
      };
      const block = () => {
        const b = view.lineBlockAt(at);
        return {
          top:
            b.top + (view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop),
          height: b.height,
        };
      };
      const first = block();
      place(first.top, first.height);
      view.requestMeasure({
        read: block,
        write: (b) => {
          if (Math.abs(b.top - first.top) > 1) place(b.top, b.height);
        },
      });
    },
  };
}
