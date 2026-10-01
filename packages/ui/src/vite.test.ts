import { describe, expect, test } from "bun:test";
import { findApp } from "@tools/catalog";
import { SITE, appBase, siteBase } from "@tools/catalog/site";
import { THEME_BOOT_SCRIPT, THEME_KEY } from "./theme.js";
import {
  cfBeaconTag,
  COMPACT_HEADER,
  headTags,
  headerStartHtml,
  manifestFor,
  toolsApp,
  toolsHome,
  toolsSite,
  withHeaderStart,
  withHelpAbout,
} from "./vite.js";

const svg = findApp("svg")!;

test("the shared About preface uses each catalog name and leaves existing help intact", () => {
  for (const slug of ["svg", "json", "jwt", "codec", "codes", "digests"]) {
    const result = withHelpAbout("<div data-tools-about></div><h3>Features</h3>", findApp(slug)!);
    expect(result).toContain(findApp(slug)!.name + " is part of a set");
    expect(result).toContain('href="../"');
    expect(result).toContain("keep working offline");
    expect(result).toEndWith("<h3>Features</h3>");
  }
});

describe("toolsApp", () => {
  test("refuses an app the catalog does not list", () => {
    expect(() => toolsApp("not-an-app")).toThrow(/not in packages\/catalog/);
  });

  test("builds into the app's folder under the site", () => {
    const config = toolsApp("svg");
    expect(config.build?.outDir).toBe("../../dist/svg");
    expect(config.base).toEndWith("/svg/");
  });
});

describe("page head", () => {
  const attr = (tags: ReturnType<typeof headTags>, key: string, value: string) =>
    tags.find((t) => t.attrs?.[key] === value);

  test("an app's title and description come from the catalog", () => {
    const tags = headTags(svg);
    expect(tags.find((t) => t.tag === "title")?.children).toBe("SVG — Tools");
    expect(attr(tags, "name", "description")?.attrs?.content).toBe(svg.description!);
    expect(attr(tags, "rel", "manifest")).toBeDefined();
  });

  test('each app\'s header reduces to "‹" at the width its catalog entry gives, first in the head', () => {
    const style = (app: typeof svg) => headTags(app).find((t) => t.tag === "style");
    expect(style(svg)?.children).toContain(`@media (width < ${svg.compactHeader! + 1}px)`);
    expect(style(svg)?.injectTo).toBe("head-prepend");
    expect(style({ ...svg, compactHeader: undefined })?.children).toContain(
      `(width < ${COMPACT_HEADER + 1}px)`
    );
    expect(headTags(null).some((t) => t.tag === "style")).toBe(false);
  });

  test('an app may drop "Tools" first, at a wider screen, keeping its name', () => {
    const css = headTags({ ...svg, compactHeader: 200, compactHome: 389 }).find(
      (t) => t.tag === "style"
    )!.children as string;
    expect(css.indexOf("(width < 390px)")).toBeLessThan(css.indexOf("(width < 201px)"));
    const first = css.slice(0, css.indexOf("(width < 201px)"));
    expect(first).toContain(".ui-home-label {");
    expect(first).not.toContain(".ui-app-name");
  });

  test("the icon is the app's own, addressed from its base rather than from the page", () => {
    expect(attr(headTags(svg), "rel", "icon")?.attrs?.href).toBe(`${appBase("svg")}icon.svg`);
  });

  test("every page, the index and each app, names the site's one manifest", () => {
    for (const tags of [headTags(svg), headTags(null)]) {
      expect(attr(tags, "rel", "manifest")?.attrs?.href).toBe(`${siteBase()}manifest.webmanifest`);
    }
  });

  test("an unknown path is a 404, not the app served somewhere it does not live", () => {
    expect(toolsApp("svg").appType).toBe("mpa");
  });

  test("the analytics beacon is omitted unless a token is set at build time", () => {
    const env = {};
    expect(cfBeaconTag(env)).toBeUndefined();
    const hasBeacon = (tags: ReturnType<typeof headTags>) =>
      tags.some((t) => String(t.attrs?.src ?? "").includes("cloudflareinsights"));
    expect(hasBeacon(headTags(svg, env))).toBe(false);
    const withToken = { TOOLS_CF_BEACON_TOKEN: "test-token" };
    const beacon = cfBeaconTag(withToken)!;
    expect(String(beacon.attrs?.src)).toContain("cloudflareinsights");
    expect(beacon.attrs?.["data-cf-beacon"]).toBe(JSON.stringify({ token: "test-token" }));
    expect(
      headTags(null, withToken).some(
        (t) => t.attrs?.["data-cf-beacon"] === beacon.attrs?.["data-cf-beacon"]
      )
    ).toBe(true);
  });

  test("every page applies a stored theme from the head, before it paints", () => {
    for (const tags of [headTags(svg), headTags(null)]) {
      expect(tags.find((t) => t.tag === "script")?.children).toBe(THEME_BOOT_SCRIPT);
      expect(attr(tags, "name", "color-scheme")?.attrs?.content).toBe("dark light");
    }
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_KEY));
  });
});

