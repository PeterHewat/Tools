# Notes

Not built yet. Status and build order are on the [roadmap](../README.md).

Purpose: a small Markdown editor with a local collection of notes. The initial product should
be clearly scoped as local notes, rather than expanding into a general knowledge-management app.

Initial scope:

- Markdown source and live preview, with safe handling of embedded HTML and links.
- Create, rename and delete notes; autosave; a searchable note list.
- Import and export `.md` files, plus an easy export-all backup.
- Store note content in IndexedDB and preferences in localStorage, following the site's
  existing separation between documents and settings.
- Visible save failures and clear recovery behaviour; browser storage is not a backup.

Useful extensions: word count, search within the current note, and simple folders if the
collection needs them. A fuller virtual filesystem, attachments and access to an actual
device directory should be considered separately rather than assumed by "mini filesystem".

The Markdown dialect and supported preview syntax need to be specified before implementation.
Respect the runtime dependency rules; the existing editor does not itself provide a rendered
Markdown preview.

Out of scope: cloud sync, collaboration, accounts, plugins, rich-text editing and a large
attachment library.

## Decisions before implementation

- Supported Markdown dialect and safe preview syntax.
- Whether simple folders are needed in the first release.
- Export-all format and storage failure/recovery behaviour.
