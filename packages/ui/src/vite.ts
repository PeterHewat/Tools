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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin, UserConfig } from "vite";
import { APPS, findApp, listedApps, type ToolsApp } from "@tools/catalog";
import { SITE, appBase, siteBase } from "@tools/catalog/site";
// By package name, not "./theme.js": Node loads this file for the Vite config, and it does not
// map a .js specifier onto the .ts file beside it the way the bundler does.
import { THEME_BOOT_SCRIPT } from "@tools/ui/theme";

/** Served in dev instead of the real worker: it removes itself, so hot reload never sees a cache. */
const DEV_SW = "self.registration.unregister();\n";

/**
 * Each app folder's `sw.js`. Until the site shared one worker, every app registered its own,
 * scoped to its folder, and a browser that has one checks that URL for updates; this is what it
 * finds. It removes itself, so the site's worker at the root takes the folder over (and clears
 * its cache). Keep it while such browsers may still be about.
 */
export const RETIRED_WORKER =
  "// Replaced by the site's worker at the root, which now answers for this folder too.\n" +
  'self.addEventListener("install", () => self.skipWaiting());\n' +
  'self.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister()));\n';

/**
 * The site root as the pages see it, for `registerServiceWorker`: an app's own base is one
 * folder below it.
 */
const siteDefine = () => ({ "import.meta.env.TOOLS_SITE_BASE": JSON.stringify(siteBase()) });

const ICON = "icon.svg";
const MANIFEST = "manifest.webmanifest";
/** Set in CI for production builds; omitted locally and in PR builds. */
export const CF_BEACON_ENV = "TOOLS_CF_BEACON_TOKEN";
const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** Vite config for the app at `apps/<slug>`. Fails the build if the catalog does not list it. */
export function toolsApp(slug: string): UserConfig {
  const app = findApp(slug);
  if (!app) throw new Error(`"${slug}" is not in packages/catalog — add it there first`);
  return {
    base: appBase(slug),
    // Not "spa": its fallback served the app at any path under the base, where every relative
    // URL - the icon, the manifest, the welcome drawing - then resolved into the wrong folder.
    appType: "mpa",
    define: siteDefine(),
    plugins: [pageHead(app), appHeader(app), workers(app)],
    build: { outDir: `../../dist/${slug}`, emptyOutDir: true, target: "es2022" },
  };
}

/** Vite config for the index page, at the site root. Each app is built into a folder beside it. */
export function toolsHome(): UserConfig {
  return {
    base: siteBase(),
    appType: "mpa",
    define: siteDefine(),
    plugins: [pageHead(null), siteManifest(), workers(null), appArtInDev()],
    // Not emptied: the site build writes the index first, then each app into its own folder.
    build: { outDir: "../../dist", emptyOutDir: false, target: "es2022" },
  };
}

/**
 * Serves each app's card art to the index page's dev server. In a built site `<slug>/art.svg`
 * is the app's own file, in the folder beside the index; the dev server has only the index, so
 * without this every card's picture is a 404.
 */
function appArtInDev(): Plugin {
  const appsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps");
  return {
    name: "tools-app-art",
    apply: "serve",
    configureServer(server) {
      const art = new Map(
        APPS.filter((a) => a.art).map((a) => [
          `${siteBase()}${a.slug}/art.svg`,
          join(appsDir, a.slug, "public", "art.svg"),
        ])
      );
      server.middlewares.use((req, res, next) => {
        const file = art.get((req.url ?? "").split("?")[0] ?? "");
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(readFileSync(file));
      });
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
  // Every page names the one manifest, so installing from any of them installs the whole site.
  tags.push({ tag: "link", attrs: { rel: "manifest", href: `${siteBase()}${MANIFEST}` } });
  const beacon = cfBeaconTag(env);
  if (beacon) tags.push(beacon);
  return tags.map((t) => ({ ...t, injectTo: "head" }));
}

function pageHead(app: ToolsApp | null): Plugin {
  return {
    name: "tools-page-head",
    transformIndexHtml(html) {
      // One source for the copy: a hand-written title would silently disagree with the catalog.
      if (/<title>|name="description"|rel="manifest"|name="color-scheme"/.test(html)) {
        throw new Error(
          "index.html must not set its own title, description, colour scheme or manifest"
        );
      }
      return headTags(app);
    },
  };
}

/** The attribute that marks an app's header, where its start is written from the catalog. */
export const HEADER_ATTR = "data-tools-header";

function escapeHtml(s: string): string {
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

function appHeader(app: ToolsApp): Plugin {
  return {
    name: "tools-app-header",
    // Before Vite's own HTML handling, on the markup as written.
    transformIndexHtml: { order: "pre", handler: (html) => withHeaderStart(html, app) },
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
 * Under the dev server any `sw.js` removes itself, so hot reload never sees a cache. An app's
 * build puts the retired worker in its folder; the index's puts nothing, because the site build
 * writes the real worker there once every app is built.
 */
function workers(app: ToolsApp | null): Plugin {
  return {
    name: "tools-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").split("?")[0]!.endsWith("/sw.js")) return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(DEV_SW);
      });
    },
    generateBundle() {
      if (app) this.emitFile({ type: "asset", fileName: "sw.js", source: RETIRED_WORKER });
    },
  };
}
