/**
 * Site-level constants, including the one place the deploy path is decided.
 *
 * GitHub Pages serves a project site from `/<repo>/`, so every app is built with a base of
 * `/<repo>/<slug>/`. Setting `TOOLS_BASE` overrides it — point it at `/` the day this
 * moves to a custom domain and nothing else in the repo has to change.
 */

export const SITE = {
  name: "Tools",
  tagline: "Small, self-contained browser tools.",
  description:
    "A collection of small, dependency-free browser tools. Everything runs client-side; nothing is uploaded.",
  repo: "https://github.com/PeterHewat/Tools",
  author: "Peter Hewat",
  /** Page background, for the browser chrome and installed-app splash. Matches the shared CSS. */
  themeColor: "#1a1b1e",
} as const;

/** Trailing-slash-terminated base path the whole site is served from. */
export function siteBase(env: Record<string, string | undefined> = process.env): string {
  const raw = env.TOOLS_BASE ?? "/Tools/";
  const withLead = raw.startsWith("/") ? raw : `/${raw}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

/** Base path for one app's bundle, e.g. `/Tools/svg/`. */
export function appBase(slug: string, env?: Record<string, string | undefined>): string {
  return `${siteBase(env)}${slug}/`;
}
