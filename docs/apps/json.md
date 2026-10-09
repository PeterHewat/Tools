# JSON

Format, minify, fold and validate JSON, and fix almost-JSON. Convert it to YAML, CSV, TypeScript
types or a JSON Schema.

Nothing you open or paste leaves the page. The draft is kept for the tab, up to 2 MB.

The JSON view is editable, with colours, line numbers and folding. YAML, CSV, Types and Schema
follow the edits; Copy and Export take the view shown. Exact values, above Types and Schema, types
a string as the few values it holds. CSV turns each array into a table, one row per item. A `.csv`
or `.tsv` file opens as JSON, one object per row, and pasted CSV offers the same conversion.
Numbers, true, false and null become values; everything else stays text.

Format and Minify keep numbers and strings as written. Fix appears when the text is almost JSON —
comments, trailing commas, single quotes, unquoted keys, NaN, Python's True / None — and corrects
those places. An error is underlined where it is. Find searches the view shown. Settings hold the
indent, key sorting, syntax colours, the status-bar path, and whether a string that holds JSON is
turned into real JSON.

## Later

### YAML in

The JSON app opens CSV (a file, or pasted CSV with **Convert CSV to JSON**). YAML is the other
format people hold JSON-shaped data in — config files above all — so it should open the same way:
a `.yaml` / `.yml` file opens as JSON, and pasted YAML offers **Convert YAML to JSON**.

That needs a YAML reader, written here (no dependencies), for the subset real files use:

- block maps and lists, nested by indentation;
- the inline forms `[a, b]` and `{a: 1}`;
- plain, single- and double-quoted scalars, with YAML's escapes;
- `|` and `>` block strings, with their chomping indicators;
- comments, and a leading `---`.

Scalars map to JSON as YAML 1.2's core schema does (`true`, `null`, numbers; `yes` stays a string).
Out of scope: anchors and aliases, tags, several documents in one file, complex keys — a file using
them gets a clear "not supported" message rather than a wrong result. The app's own YAML view is
the test: every document it writes must read back to the same JSON.

### Editing

- **Replace** in the find bar, with a regex option: the one everyday editor feature the app lacks.
  CodeMirror's search query does the matching; the app's own bar stays.
- **Check against a JSON Schema**: pick or paste a schema (the app already writes them) and see
  every problem underlined in place and listed, through `@codemirror/lint`.
- **Complete keys** as you type, from a schema, or from the keys the document already uses at that
  place.
- **Hover a value** for its path, its type and, for an object or array, how much it holds.
- **YAML view** folding and indentation from `@codemirror/lang-yaml`; the same grammar helps YAML
  in.

CodeMirror capabilities stay behind `@tools/editor`, following
[ADR 003](../adr/003-codemirror-for-code-editing.md). Shared settings are in the
[editor description](../editor.md).

### Scope boundaries

Keep validation and conversion semantics in JSON and share them only when another app needs them.
Define supported JSON Schema vocabulary before implementation; unsupported features must be
explicit. Preserve existing preferences and exact source values under the repository's saved-format
rules.
