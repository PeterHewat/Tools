# Plan: one code editor, shared by the apps

**Kind:** Plan — nothing here is built yet.

## Why

The JSON app edits in a plain `<textarea>` with a coloured layer drawn under it
(`apps/json/src/code-view.ts`). That keeps typing, selection, undo and IME native and fast on
big documents, but a textarea cannot hide lines. So folding lives in a second view, the Tree,
and the app has two places to look at one document.

An IDE has one: the text, with fold arrows in the gutter. The goal is that, for JSON, and the
same editor for the SVG app's live source panel, which today is its own textarea.

## What the editor needs

What an IDE has that the textarea does not:

- **Folding** — an arrow in the gutter beside each object and array; folded, the value shows as
  `{ … }` or `[ … ]` in place, and the line numbers skip. Fold all / unfold all (what Expand all
  and Collapse all do in the Tree today).
- **Click a line number to select the line**; drag down the gutter to select several.
- **Matching bracket** highlighted beside the caret.
- **Auto-closing** brackets and quotes, and typing over the closer.
- **Indent on Enter** to the enclosing level, and one level more after `{` or `[`.
- **Tab / Shift+Tab** indent and outdent the selected lines.
- **Go to line** (Ctrl+G).
- **Expand selection** to the enclosing value (Shift+Alt+→), and shrink it back.
- **Errors in place** — the Fix / parse error underlined where it is, not only in the status bar.
- **Find in folded text** unfolds the match it moves to.

What must not regress: pages of a very long document (`lib/pages.ts`), drawing only the lines
on screen, undo of whole-text rewrites (Format, Minify, Fix), and marks from find.

With folding in the text, the Tree view can go, or stay as a read-only outline.

## Two ways to get there

- **Bundle CodeMirror 6.** It already does all of the above, well, including accessibility and
  mobile input. It is a library, not a framework, and bundles into the app's static files — but
  it would be the first runtime dependency in the repo, which
  [ADR 001](../adr/001-static-apps-no-framework.md) rules out. Taking it means a new ADR.
- **Build a small editor in `@tools/ui`.** A `contenteditable`-free design stays closest to
  today's: keep the textarea for input and draw folds by giving it only the unfolded text,
  mapping offsets back to the document (the paging code already maps a page to the whole). A
  substantial piece of work, but it keeps the no-dependency rule, and both apps share it.

Decide between them first; it changes everything after.

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
