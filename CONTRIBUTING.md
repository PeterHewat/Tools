# Contributing

Tools is a set of small tools that run in the browser. A change keeps each app as static files: no runtime framework, and no runtime dependency in the shipped bundle. The decisions behind that are in [docs/adr](./docs/adr). Taking part means following the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

Requires [Bun](https://bun.sh) 1.4.2 or newer.

```bash
bun install
bun run verify
```

`bun run verify` is lint, typecheck, format check, tests, and a full site build. CI runs those steps followed by the browser suite. The [README](./README.md) covers `bun run dev` and the Windows note about `TOOLS_BASE`.

## Where to change things

- A new tool is `bun run new-app <slug> "Display Name"`. That creates `apps/<slug>` and an unlisted catalog entry. [`packages/catalog`](./packages/catalog/src/index.ts) is the only list of apps — the index, the build, and each page's title read it.
- Shared browser behaviour goes in `packages/ui`. Code only one app uses stays in that app until a second one needs it. The catalog holds data, not app code.
- In the SVG app, [`model.ts`](./apps/svg/src/lib/model.ts) owns construction, transforms and editing. [`element-geometry.ts`](./apps/svg/src/lib/element-geometry.ts) owns bounds and rendering geometry; [`element-style.ts`](./apps/svg/src/lib/element-style.ts) owns paint and style attributes. [`project-file.ts`](./apps/svg/src/lib/project-file.ts) validates saved documents. Canvas gestures live in [`interaction.ts`](./apps/svg/src/lib/interaction.ts), ruler gestures in [`ruler-guides.ts`](./apps/svg/src/lib/ruler-guides.ts).

## Tests

Put a test next to the pure logic it covers, the way `model.test.ts` sits beside `model.ts`. Prefer plain data over a rendered page.

[`io.test.ts`](./apps/svg/src/lib/io.test.ts) checks that export, then import, then export is byte-for-byte the same. The live SVG panel re-imports its own output, so an unstable serializer makes shapes drift while someone types. Leave that test as it is.

After a build, run real-browser checks with:

```bash
bunx playwright install chromium firefox
bun run test:browser
```

The suite uses isolated profiles and a temporary production-file server on port 5171, shut down by Playwright. It does not use or stop the development server on 5170. Chromium and Firefox cover editing, drawing, source-panel loading, keyboard menus, responsive headers, and automated WCAG A/AA checks in both themes. Chromium also covers native touch drawing/pinch and offline service-worker replacement. Automated accessibility checks complement manual keyboard and screen-reader testing; they do not certify accessibility.

Builds enforce gzip JavaScript budgets from the catalog's `jsBudget`: the initial entry and static module preloads, plus all chunks including lazy ones. The SVG source editor loads when visible; all chunks are still precached for offline use. Change a budget only after measuring and explaining the additional cost.

## Saved documents

The SVG app is released. A drawing lives in the browser's IndexedDB (`ProjectFile`, currently version 1) and in exported SVG. A change to either keeps documents people already have opening: bump `PROJECT_VERSION` in `types.ts` and add the step up from the previous version in `readProject` (`project-file.ts`). Exported SVG carries no version marker, so an importer change must still read files written before it.

An app that is not released yet has no saved documents to carry forward. When its stored format changes, fail and tell the person to clear that app's storage.

## Docs

Each app is described in [`docs/apps`](./docs/apps). When a description and the code disagree, fix the description. An app that is not built yet says so at the top. On a built app, an idea that is not built yet goes under Later in that file.
