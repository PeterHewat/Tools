import { describe, expect, test } from "bun:test";
import { findApp } from "@tools/catalog";
import { SITE, appBase } from "@tools/catalog/site";
import { THEME_BOOT_SCRIPT, THEME_KEY } from "./theme.js";
import {
  cfBeaconTag,
  headTags,
  headerStartHtml,
  manifestFor,
  toolsApp,
  withHeaderStart,
} from "./vite.js";

const svg = findApp("svg")!;

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

  test("the icon and manifest are addressed from the app's base, not from the page", () => {
    const tags = headTags(svg);
    expect(attr(tags, "rel", "icon")?.attrs?.href).toBe(`${appBase("svg")}icon.svg`);
    expect(attr(tags, "rel", "manifest")?.attrs?.href).toBe(
      `${appBase("svg")}manifest.webmanifest`
    );
  });

  test("an unknown path is a 404, not the app served somewhere it does not live", () => {
    expect(toolsApp("svg").appType).toBe("mpa");
  });

  test("the index page has no manifest", () => {
    expect(attr(headTags(null), "rel", "manifest")).toBeUndefined();
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
  test("names the app and stays inside its folder", () => {
    const m = manifestFor(svg);
    expect(m.name).toBe("SVG");
    expect(m.start_url).toBe(".");
    expect(m.scope).toBe(".");
  });
});

describe("base.css", () => {
  test("the page background is the theme colour the head and manifest announce", async () => {
    const css = await Bun.file(new URL("../base.css", import.meta.url)).text();
    expect(css).toContain(`--bg: ${SITE.themeColor};`);
  });

  test("the light tokens are the same whether the browser or a choice asked for them", async () => {
    const css = await Bun.file(new URL("../base.css", import.meta.url)).text();
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
