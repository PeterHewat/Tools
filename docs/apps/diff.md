# Diff

Not built yet. Status and build order are on the [roadmap](../README.md).

Purpose: compare two pasted or dropped texts, including source code, SVG exports and JSON documents. Its value extends across the existing tools.

## Initial scope

- Two text inputs with side-by-side or unified differences.
- Navigation between changes and clear added, removed and modified content.
- Editable inputs, with unchanged stretches collapsible.
- Copy and download each input without changing its original text.
- A structural JSON mode that ignores object-key ordering while retaining array order, distinguishing missing values from null and preserving exact numbers. Invalid JSON gets an explicit error rather than a misleading structural comparison.

Use `@codemirror/merge` only through `@tools/editor`, following [ADR 003](../adr/003-codemirror-for-code-editing.md). The shared package supplies rendering and editor integration; JSON comparison rules belong in Diff. Use existing `@tools/json-core` parsing where applicable.

## Optional extensions

- Explicit whitespace comparison options, with their effect visible.
- Hand off existing app output through the site's per-tab draft pattern.

## Scope boundaries

Compare local documents. Git repository management, hosted reviews, collaboration and a full merge-conflict editor are outside the initial scope. Text comparison and structural JSON comparison are different modes; neither should silently rewrite the inputs.

## Decisions before implementation

- Whether structural JSON comparison ships with text comparison or in a following release.
- How structural differences map to source locations and how results display on narrow screens.
- Bundle cost of merge support and whether it should load on demand.
