# App ideas (plan)

Intent only — nothing here is built unless it appears in the catalog. Slugs are suggestions for
`bun run new-app`.

Tools fit: client-only, offline, static output. No "save online", no fetching arbitrary URLs.

## Shared groundwork (done)

- `@tools/ui` — `base.css` (tokens, header with a link back to the index, buttons, inputs,
  code areas), DOM helpers (`copyText`, `downloadText`, `pickFiles`, `onFileDrop`), and
  `toolsApp(slug)` for the Vite config.
- `@tools/editor` — the code editor (CodeMirror 6): folding, errors in place, find marks, the
  site's colours. JSON, SVG and JWT use it; Diff and Icon Check would too.
- `@tools/bytes` — strict UTF-8, hex, Base64 and Base64url, plus Web Crypto digest and HMAC helpers shared by JWT, Codec and Digests.
- `@tools/json-core` — JSON parsing and formatting that preserve source numbers and strings, shared by JSON and JWT.

## Build order

| #   | Slug         | Name       | What it does                                              | MVP notes                                                                                                                                                          |
| --- | ------------ | ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4   | `icon-check` | Icon Check | See an SVG icon at the sizes it will actually be used at. | Paste or drop an SVG; render at 16/24/32/48/64 px on light and dark, with a pixel grid option to catch half-pixel strokes. Later: PNG / favicon export via canvas. |
| 6   | `diff`       | Diff       | Compare two texts, or two JSON documents structurally.    | Line diff side-by-side or unified; JSON mode compares parsed values (key order ignored). Handy for two SVG exports too.                                            |
| 7   | `time`       | Time       | Unix timestamps ⇄ dates, across time zones.               | Seconds or milliseconds auto-detected; ISO 8601; relative ("in 3 h"). Small, and pairs with JWT's claims.                                                          |

## Out of scope

- **Separate SVG tools around the SVG app.** What drawing needs belongs in that app itself. Tools for
  cutting and plotting (nesting parts on a sheet, stroke-to-outline, toolpath previews) serve a
  different workflow.
- **Design utilities** (palettes, gradients, sprite slicing) until a real need shows up.

## Naming

- Slugs are lowercase kebab-case and match the folder under `apps/`.
- Short, tool-like names (`json`, `jwt`, `codes`, `svg`); no repeated suffix.
- Shared code moves into `packages/` only once two apps need it.
