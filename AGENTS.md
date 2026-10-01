# AGENTS.md

## Agent behavior

- Execute with tools; stay concise unless the user wants detail
- Prefer editing existing files; no secrets in code or logs
- No `git add` / `commit` / `push` unless the user asks
- Branch or PR work follows [Git](#git)
- Run the [format gate](#format-gate) after editing, and the [verify gate](#verify-gate) before finishing
- **Saved formats:** the SVG, JSON and JWT apps are released. JSON keeps only settings (`tools.json.prefs` in localStorage, read field by field with a default for anything missing or unknown) and a per-tab draft; a change to its settings must still read the old ones. JWT keeps only a per-tab draft (`DRAFT` in its `main.ts`); a change to it must still read the previous version rather than fail closed. A change to the SVG app's IndexedDB documents (`ProjectFile`) or exported SVG keeps existing files opening: bump `PROJECT_VERSION` (`types.ts`) and add the step up from the previous version in `readProject` (`project-file.ts`); the database's own `DB_VERSION` (`storage.ts`) is for its stores. Exported SVG carries no marker, so an SVG change must still import files written before it. An app that is not released yet has no migration — when its stored format changes, fail closed and tell the person to clear that app's storage.

## Project conventions

- **Shape:** Bun workspaces. Apps in `apps/`, shared code in `packages/`, repo scripts in `scripts/`.
- **Apps are independent and dependency-free at runtime.** Vite is a build tool, not a framework: an app compiles to plain static files that work off any file server. Do not add a runtime framework (React, Svelte, …) to an app. That rule is what keeps these tools working years from now. The one exception is code editing: CodeMirror 6, bundled and pinned, reached only through `@tools/editor` — never import `@codemirror/*` or `@lezer/*` from an app ([ADR 003](docs/adr/003-codemirror-for-code-editing.md)).
- **Catalog:** `packages/catalog/src/index.ts` is the single source of truth for which apps exist. Adding an app means one entry there plus one folder under `apps/`. The index page, the build and the deploy all read it — never hand-maintain a second list. An entry with `art: true` ships `apps/<slug>/public/art.svg` (320 × 320, translucent or no background so it suits both themes), shown across the top of its index card.
- **Deploy path:** `packages/catalog/src/site.ts` decides it, from `TOOLS_BASE`. GitHub Pages serves a project site from `/<repo>/`, so apps build with `base: /Tools/<slug>/`. Moving to a custom domain is a one-line change there, not a grep.
- **Package manager:** Bun. Do not add an npm or pnpm lockfile.
- **TypeScript:** strict, `verbatimModuleSyntax`, ESM with `.js` import specifiers. `noUncheckedIndexedAccess` is deliberately **off**: the geometry code is full of indexed loops where it buys assertions rather than safety.
- **Names:** kebab-case files; camelCase functions; PascalCase types. App slugs are lowercase and dash-separated, and match the folder name.
- **New app:** `bun run new-app <slug> "Display Name"` — it also adds an unlisted catalog entry to fill in.
- **App wiring:** an app's `vite.config.ts` is `defineConfig(toolsApp("<slug>"))` from `@tools/ui/vite`, used to build it; the site's one dev server serves it (see [Running it](#running-it)). It sets the base path and output folder, and injects `<title>`, description, icon and manifest from the catalog — so an app's `index.html` must not set those itself (the build fails if it does). Each app keeps its own `public/icon.svg`. The page links its stylesheet in `index.html` (`<link rel="stylesheet" href="/src/styles.css">`, which `@import`s `@tools/ui/base.css`) rather than importing CSS from the script: a linked stylesheet holds the first paint, so the page never shows unstyled while the script loads under the dev server.
- **Header:** every app's page has one `<header data-tools-header>` holding only its own controls. The build writes its start from the catalog — "‹ Tools", the app's name and, unless it is stable, its status badge — styled by `@tools/ui/header.css` (base.css imports it). Put the far-end controls (theme switch, Help) in `.ui-header-end`. The build fails if the marker is missing or the page writes its own home link or name.
- **Light / dark:** every page follows the browser until someone presses a theme switch; from then on the choice (`tools.theme` in localStorage, shared by the whole site) is light or dark, never "system" again. The Vite plugin inlines a script that applies it before first paint. Colours are CSS custom properties with a dark base and a light override keyed on `prefers-color-scheme` and `<html data-theme>` (see `packages/ui/tokens.css`); an app adds a button and calls `bindThemeToggle(button)` from `@tools/ui`, and repaints anything drawn outside CSS (a canvas) on `THEME_EVENT`.
- **Shared UI:** icons, side panels and menus come from `@tools/ui`, never drawn again in an app. An empty `<svg data-ui-icon="help">` (or sprite `<symbol data-ui-icon>`) is filled at build time from `icons.ts`; code uses `iconSvg`. Help and other side panels are `.ui-dock` with `bindDock` (open state kept per tab, placed under the header, full width on a phone); menus are `.ui-menu` popovers with `bindMenu` (styles in `packages/ui/panels.css`).
- **Settings:** preferences for the whole app go in a Settings (cog) menu in the header; what belongs to the document being edited stays with the document (the SVG app's size, grid and background, in its Document panel).
- **Phone header:** the header collapses in levels, each where the one before stops fitting (measure what the header needs; do not guess). First "‹ Tools Name" reduces to "‹", at the app's `compactHeader` width in the catalog (the build writes that rule; 720px by default). Then the app's own steps (JSON: the views become a dropdown at 645px, then the phone layout at 475px; SVG: the phone layout at 590px). The phone layout is one row that never wraps. What does not fit folds into a "⋯" menu, Help stays last in the bar, and the theme switch stays in the bar at every width. Buttons keep their size and spacing at every width (the header's measures in `header.css`: `--ui-control`, `--ui-group-gap`, `--ui-header-gap`); a level only moves, hides or folds things. Layout and button sizes follow the width alone, never the pointer (`pointer: coarse`), so a touch screen gets the same layout as a mouse at the same width; only what happens on a canvas (hit targets, drag thresholds) and which help is shown adapt to touch. The header stays a solid row at the top in every app; an app whose work is a canvas may float its drawing tools in a bar over the bottom of it (the SVG app). Buttons that belong together are joined into one control with `.ui-seg` (`header.css`).
- **Install and offline:** the site installs as one app — the index, with every tool inside its scope, so moving between tools never leaves the installed window. Every page links the one manifest at the site root (emitted by the index build; each listed app is a shortcut in it). Pages call `registerServiceWorker()` from `@tools/ui`, which registers the one worker at the site root; `scripts/build-site.ts` writes it last (`packages/ui/src/site-worker.ts` + `packages/ui/sw.js`) with a version hash and every file of every app to precache, so one visit makes all tools work offline and every deploy replaces the previous cache. Nothing is registered under the dev server.

## Git

GitHub protects the default branch (`main`) with an active ruleset: pull requests only (squash merge), linear history, required CI (“Lint, typecheck, test, build”), and related checks. Do not commit or push on `main`; land changes with a PR from a feature branch.

Use short, descriptive kebab-case branch names without `codex/`, `claude/`, or other agent prefixes.

Before changing code — on any branch, not only `main` — and whenever the user asks to create a branch, open or update a pull request, or push for review:

1. **Inspect first** — `git fetch origin`, then the current branch, clean or dirty tree, upstream tracking, and ahead/behind vs upstream and vs `origin/main`. Say what you found if it affects the plan.
2. **Check the branch is still open** — on a feature branch, ask GitHub whether its PR was already merged (`gh pr list --head <branch> --state all`). A squash-merged branch is finished: its commits reach `main` as one new commit with a different hash, so git no longer recognises them. Never add work to it or merge `origin/main` into it — both replay the merged changes as conflicts. Start a new branch from refreshed `main` instead, and carry over only commits made after the merge (`git rebase --onto origin/main <last-merged-commit>`, or `git cherry-pick`).
3. **Use a feature branch** — if the checkout is `main`, propose a concrete branch name (kebab-case, short and descriptive — e.g. `agents-git-sync`, `svg-export-fix`) and create/check it out before edits or commits unless the user already named a branch.
4. **Refresh `main`** — do not assume local `main` matches GitHub. Fast-forward it from `origin/main` (`git pull --ff-only origin main` while on `main`) before branching off it. Refreshing `main` never adds commits to it.
5. **Base the feature branch on current `main`** — before the first push, put work on top of `origin/main` (rebase while the branch is local-only; once it is on the remote, merge `origin/main`, or rebase only if the user accepts the force-push). Do not open a PR against a stale base and patch it up later with a merge commit.
6. **PR diffs use remote `main`** — compare against `origin/main` (`git log origin/main..HEAD`, `git diff origin/main...HEAD`), never a local `main` that may be stale. Before pushing, check that list holds only this branch's commits.

Default integration branch is `main`; use another base only when the user names one.

## Format gate

After editing any file Prettier or ESLint cares about, format **before** finishing the task — do not rely on `verify` alone.

| Touched paths                      | Command                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `.ts` / `.js`                      | `bunx eslint --fix <paths>` then `bunx prettier --write <paths>` |
| `.json` / `.md` / `.css` / `.html` | `bunx prettier --write <paths>`                                  |

Pass explicit paths for the files you changed, not a blind repo-wide format.

## Verify gate

| Change                   | Command          |
| ------------------------ | ---------------- |
| Any TypeScript           | `bun run check`  |
| Logic in a shared module | `bun run test`   |
| Task complete            | `bun run verify` |

`check` is lint + typecheck + format; `verify` adds tests and a full site build.

## Tests

- `bun test`, with happy-dom registered for apps that touch the DOM (see `apps/svg/bunfig.toml`).
- Pure logic over plain data is where the tests belong — `model.ts`, `project-file.ts`, and the SVG codecs in the SVG app are the model for this.
- **`apps/svg/src/lib/io.test.ts` guards one invariant worth understanding:** export → import → export must be byte-for-byte stable. The SVG app's live SVG panel re-imports its own output whenever typing pauses, so any instability there makes shapes drift or duplicate as the user types. Do not weaken that test.

## Running it

One dev server serves the whole site as deployed: `bun run dev` (port 5170; `bun run dev <slug>` also opens that app). The index's `vite.config.ts` uses `toolsSite()` from `@tools/ui/vite` for it; builds stay one per app. Do not start it — it is probably already running. Use `bun run build` to validate.
To preview the built site locally, build with the base at the root:

```bash
TOOLS_BASE=/ bun run build && bunx serve dist
```

On Windows, run that from PowerShell (`$env:TOOLS_BASE = '/'; bun run build`) or prefix it
with `MSYS_NO_PATHCONV=1`. Git Bash rewrites the bare `/` into a Windows path and the build bakes
that in as the base, which fails quietly: the page loads and every asset 404s.

## Shell

- **Scripted edits and one-off scripts: write them in TypeScript and run with `bun`**, not Python, sed or awk. Bun is already required by this repo and behaves the same on Windows, macOS and Linux. Do not assume `python`/`python3` exists or means a real interpreter: on Windows, `python3` is often a Microsoft Store stub that fails. For a handful of edits, the Edit tool is fine.
- If a tool or command fails for an environmental reason, note the cause and switch to a portable route — do not retry variants of the same command.

Do not leave background servers running. Bounded commands (`check`, `verify`, `build`) should use a timeout with buffer. Interactive auth CLIs: ask the user to run them.