describe("app header", () => {
  const json = findApp("json")!;
  const page = (header: string) => `<body>${header}<button>Mine</button></header></body>`;

  test("starts with the way back, then the app's name from the catalog", () => {
    const html = withHeaderStart(page('<header class="ui-header" data-tools-header>'), svg);
    expect(html).toContain(
      '<header class="ui-header" data-tools-header><a class="ui-home" href="../"'
    );
    expect(html).toContain('<h1 class="ui-app-name">SVG</h1><button>Mine</button>');
  });

  test("a stable app has no badge; one that is not says what it is", () => {
    expect(headerStartHtml({ ...svg, status: "stable" })).not.toContain("ui-app-status");
    expect(headerStartHtml({ ...json, status: "beta" })).toContain(
      '<span class="ui-app-status ui-app-status--beta">beta</span>'
    );
  });

  test("an abbreviated name is followed by the name in full, outside the heading", () => {
    expect(headerStartHtml({ ...json, title: "JavaScript Object Notation" })).toContain(
      '<h1 class="ui-app-name">JSON</h1><span class="ui-app-title">JavaScript Object Notation</span>'
    );
    expect(headerStartHtml(svg)).not.toContain("ui-app-title");
  });

  test("the marker is found among other attributes", () => {
    const html = withHeaderStart(page('<header class="x" data-tools-header role="toolbar">'), svg);
    expect(html).toContain('role="toolbar"><a class="ui-home"');
  });

  test("a page without the marker, or with its own home link, fails the build", () => {
    expect(() => withHeaderStart(page("<header>"), svg)).toThrow(/data-tools-header/);
    expect(() =>
      withHeaderStart(page('<header data-tools-header><a class="ui-home">'), svg)
    ).toThrow(/must not write its own/);
  });

  test("markup in a name cannot break out", () => {
    expect(headerStartHtml({ ...svg, name: "<b>" })).toContain("&lt;b&gt;");
  });
});

describe("manifest", () => {
  test("installs the site: it opens on the index, and every app is inside its scope", () => {
    const m = manifestFor([svg]);
    expect(m.name).toBe(SITE.name);
    expect(m.start_url).toBe(".");
    expect(m.scope).toBe(".");
    expect(m.display).toBe("standalone");
  });

  test("each app is a shortcut to its own folder, with its own icon", () => {
    expect(manifestFor([svg]).shortcuts).toEqual([
      {
        name: "SVG",
        description: svg.blurb,
        url: "svg/",
        icons: [{ src: "svg/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    ]);
  });

  test("the pages learn the site root, to register its worker", () => {
    for (const config of [toolsApp("svg"), toolsHome()]) {
      expect(config.define?.["import.meta.env.TOOLS_SITE_BASE"]).toBe(JSON.stringify(siteBase()));
    }
  });
});

describe("shared theme tokens", () => {
  test("the page background is the theme colour the head and manifest announce", async () => {
    const css = await Bun.file(new URL("../tokens.css", import.meta.url)).text();
    expect(css).toContain(`--bg: ${SITE.themeColor};`);
  });

  test("the light tokens are the same whether the browser or a choice asked for them", async () => {
    const css = await Bun.file(new URL("../tokens.css", import.meta.url)).text();
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
      return body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    };
    const light = block(':root[data-theme="light"]');
    expect(light.length).toBeGreaterThan(5);
    expect(block(':root:not([data-theme="dark"])')).toEqual(light);
  });
});

describe("toolsSite", () => {
  test("serves every app from apps/, at the site's base, on one port", () => {
    const config = toolsSite();
    expect(config.root?.replace(/\\/g, "/")).toEndWith("/apps");
    expect(config.base).toBe(siteBase());
    expect(config.publicDir).toBe(false);
    expect(config.server?.port).toBe(5170);
  });
});
