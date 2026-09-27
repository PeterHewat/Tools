# Plan: open items

**Kind:** Plan — nothing here is built yet. Items leave this list when they land.

The larger pieces have their own plans: [code-editor.md](code-editor.md) (one editor with
folding for JSON and the SVG source panel, and YAML in) and [app-ideas.md](app-ideas.md).

## Shared UI in `@tools/ui`

The apps share the header, theme, frost tokens, switches and the site's install and offline
setup. These are still written once per app, and differ where they should not:

- **Icons.** The same icons (help, search, import, export, copy, clear, theme) are inline SVG
  in the JSON page and a `<symbol>` sprite in the SVG app, with different paths. One set in
  `@tools/ui`, used by both.
- **Panels.** Help is a docked frosted panel in both apps, built twice: the SVG app's
  `.menu-dropdown--docked` and the JSON app's `.help` popover. One panel component (open state
  kept per tab, placed under the header, full width on a phone, theme switch in its title row).
- **Menus.** The SVG app's `.menu-dropdown` menus and the JSON app's `.menu` popovers: one look
  and one way of opening, closing and placing them.
- **Settings.** The JSON app has a cog menu; the SVG app keeps its settings in the Document
  panel. Decide on one pattern.
- **Floating controls.** The SVG app's bars float as pills over the canvas on a phone; the JSON
  app's header is a solid bar. Decide whether the JSON phone header becomes one row with a "⋯"
  menu for the file actions.

## JSON

- **Help on touch screens.** No Mouse / Touch switch (the app has little that is
  pointer-specific), but say "double-click (double-tap)" and hide the Keys table on a
  touch-only screen.
- **Exact values** chosen in Types and Schema are forgotten on reload; keep them with the
  draft for the tab.
- **Where things are kept.** The SVG app keeps a library of documents (IndexedDB); the JSON app
  keeps one draft per tab (sessionStorage). Decide whether JSON should keep recent documents.
- **Help** does not yet mention the phone's folded status bar (the chevron at the bottom right).

## SVG

- **Align as one.** Aligning several shapes or groups lines each one up with the selection's
  bounds, as Figma and Illustrator do; grouping first moves them as one. Add an "as one"
  choice to the align page (Inkscape's "treat selection as group") that moves the whole
  selection together instead.
