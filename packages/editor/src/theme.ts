/**
 * The editor drawn with the site's own colour tokens (`packages/ui/tokens.css`), so it follows
 * light and dark with the rest of the page and needs no theme of its own.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const selection = "color-mix(in srgb, var(--accent) 35%, transparent)";

export const siteTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    font: "var(--editor-font, 13px / 1.5 var(--mono))",
  },
  "&.cm-focused": { outline: "none" },
  // A thin scrollbar in the site's scrollbar colour, as the side panels have (panels.css).
  ".cm-scroller": {
    font: "inherit",
    lineHeight: "inherit",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--scroll) transparent",
  },
  ".cm-content": { padding: "6px 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 10px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: selection },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 4%, transparent)" },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    borderRight: "1px solid var(--border)",
    // A drag along the gutters (numbers and fold strip) selects lines (line-select.ts), with a
    // finger too.
    touchAction: "none",
    cursor: "default",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 12px", minWidth: "2ch" },
  ".cm-foldGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    paddingRight: "2px",
  },
  ".cm-fold-marker": {
    width: "12px",
    height: "12px",
    cursor: "pointer",
    opacity: "0.55",
  },
  ".cm-fold-marker:hover": { opacity: "1", color: "var(--text)" },
  // Open markers show while the pointer is over the gutter, closed ones always; a touch
  // screen, with nothing to hover, shows both.
  "@media (hover: hover)": {
    ".cm-gutters:not(:hover) .cm-fold-marker.open": { opacity: "0" },
  },
  ".cm-foldPlaceholder": {
    margin: "0 2px",
    padding: "0 5px",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    backgroundColor: "var(--panel-2)",
    color: "var(--muted)",
    fontSize: "0.9em",
    cursor: "pointer",
  },
  ".cm-foldPlaceholder:hover": { color: "var(--text)", borderColor: "var(--muted)" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--accent) 60%, transparent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--danger) 25%, transparent)",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)" },
  // Find: every match tinted, the current one filled, with dark text so it reads in either theme.
  ".cm-find": {
    borderRadius: "2px",
    backgroundColor: "rgb(255 210 31 / 38%)",
    boxShadow: "0 0 0 1px rgb(255 210 31 / 70%)",
  },
  ".cm-find-current, .cm-find-current *": { backgroundColor: "#ffd21f", color: "#1d1f24" },
  ".cm-error-mark": {
    textDecoration: "underline wavy var(--danger)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-error-mark-empty": { borderLeft: "2px solid var(--danger)" },
  ".cm-lineNumbers .cm-gutterElement.cm-error-line": { color: "var(--danger)", fontWeight: "700" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-panels": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
  },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  // Go to line and the other dialogs: the site's fields and buttons, not CodeMirror's light
  // gradients (which do not follow the theme).
  ".cm-panel": { padding: "6px 10px", fontFamily: "system-ui, sans-serif", fontSize: "13px" },
  ".cm-panel label": { display: "inline-flex", alignItems: "center", gap: "6px" },
  ".cm-panel .cm-textfield": {
    margin: "0",
    padding: "3px 6px",
    font: "13px var(--mono)",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
  ".cm-panel .cm-textfield:focus": { outline: "none", borderColor: "var(--accent)" },
  ".cm-panel .cm-button": {
    margin: "0 0 0 6px",
    padding: "3px 10px",
    font: "inherit",
    color: "var(--text)",
    backgroundColor: "var(--panel-2)",
    backgroundImage: "none",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  ".cm-panel .cm-button:hover": { borderColor: "var(--muted)" },
  ".cm-panel .cm-dialog-close, .cm-panel [name=close]": {
    color: "var(--muted)",
    fontSize: "18px",
    cursor: "pointer",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  // Token colours, the same classes an app's lexer and the syntax colours below produce.
  ".t-key": { color: "var(--accent)" },
  ".t-string, .t-type": { color: "var(--ok)" },
  ".t-number": { color: "var(--warn)" },
  ".t-literal": { color: "var(--violet)" },
  ".t-comment, .t-punct": { color: "var(--muted)" },
});

/** Colours from the language's syntax tree, for editors without a lexer of their own. */
export const syntaxColours = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.tagName, tags.propertyName], class: "t-key" },
    { tag: tags.attributeName, class: "t-literal" },
    { tag: [tags.string, tags.attributeValue], class: "t-string" },
    { tag: [tags.number], class: "t-number" },
    { tag: [tags.bool, tags.null, tags.atom], class: "t-literal" },
    { tag: [tags.comment, tags.processingInstruction, tags.documentMeta], class: "t-comment" },
    { tag: [tags.angleBracket, tags.punctuation, tags.separator], class: "t-punct" },
  ])
);
