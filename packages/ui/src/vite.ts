/**
 * Build-time wiring every Tools page shares, so an app's `vite.config.ts` is one line:
 *
 *     export default toolsApp("svg");
 *
 * From the catalog it sets the base path and output folder, writes the document `<title>`,
 * description and a link to the site's manifest, and starts the page header (see `appHeader`).
 *
 * The site installs as one app, the index with every tool inside it: one manifest at the site
 * root (emitted by the index page's build), scoped to the whole site, and one service worker
 * there, written by the site build once every app is built (see `site-worker.ts`).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin, UserConfig } from "vite";
import { APPS, findApp, listedApps, type ToolsApp } from "@tools/catalog";
import { SITE, appBase, siteBase } from "@tools/catalog/site";
// By package name, not "./theme.js": Node loads this file for the Vite config, and it does not
// map a .js specifier onto the .ts file beside it the way the bundler does.
import { THEME_BOOT_SCRIPT } from "@tools/ui/theme";
import { withIcons } from "@tools/ui/icons";

/** Served in dev instead of the real worker: it removes itself, so hot reload never sees a cache. */
const DEV_SW = "self.registration.unregister();\n";

/**
 * The site root as the pages see it, for `registerServiceWorker`: an app's own base is one
 * folder below it.
 */
const siteDefine = () => ({ "import.meta.env.TOOLS_SITE_BASE": JSON.stringify(siteBase()) });

const ICON = "icon.svg";
const MANIFEST = "manifest.webmanifest";
/** Set in CI for production builds; omitted locally and in PR builds. */
const CF_BEACON_ENV = "TOOLS_CF_BEACON_TOKEN";
const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** Vite config for the app at `apps/<slug>`. Fails the build if the catalog does not list it. */
export function toolsApp(slug: string): UserConfig {
  const app = findApp(slug);
  if (!app) throw new Error(`"${slug}" is not in packages/catalog — add it there first`);
  return {
    base: appBase(slug),
    // Not "spa": its fallback serves the app at any path under the base, where every relative
    // URL - the icon, the manifest, the demos - would resolve into the wrong folder.
    appType: "mpa",
    define: siteDefine(),
    plugins: [pageHead(() => app), appHeader(() => app), pageIcons()],
    build: { outDir: `../../dist/${slug}`, emptyOutDir: true, target: "es2022" },
  };
}

/** Vite config for the index page, at the site root. Each app is built into a folder beside it. */
export function toolsHome(): UserConfig {
  return {
    base: siteBase(),
    appType: "mpa",
    define: siteDefine(),
    plugins: [pageHead(() => null), pageIcons(), siteManifest()],
    // Not emptied: the site build writes the index first, then each app into its own folder.
    build: { outDir: "../../dist", emptyOutDir: false, target: "es2022" },
  };
}

const APPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps");

/**
 * One dev server for the whole site, laid out as it is deployed: the index at the site root and
 * each app in its folder beside it, so links between them, the manifest and the theme all work
 * as they do live, on one port. The index's `vite.config.ts` uses it for `vite` (serve); builds
 * stay one per app, so each app still compiles on its own.
 *
 * Vite's root is `apps/`, so `<base>svg/` is `apps/svg/index.html`. What differs from the apps
 * as they are built, this fills in: the index answers at the site root, each app's `public/`
 * files at its own base, each page gets its app's head, header and icons, and `BASE_URL` in an app's
 * code is its own base rather than the site's.
 */
export function toolsSite(): UserConfig {
  return {
    root: APPS_DIR,
    base: siteBase(),
    appType: "mpa",
    publicDir: false,
    define: siteDefine(),
    // The head goes in after Vite's own pass over the page: in dev, Vite puts the base in front
    // of every root-absolute URL it finds there, and the head's already carry it
    // (`/Tools/manifest.webmanifest` would become `/Tools/Tools/…`).
    plugins: [
      sitePages(),
      appHeader(appOfFile),
      pageIcons(),
      pageHead(appOfFile, "post"),
      siteManifest(),
      devWorker(),
    ],
    server: { port: 5170 },
  };
}

/** The app a file under `apps/` belongs to; null for the index page's own files. */
function appOfFile(file: string): ToolsApp | null {
  const rel = file.replace(/\\/g, "/").split("/apps/").at(-1) ?? "";
  return findApp(rel.split("/")[0] ?? "") ?? null;
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  json: "application/json",
  webmanifest: "application/manifest+json",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  woff2: "font/woff2",
};

