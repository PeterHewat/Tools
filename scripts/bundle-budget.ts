import { gzipSync } from "node:zlib";

export interface JsBudget {
  /** KiB of gzip-compressed JavaScript: entry plus module preloads, and all chunks. */
  entryGzip: number;
  totalGzip: number;
}

export function checkJsBudget(
  label: string,
  files: readonly { path: string; bytes: Uint8Array }[],
  budget: JsBudget
): { entry: number; total: number } {
  const html = files.find((file) => file.path === "index.html");
  if (!html) throw new Error(`${label}: missing index.html`);
  const text = new TextDecoder().decode(html.bytes);
  const initial = new Set<string>();
  for (const tag of text.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (!/\b(?:type="module"|rel="modulepreload")/.test(tag[0])) continue;
    const source = /\b(?:src|href)="([^"]+)"/.exec(tag[0])?.[1];
    if (source) initial.add(source.slice(source.lastIndexOf("/assets/") + 1));
  }
  if (!initial.size) throw new Error(`${label}: missing JavaScript entry`);
  let entry = 0,
    total = 0;
  for (const file of files.filter((file) => file.path.endsWith(".js"))) {
    const size = gzipSync(file.bytes).byteLength;
    total += size;
    if (initial.delete(file.path)) entry += size;
  }
  if (initial.size) throw new Error(`${label}: missing initial assets: ${[...initial].join(", ")}`);
  if (entry > budget.entryGzip * 1024 || total > budget.totalGzip * 1024) {
    throw new Error(
      `${label}: JavaScript exceeds its gzip budget (entry ${(entry / 1024).toFixed(1)}/${budget.entryGzip} KiB, total ${(total / 1024).toFixed(1)}/${budget.totalGzip} KiB)`
    );
  }
  return { entry, total };
}
