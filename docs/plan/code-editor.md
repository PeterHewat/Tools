# Plan: after the shared code editor

**Kind:** Plan — nothing here is built yet.

The JSON app (its text and its converted views), the SVG app's source panel and JWT's decoded JSON use
`@tools/editor`: CodeMirror 6 behind a small API
([ADR 003](../adr/003-codemirror-for-code-editing.md)). The JSON text folds, shows its parse
error in place, and is one document however long it is. What follows builds on that.

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
- Icon Check's pasted SVG in the editor.

## Optional extras

What CodeMirror makes cheap to add. None is needed; each is worth doing when someone misses it.
Roughly most useful first. Anything from outside the CodeMirror project (a Vim keymap, a
minimap) is ruled out by ADR 003.

### JSON

- **Replace** in the find bar, with a regex option: the one everyday editor feature the app
  lacks. CodeMirror's search query does the matching; the app's own bar stays.
- **Check against a JSON Schema**: pick or paste a schema (the app already writes them) and see
  every problem underlined in place and listed, through `@codemirror/lint`.
- **Complete keys** as you type, from a schema, or from the keys the document already uses at
  that place.
- **Hover a value** for its path, its type and, for an object or array, how much it holds.
- **YAML view** folding and indentation from `@codemirror/lang-yaml`; the same grammar helps
  YAML in.

### SVG source

- **Colour swatches** beside `fill` and `stroke` values, opening the app's colour picker.
- **Complete element and attribute names** from a small SVG schema (`lang-xml` takes one).
- **Hover a line** to outline that shape on the canvas.

### Both

- Settings for **line wrapping** and **showing whitespace**.
