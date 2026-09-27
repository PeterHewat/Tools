import { defineConfig } from "vite";
import { toolsHome, toolsSite } from "@tools/ui/vite";

// The index is built on its own like any app; its dev server serves the whole site.
export default defineConfig(({ command, isPreview }) =>
  command === "serve" && !isPreview ? toolsSite() : toolsHome()
);
