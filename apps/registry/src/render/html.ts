/**
 * Page chrome for the public registry: <head>, masthead, footer, breadcrumbs.
 * Adapted from the GPHG Index layout (tick-ticker-gphg/worker/src/lib/layout.js), with
 * the analytics and consent plumbing left out: this Worker sets no cookies and runs no
 * client script, so every page is plain server-rendered HTML and CSS.
 */
import { CSS } from "./styles.ts";

export const SITE_NAME = "tick-ticker brand registry";

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Serif+Display:ital@0;1&family=Domine:wght@500;600&family=Archivo:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

const NAV = [
  { href: "/brands", label: "Brands" },
  { href: "/brands/dormant-and-dead", label: "Dormant and dead" },
];

export interface Crumb {
  name: string;
  href?: string;
}

export function crumbs(items: Crumb[]): string {
  return (
    `<nav class="crumbs" aria-label="Breadcrumb">` +
    items
      .map((it, i) =>
        it.href && i < items.length - 1
          ? `<a href="${escapeHtml(it.href)}">${escapeHtml(it.name)}</a><span aria-hidden="true">›</span>`
          : `<span aria-current="page">${escapeHtml(it.name)}</span>`,
      )
      .join("") +
    `</nav>`
  );
}

export interface PageMeta {
  title: string;
  description: string;
  /** Path (with leading slash) of the canonical URL. */
  canonical: string;
  jsonld?: object[];
  ogType?: string;
  navCurrent?: string;
  /** Keep the page out of the index (filtered lists, 404s). */
  noindex?: boolean;
}

/** JSON for an inline <script>: "<" is escaped so a name can never close the tag. */
export function jsonLdScript(o: object): string {
  return `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
}

export function layout(
  origin: string,
  meta: PageMeta,
  bodyHtml: string,
): string {
  const url = `${origin}${meta.canonical}`;
  const nav = NAV.map(
    (l) =>
      `<a href="${l.href}"${meta.navCurrent === l.href ? ' aria-current="page"' : ""}>${escapeHtml(l.label)}</a>`,
  ).join("");
  const year = new Date().getUTCFullYear();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)} · ${SITE_NAME}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
${meta.noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${escapeHtml(meta.ogType ?? "website")}">
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:description" content="${escapeHtml(meta.description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}">
<style>${CSS}</style>
${(meta.jsonld ?? []).map(jsonLdScript).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="mast"><div class="wrap mast-in">
  <a class="brandmark" href="/brands">
    <svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="none" stroke="var(--paper-line-strong)"/><line x1="20" y1="20" x2="30.5" y2="9.5" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="20" r="2.1" fill="var(--accent)"/></svg>
    <b>${SITE_NAME}</b>
  </a>
  <nav class="navrow" aria-label="Primary">${nav}</nav>
</div></header>
<main id="main" class="wrap">
${bodyHtml}
</main>
<footer class="site-footer"><div class="wrap foot-in">
  <span>Part of <a href="https://tick-ticker.com">tick-ticker.com</a> — the watch world, in data and words · <a href="https://gphg.tick-ticker.com/">GPHG Index</a> · <a href="https://onlywatch.tick-ticker.com/">Only Watch Index</a> · <a href="https://blog.tick-ticker.com/">Journal</a></span>
  <span>Brand data: public records and Wikidata, reviewed by hand · independent project, not affiliated with any brand listed</span>
  <span>&copy; ${year}</span>
</div></footer>
</body>
</html>`;
}

export function errorPageHtml(
  origin: string,
  status: number,
  heading: string,
  text: string,
): string {
  return layout(
    origin,
    {
      title: heading,
      description: text,
      canonical: "/brands",
      noindex: true,
    },
    `${crumbs([{ name: "Brands", href: "/brands" }, { name: heading }])}
  <header class="page-head"><span class="eyebrow">Error ${status}</span>
    <h1 class="display">${escapeHtml(heading)}</h1>
    <p class="lead">${escapeHtml(text)}</p>
    <p><a href="/brands">Browse all brands →</a></p>
  </header>`,
  );
}
