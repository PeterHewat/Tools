import { defineConfig, type Plugin } from "vite";
import { listedApps } from "@tools/catalog";
import { siteBase } from "@tools/catalog/site";
import { toolsHome, toolsSite } from "@tools/ui/vite";
import { pageHtml } from "./src/render.js";

/**
 * The index's cards, written into the page from the catalog when it is built (or served), so it
 * paints complete without waiting for a script. After Vite's own pass over the page, which in dev
 * would put the base in front of the links' own again.
 */
function indexPage(): Plugin {
  return {
    name: "tools-index-page",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!/[\\/]home[\\/]index\.html$/.test(ctx.filename)) return html;
        return html.replace(
          '<div id="app"></div>',
          `<div id="app">${pageHtml(listedApps(), siteBase())}</div>`
        );
      },
    },
  };
}

// The index is built on its own like any app; its dev server serves the whole site.
export default defineConfig(({ command }) => {
  const config = command === "serve" ? toolsSite() : toolsHome();
  return { ...config, plugins: [...(config.plugins ?? []), indexPage()] };
});
