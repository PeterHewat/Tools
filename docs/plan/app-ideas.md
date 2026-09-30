# App ideas (plan)

Intent only — nothing here is built unless it appears in the catalog. Slugs are suggestions for
`bun run new-app`.

Tools fit: client-only, offline, static output. No "save online", no fetching arbitrary URLs.

## Shared groundwork (done)

- `@tools/ui` — `base.css` (tokens, header with a link back to the index, buttons, inputs,
  code areas), DOM helpers (`copyText`, `downloadText`, `pickFiles`, `onFileDrop`), and
  `toolsApp(slug)` for the Vite config.
- `@tools/editor` — the code editor (CodeMirror 6): folding, errors in place, find marks, the
  site's colours. JSON's views and the SVG source use it; JWT, Diff and Icon Check would too.

Encoding helpers (base64 / base64url, hex, UTF-8) are written with the first app that needs
them — JWT, Codec or Digests — and move to a shared package when a second one does.

## Build order

| #   | Slug         | Name       | What it does                                                 | MVP notes                                                                                                                                                                                         |
| --- | ------------ | ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `jwt`        | JWT        | Decode and verify JSON Web Tokens without sending them away. | Split and base64url-decode; readable `exp` / `iat` / `nbf` with "expires in"; pretty header and payload. Verify HS256/384/512 via Web Crypto; later RS/ES with a PEM or JWK. "Dev use only" note. |
| 2   | `codec`      | Codec      | Base64, base64url, URL encoding, hex and UTF-8 inspection.   | Two panes, pick the transform each way; show bytes (hex) under the text so invisible characters are visible.                                                                                      |
| 3   | `digests`    | Digests    | Hash text and files with Web Crypto.                         | SHA-256/384/512 and SHA-1 (flagged as legacy); hex and base64; file drop hashes in the browser. HMAC with a key lives here, not in JWT.                                                           |
| 4   | `icon-check` | Icon Check | See an SVG icon at the sizes it will actually be used at.    | Paste or drop an SVG; render at 16/24/32/48/64 px on light and dark, with a pixel grid option to catch half-pixel strokes. Later: PNG / favicon export via canvas.                                |
| 5   | `codes`      | Codes      | QR codes as clean SVG.                                       | Text, URL, Wi-Fi presets; EC level and margin; SVG and PNG export. Write the encoder in-repo (the spec is fixed and it is testable) rather than bundling one. Code 128 later if needed.           |
| 6   | `diff`       | Diff       | Compare two texts, or two JSON documents structurally.       | Line diff side-by-side or unified; JSON mode compares parsed values (key order ignored). Handy for two SVG exports too.                                                                           |
| 7   | `time`       | Time       | Unix timestamps ⇄ dates, across time zones.                  | Seconds or milliseconds auto-detected; ISO 8601; relative ("in 3 h"). Small, and pairs with JWT's claims.                                                                                         |

## Out of scope

- **Separate SVG tools around the SVG app.** What drawing needs belongs in that app itself. Tools for
  cutting and plotting (nesting parts on a sheet, stroke-to-outline, toolpath previews) serve a
  different workflow.
- **Design utilities** (palettes, gradients, sprite slicing) until a real need shows up.

## Naming

- Slugs are lowercase kebab-case and match the folder under `apps/`.
- Short, tool-like names (`json`, `jwt`, `codes`, `svg`); no repeated suffix.
- Shared code moves into `packages/` only once two apps need it.
