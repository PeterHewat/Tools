/**
 * The one service worker for the whole site, written by the site build (`scripts/build-site.ts`)
 * once every app is in `dist/`.
 *
 * It sits at the site root, so its scope holds the index and every app: installed from any page,
 * the site is one app that opens on the index, moves between tools without leaving it, and has
 * all of them offline after the first visit. `sw.js` is its logic; this prepends the constants.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SW_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "sw.js"),
  "utf8"
);

/**
 * Where it lives. An app folder's own `sw.js` is the retired worker (`RETIRED_WORKER`), for
 * browsers that installed one before the site shared this one.
 */
export const SITE_WORKER = "sw.js";

/** Never precached: the worker itself, each folder's retired one, and Pages' not-found page. */
export function isPrecached(path: string): boolean {
  return path !== "404.html" && !(path === SITE_WORKER || path.endsWith(`/${SITE_WORKER}`));
}

/**
 * The worker's source for these files (paths relative to the site root, with their bytes).
 * `VERSION` hashes them all, so any change to any app ships a new worker, and the browser swaps
 * the whole cache for the new build's.
 */
export function siteWorker(files: readonly { path: string; bytes: Uint8Array }[]): string {
  const kept = files.filter((f) => isPrecached(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  const hash = createHash("sha256");
  for (const f of kept) hash.update(f.path).update(f.bytes);
  return (
    `const VERSION = ${JSON.stringify(hash.digest("hex").slice(0, 16))};\n` +
    `const PRECACHE = ${JSON.stringify(kept.map((f) => f.path))};\n` +
    SW_SOURCE
  );
}

/** Every file under `dir`, as `siteWorker` takes them. */
export function readTree(dir: string): { path: string; bytes: Uint8Array }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const full = join(d.parentPath, d.name);
      return { path: relative(dir, full).replace(/\\/g, "/"), bytes: readFileSync(full) };
    });
}
