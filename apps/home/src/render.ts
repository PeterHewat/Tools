import type { ToolsApp } from "@tools/catalog";
import { SITE } from "@tools/catalog/site";
import { escapeHtml } from "@tools/ui/vite";

/** GitHub's mark (Primer's `mark-github` octicon, 16 × 16), for the link to the source. */
const GITHUB_MARK =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

/**
 * One index card. `base` is the site root, so the link is `<base><slug>/`. An app with art gets
 * its picture across the top, served from its own folder.
 */
export function cardHtml(app: ToolsApp, base: string): string {
  const tags = app.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const status =
    app.status === "stable"
      ? ""
      : `<span class="status status--${app.status}">${app.status}</span>`;
  const art = app.art
    ? `<img class="card-art" src="${base}${app.slug}/art.svg" alt="" width="320" height="320" loading="lazy" />`
    : "";
  return `<a class="card" href="${base}${app.slug}/">
      ${art}
      <span class="card-row">
      <span class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path d="${app.icon}" fill="none" stroke="currentColor" stroke-width="1.75"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="card-body">
        <span class="card-title">${escapeHtml(app.name)}${status}</span>
        <span class="card-blurb">${escapeHtml(app.blurb)}</span>
        <ul class="card-tags">${tags}</ul>
      </span>
      </span>
    </a>`;
}

export function pageHtml(apps: readonly ToolsApp[], base: string): string {
  return `
    <header class="masthead">
      <button type="button" class="ui-theme-toggle" id="theme-toggle"></button>
      <h1>${escapeHtml(SITE.name)}</h1>
      <p class="tagline">${escapeHtml(SITE.tagline)}</p>
    </header>
    <main>
      ${
        apps.length
          ? `<ul class="grid">${apps.map((a) => `<li>${cardHtml(a, base)}</li>`).join("")}</ul>`
          : `<p class="empty">Nothing here yet.</p>`
      }
    </main>
    <footer>
      <p class="footer-meta">
        MIT
        <a class="repo-link" href="${SITE.repo}" title="Source on GitHub" aria-label="Source on GitHub">
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="${GITHUB_MARK}" />
          </svg>
        </a>
      </p>
    </footer>
  `;
}
