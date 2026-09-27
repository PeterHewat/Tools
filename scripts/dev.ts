#!/usr/bin/env bun
/**
 * Serves the whole site with hot reload, on one port: `bun run dev`, or `bun run dev <slug>` to
 * open that app's page. The index at the root, every app in its folder beside it, as deployed
 * (see `toolsSite` in `@tools/ui/vite`). Extra arguments go to Vite: `bun run dev -- --port 5170`.
 */
import { join } from "node:path";
import { APPS } from "../packages/catalog/src/index.ts";
import { siteBase } from "../packages/catalog/src/site.ts";

const ROOT = join(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const slug = args[0] && !args[0].startsWith("-") ? args.shift() : undefined;

if (slug && slug !== "home" && !APPS.some((a) => a.slug === slug)) {
  console.error("Usage: bun run dev [app] [vite args]");
  console.error(`  [app] opens that page: ${APPS.map((a) => a.slug).join(", ")}`);
  process.exit(1);
}

const open = slug && slug !== "home" ? ["--open", `${siteBase()}${slug}/`] : [];
const proc = Bun.spawn(["bun", "run", "dev", ...open, ...args], {
  cwd: join(ROOT, "apps", "home"),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
