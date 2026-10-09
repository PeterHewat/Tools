# Roadmap

One overview of the apps. Each name links to a description: what the app does, or the design when
it is not built yet. On a built app, ideas that are not built are appended under Later. Status in
this table is the release or the proposed place in line, not a promise that a Later item will ship.

## Apps

**Stable**, **Beta** and **Experiment** are catalog release statuses; an unlisted experiment
may not appear on the public index. **Next** is the next proposed new app, not work already
under way; **Planned** is a later proposal. Future rows are ordered by build priority.

| App                        | Status  | Purpose                                                                                                                                                   |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SVG](apps/svg.md)         | Stable  | Trace images with a Bézier pen and shapes; combine, align, group and fill with gradients. A searchable library of drawings, exported as clean SVG or PNG. |
| [JSON](apps/json.md)       | Stable  | Format, minify, fold and validate JSON, and fix almost-JSON. Convert it to YAML, CSV, TypeScript types or a JSON Schema.                                  |
| [JWT](apps/jwt.md)         | Stable  | Decode, encode and verify JSON Web Tokens with HMAC, RSA, ECDSA and Ed25519.                                                                              |
| [Codes](apps/codes.md)     | Stable  | QR codes for links, Wi-Fi, contacts, events and more, with your colours, shapes, logo and frame; plus Code 128, EAN-13 and UPC-A barcodes.                |
| [Codec](apps/codec.md)     | Stable  | Convert UTF-8 text, Base64, Base64url, URL components and hex, with every byte visible.                                                                   |
| [Digests](apps/digests.md) | Stable  | Hash text and files with every SHA at once, check an expected digest, and compute HMAC.                                                                   |
| [Time](apps/time.md)       | Next    | Convert timestamps, compare availability and measure durations.                                                                                           |
| [Diff](apps/diff.md)       | Planned | Compare two texts or JSON documents, with clear changes and navigation.                                                                                   |
| [Certs](apps/certs.md)     | Planned | Inspect X.509 certificates, chains and related data.                                                                                                      |
| [Notes](apps/notes.md)     | Planned | Write Markdown and organise a small local collection of notes.                                                                                            |
| [Magnet](apps/magnet.md)   | Planned | Inspect torrent metadata and convert infohashes and magnet links.                                                                                         |

## Shared groundwork and boundaries

- `@tools/ui` supplies themes, headers, panels, menus, editor cards, copy/download helpers
  and app build wiring.
- `@tools/editor` supplies CodeMirror behind one API; see the
  [editor description](editor.md) and [ADR 003](adr/003-codemirror-for-code-editing.md).
- `@tools/bytes` supplies strict UTF-8, hex, Base64/Base64url and Web Crypto helpers.
- `@tools/json-core` supplies source-preserving JSON parsing and formatting.

Core features run locally, offline and from static hosting, under
[ADR 001](adr/001-static-apps-no-framework.md). Certs' optional revocation relay requires
a separate design decision. Keep a feature when it helps complete the same task with the
same input; give each app an explicit scope boundary. Drawing features belong in SVG.
Cutting and plotting tools serve a different workflow; palettes, gradients and sprite
slicing are outside the roadmap until a concrete need appears.

Names stay short and tool-like; slugs are lowercase kebab-case. New apps are scaffolded
with `bun run new-app`. Shared logic moves to `packages/` when a second app needs it.
Use existing shared controls, respect saved-format rules and measure bundle growth before
raising a budget.

## Maintaining this roadmap

Edit this table when priorities or release statuses change. Future row order is the proposed
build order. The [catalog](../packages/catalog/src/index.ts) controls which apps are built and
their release statuses; this page is the human-readable overview. Do not repeat status or
priority in an app file.

An app file describes what is built. When it and the code disagree, the code is right and the
file is fixed. Append an idea that is not built under Later; when it ships, write it into the
description and remove it from Later. An app that is not built yet says so at the top, and the
file is its design: append further ideas there.
