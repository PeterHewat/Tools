# Tools

Small, self-contained browser tools. Everything runs client-side — your documents and files stay
in the browser — and each tool keeps working offline once you have opened it. The public site may
send anonymous page-view analytics to Cloudflare when you are online.

**[peterhewat.github.io/Tools](https://peterhewat.github.io/Tools/)**

The [site](https://peterhewat.github.io/Tools/) lists the tools and their capabilities.
The [catalog](packages/catalog/src/index.ts) is the source for that list.

## Running it

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

`bun run dev` serves the whole site with hot reload on one port (5170), laid out as it is
deployed: the index at `/Tools/` and each app beside it, so the links between them work.
`bun run dev svg` does the same and opens that app.

To build and preview the whole site, including the index page:

```bash
TOOLS_BASE=/ bun run build && bunx serve dist
```

On Windows, run that from PowerShell (`$env:TOOLS_BASE = '/'; bun run build`) or prefix it
with `MSYS_NO_PATHCONV=1`. Git Bash rewrites the bare `/` into a Windows path and the build bakes
that in as the base, which fails quietly: the page loads and every asset 404s.

## Adding a tool

```bash
bun run new-app color-forge "Color Forge"
```

That scaffolds `apps/color-forge` and adds an unlisted entry to
[`packages/catalog`](./packages/catalog/src/index.ts). The catalog is the only list — the index
page, the build, each page's title and manifest, and the deploy all read from it.

The scaffold includes the shared theme toggle and Help dock. Put help content in
`.ui-dock-body.ui-help`; `<div data-tools-about></div>` becomes the common About preface
using the catalog name. `bindToolHelp(slug)` wires both header buttons and remembers the
Help dock's open state for the tab.

JWT, Codec, Codes and Digests keep versioned session drafts with `readDraft` / `writeDraft`
from `@tools/ui`. These restore the current tab on reload, including entered keys, but a
fresh tab starts with defaults. Drafts are limited to 2 MB; an incompatible format asks
the user to clear that app's session storage. Native file selections must be made again
after a reload.

## How it is put together

```text
apps/          one folder per tool, plus `home` (the index page)
packages/
  catalog/     which apps exist, and where the site is deployed
  ui/          shared styles, browser helpers, build wiring and the offline service worker
  editor/      the code editor the apps share: CodeMirror 6 behind a small API
  bytes/       strict UTF-8, hex and Base64 codecs, and Web Crypto helpers
  json-core/   source-preserving JSON parser and formatter shared by JSON and JWT
  tsconfig/    shared TypeScript config
scripts/       build and scaffold scripts
docs/          decisions, reference and plans
```

Each app is TypeScript built by Vite into plain static files, with **no runtime framework**.
Vite is a build tool here, not a foundation: the output is HTML, CSS and ES modules that will
still work off any file server in ten years. The one library bundled in is CodeMirror, for
editing code, reached only through `packages/editor`
([ADR 003](docs/adr/003-codemirror-for-code-editing.md)).

## Commands

| Command                | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `bun run dev [slug]`   | Serve the whole site with hot reload               |
| `bun run check`        | Lint, typecheck and format check                   |
| `bun run test`         | Run the test suites                                |
| `bun run test:browser` | Check the production build in Chromium and Firefox |
| `bun run build`        | Build the whole site into `dist/`                  |
| `bun run verify`       | `check` + `test` + `build`                         |
| `bun run new-app`      | Scaffold a new app                                 |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). `bun run verify` is the check CI runs. Everyone taking part
follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE).
