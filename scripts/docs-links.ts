#!/usr/bin/env bun
/**
 * Fails when a working-tree Markdown file links to a path that does not exist. Only relative links are
 * checked (external URLs and `#anchor` links are not), each from the folder of the file holding
 * it, as GitHub and editors follow them. Includes tracked and non-ignored new files,
 * excluding files deleted from the working tree, so checking does not require staging.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FENCE = /^\s*(?:```|~~~)/;
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** The relative link targets in Markdown, without anchors, outside fenced code. */
export function relativeLinks(markdown: string): { path: string; line: number }[] {
  const links: { path: string; line: number }[] = [];
  let fenced = false;
  markdown.split("\n").forEach((text, index) => {
    if (FENCE.test(text)) fenced = !fenced;
    if (fenced) return;
    for (const [, target] of text.matchAll(LINK)) {
      if (target.startsWith("#") || EXTERNAL.test(target)) continue;
      const path = decodeURI(target.split("#")[0]);
      if (path) links.push({ path, line: index + 1 });
    }
  });
  return links;
}

/** Links whose target is missing, as `file:line → target`. */
export function brokenLinks(root: string, files: readonly string[]): string[] {
  return files.flatMap((file) =>
    relativeLinks(readFileSync(join(root, file), "utf8"))
      .filter((link) => !existsSync(resolve(root, dirname(file), link.path)))
      .map((link) => `${file}:${link.line} → ${link.path}`)
  );
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const git = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.md"],
    { cwd: root }
  );
  if (git.exitCode !== 0) throw new Error("git ls-files failed: " + git.stderr.toString());
  const files = [...new Set(git.stdout.toString().split("\0").filter(Boolean))].filter((file) =>
    existsSync(join(root, file))
  );
  const broken = brokenLinks(root, files);
  if (broken.length) {
    console.error(`Broken Markdown links (${broken.length}):\n  ${broken.join("\n  ")}`);
    console.error("A link resolves from the folder of the file holding it, not the repo root.");
    process.exit(1);
  }
}