function sitePages(): Plugin {
  const base = siteBase();
  const slugs = new Set(APPS.map((a) => a.slug));
  return {
    name: "tools-site-pages",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path = "", query] = (req.url ?? "").split("?");
        if (!path.startsWith(base)) return next();
        const rest = decodeURIComponent(path.slice(base.length));
        const [first = "", ...inside] = rest.split("/");
        // The index is the site root, as when it is built into dist/.
        if (rest === "" || rest === "index.html") {
          req.url = `${base}home/index.html${query ? `?${query}` : ""}`;
          return next();
        }
        // An app's folder without its slash: relative URLs in the page need the slash.
        if (slugs.has(first) && !inside.length) {
          res.statusCode = 301;
          res.setHeader("Location", `${base}${first}/`);
          return res.end();
        }
        // Files from an app's public/ at its base, the index's at the root; the rest is Vite's.
        const file = slugs.has(first)
          ? join(APPS_DIR, first, "public", ...inside)
          : join(APPS_DIR, "home", "public", rest);
        if (!rest.endsWith("/") && existsSync(file) && statSync(file).isFile()) {
          res.setHeader("Content-Type", MIME[file.split(".").pop()!] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "no-cache");
          return res.end(readFileSync(file));
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        // Script and style URLs from the page's own root ("/src/main.ts") are under its folder.
        const folder = appOfFile(ctx.filename)?.slug ?? "home";
        return html.replace(/(\s(?:src|href)=")\/src\//g, `$1/${folder}/src/`);
      },
    },
    transform(code, id) {
      // An app's own base, as its build has it; the index's is the site's, which Vite gives.
      const app = code.includes("import.meta.env.BASE_URL") ? appOfFile(id) : null;
      if (!app) return null;
      return code.replaceAll("import.meta.env.BASE_URL", JSON.stringify(appBase(app.slug)));
    },
  };
}

/**
 * The site's web app manifest, served at its root. Installed from any page, it is this one app:
 * it opens on the index, and every tool is inside its scope, so moving between them never
 * leaves it for the browser. Each listed tool is a shortcut (a long press on the launcher icon).
 */
export function manifestFor(apps: readonly ToolsApp[] = listedApps()): Record<string, unknown> {
  const svgIcon = (src: string) => ({ src, sizes: "any", type: "image/svg+xml", purpose: "any" });
  return {
    id: ".",
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: SITE.themeColor,
    theme_color: SITE.themeColor,
    icons: [svgIcon(ICON)],
    shortcuts: apps.map((a) => ({
      name: a.name,
      description: a.blurb,
      url: `${a.slug}/`,
      icons: [svgIcon(`${a.slug}/${ICON}`)],
    })),
  };
}

/** Cloudflare Web Analytics beacon, when `TOOLS_CF_BEACON_TOKEN` is set at build time. */
export function cfBeaconTag(
  env: Record<string, string | undefined> = process.env
): HtmlTagDescriptor | undefined {
  const token = env[CF_BEACON_ENV]?.trim();
  if (!token) return undefined;
  return {
    tag: "script",
    attrs: {
      type: "module",
      src: CF_BEACON_SRC,
      "data-cf-beacon": JSON.stringify({ token }),
    },
  };
}

/** The head tags a page gets from the catalog; `null` is the index page. */
export function headTags(
  app: ToolsApp | null,
  env: Record<string, string | undefined> = process.env
): HtmlTagDescriptor[] {
  const base = app ? appBase(app.slug) : siteBase();
  const title = app
    ? `${app.name} — ${SITE.name}`
    : `${SITE.name} — ${SITE.tagline.replace(/\.$/, "")}`;
  const description = app ? (app.description ?? app.blurb) : SITE.description;
  const tags: HtmlTagDescriptor[] = [
    { tag: "title", children: title },
    { tag: "meta", attrs: { name: "description", content: description } },
    { tag: "meta", attrs: { name: "theme-color", content: SITE.themeColor } },
    { tag: "meta", attrs: { name: "color-scheme", content: "dark light" } },
    // Runs while the head is parsed, before the body paints: a stored choice never flashes.
    { tag: "script", children: THEME_BOOT_SCRIPT },
    { tag: "meta", attrs: { property: "og:title", content: title } },
    { tag: "meta", attrs: { property: "og:description", content: description } },
    { tag: "meta", attrs: { property: "og:type", content: "website" } },
    // Absolute: a page reached at a deeper path must still find the files beside its index.
    { tag: "link", attrs: { rel: "icon", href: `${base}${ICON}`, type: "image/svg+xml" } },
  ];
  if (app) tags.push(compactHeaderTag(app));
  // Every page names the one manifest, so installing from any of them installs the whole site.
  tags.push({ tag: "link", attrs: { rel: "manifest", href: `${siteBase()}${MANIFEST}` } });
  const beacon = cfBeaconTag(env);
  if (beacon) tags.push(beacon);
  return tags.map((t) => ({ ...t, injectTo: t.injectTo ?? "head" }));
}

/** Screens up to this wide get "‹" alone when the catalog does not say otherwise. */
export const COMPACT_HEADER = 720;

/**
 * "‹ Tools  Name" reduced to "‹" (the words kept for screen readers) at and below the width the
 * catalog gives the app. Written into each page rather than kept in header.css, because a media
 * query cannot take its width from anywhere. First in the head, so an app's own stylesheet can
 * still size the button (the SVG app's touch layout does).
 */
