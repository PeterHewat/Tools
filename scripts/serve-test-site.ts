/** A bounded Playwright-owned static host, including an in-memory second deploy for update tests. */
import { extname } from "node:path";
import { readTree, siteWorker } from "@tools/ui/site-worker";
import { siteBase } from "../packages/catalog/src/site.ts";

const files = new Map(readTree("dist").map(({ path, bytes }) => [path, bytes]));
const base = siteBase();
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const encoder = new TextEncoder();
Bun.serve({
  hostname: "127.0.0.1",
  port: 5171,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__test/deploy" && req.method === "POST") {
      for (const [path, bytes] of files) {
        if (path.endsWith("index.html"))
          files.set(
            path,
            encoder.encode(
              new TextDecoder()
                .decode(bytes)
                .replace("</body>", '<span hidden id="updated-build"></span></body>')
            )
          );
      }
      files.set(
        "sw.js",
        encoder.encode(siteWorker([...files].map(([path, bytes]) => ({ path, bytes }))))
      );
      return new Response("Updated");
    }
    if (!url.pathname.startsWith(base) || req.method !== "GET")
      return new Response(null, { status: 404 });
    let path = decodeURIComponent(url.pathname.slice(base.length));
    if (!path || path.endsWith("/")) path += "index.html";
    const bytes = files.get(path);
    return bytes
      ? new Response(new Uint8Array(bytes), {
          headers: {
            "Content-Type": types[extname(path)] ?? "application/octet-stream",
            "Cache-Control": "no-store",
          },
        })
      : new Response(null, { status: 404 });
  },
});
