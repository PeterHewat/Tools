#!/usr/bin/env bun
/**
 * Builds the whole site into `dist/`: the index page at the root, then one folder per app.
 *
 * Apps come from the catalog, so adding one to `packages/catalog` is all it takes to get it
 * built and listed. Last, it writes the site's one service worker at the root, precaching every
 * file of every app (see `@tools/ui/site-worker`), so the installed site is whole offline.
 */
import { rm, mkdir, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APPS } from "../packages/catalog/src/index.ts";
import { siteBase } from "../packages/catalog/src/site.ts";
import { SITE_WORKER, readTree, siteWorker } from "@tools/ui/site-worker";
import { cfBeaconTag } from "@tools/ui/vite";
import { checkJsBudget } from "./bundle-budget.ts";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd} (exit ${code})`);
}

async function main(): Promise<void> {
  console.log(`Building site at base ${siteBase()}`);
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // The index page first: it writes into dist/ with emptyOutDir off, so app folders survive.
  await run(["bun", "run", "build"], join(ROOT, "apps", "home"));

  for (const app of APPS) {
    const dir = join(ROOT, "apps", app.slug);
    if (!existsSync(dir)) {
      throw new Error(`Catalog lists "${app.slug}" but apps/${app.slug} does not exist`);
    }
    console.log(`\n→ ${app.name}`);
    await run(["bun", "run", "build"], dir);
    const budget = app.jsBudget ?? { entryGzip: 150, totalGzip: 210 };
    const sizes = checkJsBudget(app.name, readTree(join(DIST, app.slug)), budget);
    console.log(
      `JavaScript gzip: entry ${(sizes.entry / 1024).toFixed(1)} KiB, total ${(sizes.total / 1024).toFixed(1)} KiB`
    );
  }

  // GitHub Pages serves 404.html for unknown paths; point it at the index.
  await copyFile(join(DIST, "index.html"), join(DIST, "404.html"));

  // With a token, every page counts its visits: a page built without the beacon fails the deploy.
  const beacon = cfBeaconTag()?.attrs?.["data-cf-beacon"];
  if (typeof beacon === "string") {
    const marker = beacon.replaceAll('"', "&quot;");
    for (const page of ["index.html", ...APPS.map((app) => `${app.slug}/index.html`)]) {
      const html = await readFile(join(DIST, page), "utf8");
      if (!html.includes(marker) && !html.includes(beacon)) {
        throw new Error(`${page} has no analytics beacon`);
      }
    }
  }

  // Last, once every file it precaches is in place: the one worker, for the whole site.
  await writeFile(join(DIST, SITE_WORKER), siteWorker(readTree(DIST)));

  const entries = await readdir(DIST);
  console.log(`\nBuilt ${APPS.length} app(s) + index into dist/ (${entries.length} entries)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