function compactHeaderTag(app: ToolsApp): HtmlTagDescriptor {
  const width = app.compactHeader ?? COMPACT_HEADER;
  const css = [
    // "Up to and including" as a range, so a fractional width (browser zoom) falls on one side.
    `@media (width < ${width + 1}px) {`,
    "[data-tools-header] .ui-home { justify-content: center; min-width: 36px; padding: 0; }",
    "[data-tools-header] .ui-home::before { margin-left: 4px; }",
    "[data-tools-header] :is(.ui-home-label, .ui-app-name, .ui-app-status) {",
    "  position: absolute; width: 1px; height: 1px; overflow: hidden;",
    "  clip-path: inset(50%); white-space: nowrap;",
    "}",
    "}",
  ].join("\n");
  return {
    tag: "style",
    attrs: { "data-compact-header": String(width) },
    children: css,
    injectTo: "head-prepend",
  };
}

/** Which app a page belongs to, from its file; null for the index page. */
type AppOf = (file: string) => ToolsApp | null;

function pageHead(appOf: AppOf, order?: "post"): Plugin {
  return {
    name: "tools-page-head",
    transformIndexHtml: {
      order,
      handler(html, ctx) {
        // One source for the copy: a hand-written title would silently disagree with the catalog.
        if (/<title>|name="description"|rel="manifest"|name="color-scheme"/.test(html)) {
          throw new Error(
            "index.html must not set its own title, description, colour scheme or manifest"
          );
        }
        return headTags(appOf(ctx.filename));
      },
    },
  };
}

/** The attribute that marks an app's header, where its start is written from the catalog. */
const HEADER_ATTR = "data-tools-header";

/** Text made safe to write into HTML, attribute values included. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * How every app's header starts: back to the index, the app's name, and its status while it is
 * not stable. Styled by `@tools/ui/header.css`. They are direct children of the header, so an
 * app's own layout (a phone's floating buttons, say) can place each of them.
 */
export function headerStartHtml(app: ToolsApp): string {
  const status =
    app.status === "stable"
      ? ""
      : `<span class="ui-app-status ui-app-status--${app.status}">${app.status}</span>`;
  return (
    `<a class="ui-home" href="../" title="All ${escapeHtml(SITE.name.toLowerCase())}">` +
    `<span class="ui-home-label">${escapeHtml(SITE.name)}</span></a>` +
    `<h1 class="ui-app-name">${escapeHtml(app.name)}</h1>` +
    status
  );
}

/**
 * Writes `headerStartHtml` at the start of the page's `<header data-tools-header>`. The app's
 * markup brings only its own controls, so the name and badge cannot disagree with the catalog,
 * and a change to how headers start is made once, here.
 */
export function withHeaderStart(html: string, app: ToolsApp): string {
  if (/class="ui-home"|class="ui-app-name"/.test(html)) {
    throw new Error(
      `index.html must not write its own home link or name: ${HEADER_ATTR} adds them`
    );
  }
  const match = /<header\b[^>]*\sdata-tools-header(?:="")?(?=[\s>/])[^>]*>/.exec(html);
  if (!match) throw new Error(`index.html needs a <header ${HEADER_ATTR}> for the app's header`);
  const at = match.index + match[0].length;
  return html.slice(0, at) + headerStartHtml(app) + html.slice(at);
}

function appHeader(appOf: AppOf): Plugin {
  return {
    name: "tools-app-header",
    // Before Vite's own HTML handling, on the markup as written. The index has no app header.
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const app = appOf(ctx.filename);
        return app ? withHeaderStart(html, app) : html;
      },
    },
  };
}

/** Draws the shared icons into a page's empty `<svg data-ui-icon>` and `<symbol data-ui-icon>`. */
function pageIcons(): Plugin {
  return {
    name: "tools-icons",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const sprite = html.includes("<!-- tools:icons -->")
          ? readFileSync(join(dirname(ctx.filename), "src", "icons.svg"), "utf8")
          : undefined;
        return withIcons(html, sprite);
      },
    },
    configureServer(server) {
      server.watcher.add(APPS.map((app) => join(APPS_DIR, app.slug, "src", "icons.svg")));
      server.watcher.on("change", (file) => {
        if (file.replace(/\\/g, "/").endsWith("/src/icons.svg"))
          server.ws.send({ type: "full-reload" });
      });
    },
  };
}

/** The site's manifest, emitted at the root by the index page's build and served there in dev. */
function siteManifest(): Plugin {
  const body = `${JSON.stringify(manifestFor(), null, 2)}\n`;
  return {
    name: "tools-manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== `${siteBase()}${MANIFEST}`) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: MANIFEST, source: body });
    },
  };
}

/**
 * Under the dev server any `sw.js` removes itself, so hot reload never sees a cache. A build
 * writes none: the site build writes the real worker at the root once every app is built.
 */
function devWorker(): Plugin {
  return {
    name: "tools-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").split("?")[0]!.endsWith("/sw.js")) return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(DEV_SW);
      });
    },
  };
}
