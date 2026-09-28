# ADR-003: CodeMirror 6 for code editing, behind one package

**Status:** Accepted

## Context

[ADR 001](001-static-apps-no-framework.md) keeps apps free of runtime dependencies, so that
the shipped files keep working for years whatever happens to the toolchain.

Several apps edit or show code: the JSON app's text and its converted views, the SVG app's live
source panel, and planned apps such as Diff, JWT and Icon Check. What they need is an IDE's
editor: folding, bracket matching, auto-closing, indent on Enter, go to line, selection by
syntax, errors in place, large documents drawn only where they are on screen, plus the parts
that make an editor work for everyone: IME composition, phone keyboards and selection handles,
screen readers, right-to-left text.

A `<textarea>` with a coloured layer under it cannot hide lines, so it cannot fold. An editor
that draws its own text has to get all of the above right in every browser, and those are the
parts that take the longest to get right. CodeMirror 6 already does all of it.

## Decision

Code editing uses **CodeMirror 6**, bundled into each app's static files at pinned versions.

- It lives behind one package, **`@tools/editor`**. Apps import from that package, never from
  `@codemirror/*` or `@lezer/*` directly, so replacing it later changes one package.
- The package exposes what the apps need (text, selection, marks, folds, errors, languages,
  read-only, theme from the site's CSS custom properties), not CodeMirror's whole API.
- Only packages from the CodeMirror project (`@codemirror/*`, `@lezer/*` and their own small
  helpers) are allowed in. Each new one is added on purpose, in `@tools/editor`.
- What a document means stays in the app: the JSON app's own parser decides what is valid and
  where the error is; the editor only shows it.

## Consequences

- The first runtime dependency in the repo. ADR 001's goal still holds: the output is static
  files that run from any server and need nothing at runtime that is not in them.
- Each app that edits code grows by about 120 KB gzipped (CodeMirror's view and state alone are
  about 65 KB): the JSON app is 141 KB with it, 20 KB of that its own code; the SVG app 189 KB,
  65 KB its own. Apps are
  built one by one, so each carries its own copy, and the site's service worker precaches them
  all. That is paid once per deploy, for an editor that would otherwise be months of work.
- Upgrades are deliberate: versions are pinned, and `bun run outdated` shows what moved.
- An app with a plain text field (a token, a key) keeps an `<input>` or `<textarea>`; the
  editor is for code.
