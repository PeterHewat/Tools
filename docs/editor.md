# Shared editor

`@tools/editor` supplies CodeMirror 6 behind one API
([ADR 003](adr/003-codemirror-for-code-editing.md)). Apps import that package and never
`@codemirror/*` or `@lezer/*`.

The package exposes text, selection, marks, folds, errors, JSON and XML structure, read-only mode
and a theme taken from the site's colours. What a document means stays in the app: the JSON app's
parser decides what is valid, and the editor shows it.

## Later

- Line wrapping.
- Showing whitespace.

Each consuming app exposes applicable preferences through its Settings menu. The package supplies
the editor behaviour. The app keeps its own preferences and their saved-format handling.

## Boundaries

- [Diff](apps/diff.md) may need a shared wrapper around `@codemirror/merge`. Diff keeps its own
  comparison rules.
- [JSON](apps/json.md) and [SVG](apps/svg.md) keep their own validation, completion and
  source-editing ideas under Later. Add a shared API only when one of those needs it.
- Vim keymaps, minimaps and unrelated third-party editor plugins stay out.
- Measure bundle growth before changing an app's budget.
