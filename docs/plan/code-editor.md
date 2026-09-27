# Plan: one code editor, shared by the apps

**Kind:** Plan — in progress on the `code-editor-codemirror` branch.

## Why

The JSON app edits in a plain `<textarea>` with a coloured layer drawn under it. A textarea
cannot hide lines, so folding lives in a second view, the Tree, and the app has two places to
look at one document. A very long document is edited a page of 5,000 lines at a time, because
a textarea slows down with every line it holds.

An IDE has one place: the text, with fold arrows in the gutter. The goal is that, for JSON, and
the same editor for the SVG app's live source panel and the planned apps that show code.

## Decision

**CodeMirror 6, behind `@tools/editor`** — see
[ADR 003](../adr/003-codemirror-for-code-editing.md). Apps import only from that package.

## `@tools/editor`

`createEditor(parent, options)` returns an `Editor` with what the apps use:

- text in and out; whole-text replacement as **one undoable step** (Format, Minify, Fix, Clear,
  Unwrap), so the browser's and the app's undo are one history;
- selection, and "select this range" that scrolls it to the middle and **unfolds** what hides
  it (find, Go to error, a tree row opened in the text);
- **marks** (find results, the current one filled) and **line classes** (the SVG panel's
  selected shapes);
- an **error** at an offset: underlined in place, its line number red, the message on hover;
- **languages**: JSON and XML give structure (folding, bracket matching, indentation); colours
  come from the app's own line lexers where it has them, so every view colours alike and the
  Colours setting turns them all off;
- **gutter labels** in place of line numbers (the CSV view numbers rows by their JSON line);
- read-only views; theme from the site's CSS custom properties, so light / dark needs nothing.

Keys, beyond CodeMirror's defaults: fold / unfold (Ctrl+Shift+[ / ]), fold all / unfold all,
go to line (Ctrl+G), expand / shrink selection (Shift+Alt+→ / ←), indent and outdent (Tab /
Shift+Tab), select next occurrence (Ctrl+D), auto-closed brackets and quotes.

## Steps

1. **`@tools/editor`** — the package above, with tests for what is logic (not the DOM).
2. **JSON text view** on it. Paging goes (`pageOf`, the pager bar); the app's rewrite undo stack
   goes. Expand all / Collapse all apply to the text too (fold all / unfold all). Find keeps the
   app's own bar, which also searches the tree and the converted views.
3. **JSON converted views** (YAML, CSV, Types, Schema) on it, read-only, with their lexers and
   the CSV gutter labels.
4. **SVG source panel** on it, XML: the selected shapes' lines and the focused attribute as
   decorations instead of the coloured `<pre>`; the rest of the panel (re-import on a pause,
   selection from the caret) unchanged. The app's global shortcuts must leave the editor's keys
   alone, as they do a textarea's.
5. **Measure**: the largest document the pages were made for, and a minified multi-megabyte
   line; bundle size per app. Record what was found in the PR.
6. Decide the **Tree**: it stays as an outline with search, or goes now that the text folds.

## YAML in

The JSON app opens CSV (a file, or pasted CSV with **Convert CSV to JSON**). YAML is the other
format people hold JSON-shaped data in — config files above all — so it should open the same
way: a `.yaml` / `.yml` file opens as JSON, and pasted YAML offers **Convert YAML to JSON**.

That needs a YAML reader, written here (no dependencies), for the subset real files use:

- block maps and lists, nested by indentation;
- the inline forms `[a, b]` and `{a: 1}`;
- plain, single- and double-quoted scalars, with YAML's escapes;
- `|` and `>` block strings, with their chomping indicators;
- comments, and a leading `---`.

Scalars map to JSON as YAML 1.2's core schema does (`true`, `null`, numbers; `yes` stays a
string). Out of scope: anchors and aliases, tags, several documents in one file, complex keys —
a file using them gets a clear "not supported" message rather than a wrong result. The app's
own YAML view is the test: every document it writes must read back to the same JSON.

## Later

- **Diff** (app-ideas #6) on `@codemirror/merge`, added to `@tools/editor`: side by side or
  unified, editable, unchanged stretches collapsed.
- JWT's header and payload, and Icon Check's pasted SVG, in the editor.
