# Plan: after the shared code editor

**Kind:** Plan — nothing here is built yet.

The JSON app (its text and its converted views) and the SVG app's source panel edit in
`@tools/editor`: CodeMirror 6 behind a small API
([ADR 003](../adr/003-codemirror-for-code-editing.md)). The JSON text folds, shows its parse
error in place, and is one document however long it is. What follows builds on that.

## The Tree

With folding in the text, the JSON Tree view overlaps it. Decide whether it stays (an outline
with search over keys and values, and a place to read nested JSON without the punctuation) or
goes. Until then it stays as it is.

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
