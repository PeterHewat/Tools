import { bindThemeToggle, byId, registerServiceWorker } from "@tools/ui";

// The page itself is written from the catalog at build time (see vite.config.ts).
bindThemeToggle(byId("theme-toggle"));

registerServiceWorker();
