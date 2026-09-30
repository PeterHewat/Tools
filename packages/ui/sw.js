/**
 * The site's service worker: one, at the site root, for the index and every app.
 *
 * The site build (src/site-worker.ts) prepends two constants: `VERSION`, a hash of the whole
 * build, and `PRECACHE`, every file in it (relative to the worker). A new deploy therefore ships
 * a byte-different worker, the browser installs it, and it drops the previous build's cache — so
 * hashed assets from old deploys do not pile up forever.
 *
 * Its caches are named `tools:<scope>:<version>`; on activation it removes every `tools:` cache
 * but its own.
 */
/* global VERSION, PRECACHE */

const CACHE = `tools:${self.registration.scope}:${VERSION}`;
const OWNED = new Set(PRECACHE.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Past the HTTP cache: Pages lets a browser keep a file ten minutes, and a new build must
      // not precache the previous one's index.html (naming scripts that are gone) or demos.
      .then((cache) => cache.addAll([...OWNED].map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("tools:") && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * The precached file a request is for, or null. A folder is its index.html, and the query and
 * hash do not count: `svg/`, `svg/?x=1` and `svg/index.html` are one page.
 */
function ownKey(req) {
  const url = new URL(req.url);
  url.search = "";
  url.hash = "";
  const href = url.href.endsWith("/") ? `${url.href}index.html` : url.href;
  return OWNED.has(href) ? href : null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const key = ownKey(req);
  if (!key) return;

  if (req.mode === "navigate") {
    // Online, the page is always fresh; offline, the precached copy of this build.
    event.respondWith(fetch(req).catch(() => caches.match(key).then((hit) => hit ?? offline())));
    return;
  }
  // Everything else in the build is content-hashed or versioned with the worker: cache first.
  event.respondWith(caches.match(key).then((hit) => hit ?? fetch(req)));
});

function offline() {
  return new Response("Offline", { status: 503, statusText: "Offline" });
}
