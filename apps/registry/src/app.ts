/**
 * Routes of the public brand registry Worker (working hostname prices.tick-ticker.com).
 *
 * Serves the registry feed that the GPHG, Only Watch and blog sites link from:
 *   GET /api/registry/v1/brands.json
 *   GET /api/registry/v1/groups.json
 * Slugs and canonical URLs are precomputed in the feed so consumers never run their
 * own copy of slugifyBrand.
 *
 * The Worker entry point (index.ts) wraps this app in a plain `{ fetch }` export,
 * which also serves service bindings.
 */
import { Hono, type Context } from "hono";
import {
  REGISTRY_ORIGIN,
  feed,
  listBrandFeedRows,
  listSitemapRows,
  listGroupFeedRows,
  toBrandFeedItem,
  toGroupFeedItem,
} from "@baromontres/shared/registry";

import {
  DATASET_CSV_PATH,
  PRICE_REPORTS,
  datasetCsv,
  findPriceReport,
  getPublicPriceChanges,
  listBrandSlugsWithPublicPrices,
  listDatasetRows,
  listPriceSitemapRows,
  listReferenceFeedRows,
  pricesEnabled,
} from "@baromontres/shared/price-public";
import { errorPageHtml } from "./render/html.ts";
import { llmsTxt } from "./render/llms.ts";
import { increasesPage, methodologyPage, parseSort, DEFAULT_DIR, DEFAULT_SORT, pricesIndexPage } from "./render/price-hub.ts";
import { referencePricePage } from "./render/price-pages.ts";
import {
  brandPage,
  brandsIndexPage,
  dormantAndDefunctPage,
  groupPage,
  INDEPENDENT_SLUG,
  type Page,
  type PageOpts,
} from "./render/pages.ts";

export interface RegistryEnv {
  DB: D1Database;
  /** Public origin for canonical URLs and the sitemap; defaults to REGISTRY_ORIGIN. */
  PUBLIC_ORIGIN?: string;
  /**
   * Feature flag for everything public about prices. "1" turns it on; anything else
   * (including unset) leaves the price routes as 404s and hides prices everywhere else.
   * Each brand also needs brands.prices_public = 1.
   */
  PRICES_PUBLIC?: string;
}

type Env = { Bindings: RegistryEnv };

/** Browsers and the edge keep a feed for an hour; consumers should cache it too. */
export const FEED_CACHE_CONTROL = "public, max-age=3600";

const FEED_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": FEED_CACHE_CONTROL,
  // Open data: any site may fetch it from the browser.
  "Access-Control-Allow-Origin": "*",
};

/** The Workers Cache API, when the runtime has one (absent in Node tests and on workers.dev). */
function edgeCache(): Cache | null {
  return typeof caches !== "undefined" && "default" in caches
    ? (caches as unknown as { default: Cache }).default
    : null;
}

function waitUntil(c: Context<Env>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (unit tests): let the promise run on its own.
    promise.catch(() => {});
  }
}

/**
 * Serve a JSON feed through the Cache API: a hit skips D1 entirely; a miss builds the
 * body, returns it and stores a copy for the next request.
 */
async function cachedJson(
  c: Context<Env>,
  build: () => Promise<unknown>,
): Promise<Response> {
  const cache = edgeCache();
  // Key on the path only so query strings can't fragment or bypass the cache.
  const key = new Request(new URL(c.req.path, c.req.url).toString(), {
    method: "GET",
  });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = new Response(JSON.stringify(await build()), {
    status: 200,
    headers: FEED_HEADERS,
  });
  if (cache) waitUntil(c, cache.put(key, res.clone()));
  return res;
}

/** HTML pages are cached briefly: a data fix shows up within minutes, D1 is spared. */
export const PAGE_CACHE_CONTROL = "public, max-age=300";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": PAGE_CACHE_CONTROL,
  "X-Content-Type-Options": "nosniff",
};

const originOf = (c: Context<Env>): string => c.env.PUBLIC_ORIGIN ?? REGISTRY_ORIGIN;
const pageOpts = (c: Context<Env>): PageOpts => ({ prices: pricesEnabled(c.env) });

/**
 * Serve a page through the Cache API. `keyQuery` is the already-normalised query string
 * (only the parameters a page understands), so stray parameters can't fragment the cache.
 * Only 200s are stored; a null page is the caller's 404.
 */
async function cachedPage(
  c: Context<Env>,
  keyQuery: string,
  contentType: string,
  build: () => Promise<{ body: string } | null>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const cache = edgeCache();
  const keyUrl = new URL(c.req.path, c.req.url);
  keyUrl.search = keyQuery;
  const key = new Request(keyUrl.toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const built = await build();
  if (!built) return notFoundPage(c);
  const res = new Response(built.body, {
    status: 200,
    headers: { ...HTML_HEADERS, "Content-Type": contentType, ...extraHeaders },
  });
  if (cache) waitUntil(c, cache.put(key, res.clone()));
  return res;
}

function notFoundPage(c: Context<Env>): Response {
  return new Response(
    errorPageHtml(
      originOf(c),
      404,
      "Page not found",
      "There is no brand, group or page at this address.",
    ),
    {
      status: 404,
      headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=60" },
    },
  );
}

const htmlPage = (
  c: Context<Env>,
  keyQuery: string,
  build: () => Promise<Page | null>,
): Promise<Response> =>
  cachedPage(c, keyQuery, HTML_HEADERS["Content-Type"], async () => {
    const p = await build();
    return p ? { body: p.html } : null;
  });

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createRegistryApp(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/api/registry/v1/brands.json", (c) =>
    cachedJson(c, async () => {
      // price_url is filled only while PRICES_PUBLIC is on, for brands with public prices.
      const priceSlugs = pricesEnabled(c.env)
        ? await listBrandSlugsWithPublicPrices(c.env.DB)
        : new Set<string>();
      return feed(
        (await listBrandFeedRows(c.env.DB)).map((r) =>
          toBrandFeedItem(r, originOf(c), priceSlugs),
        ),
      );
    }),
  );

  // References with a public price page (404 while prices are off): GPHG and Only Watch
  // match their watches against `ref_code` and link to `url`.
  app.get("/api/registry/v1/references.json", (c) =>
    pricesEnabled(c.env)
      ? cachedJson(c, async () =>
          feed(
            (await listReferenceFeedRows(c.env.DB)).map((r) => ({
              id: r.id,
              slug: r.slug,
              brand: { slug: r.brand_slug, name: r.brand_name, url: `${originOf(c)}/brand/${r.brand_slug}` },
              ref_code: r.ref_code,
              family: r.family,
              name: r.name,
              markets: r.markets.split(","),
              last_checked: r.last_checked.slice(0, 10),
              url: `${originOf(c)}/prices/${r.slug}`,
            })),
          ),
        )
      : c.json({ error: "not_found" }, 404),
  );

  app.get("/api/registry/v1/groups.json", (c) =>
    cachedJson(c, async () =>
      feed((await listGroupFeedRows(c.env.DB)).map((r) =>
        toGroupFeedItem(r, originOf(c)),
      )),
    ),
  );

  app.get("/api/registry/v1", (c) =>
    c.json(
      {
        version: 1,
        endpoints: [
          "/api/registry/v1/brands.json",
          "/api/registry/v1/groups.json",
          ...(pricesEnabled(c.env) ? ["/api/registry/v1/references.json"] : []),
        ],
      },
      200,
      {
        "Cache-Control": FEED_CACHE_CONTROL,
        "Access-Control-Allow-Origin": "*",
      },
    ),
  );

  // ── Pages (server-rendered HTML, English only) ──────────────────────────────

  app.get("/", (c) => c.redirect("/brands", 302));

  app.get("/brand/:slug", async (c) => {
    const slug = c.req.param("slug");
    // GPHG lower-cases slugs; send an upper-case URL to its canonical form.
    if (slug !== slug.toLowerCase()) return c.redirect(`/brand/${slug.toLowerCase()}`, 301);
    return htmlPage(c, "", () => brandPage(c.env.DB, originOf(c), slug, pageOpts(c)));
  });

  app.get("/group/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (slug !== slug.toLowerCase()) return c.redirect(`/group/${slug.toLowerCase()}`, 301);
    return htmlPage(c, "", () => groupPage(c.env.DB, originOf(c), slug, pageOpts(c)));
  });

  app.get("/brands", (c) => {
    const q = new URL(c.req.url).searchParams;
    // "dead" is the database word; the public one is "defunct".
    if (q.get("status") === "dead") {
      q.set("status", "defunct");
      return c.redirect(`/brands?${q}`, 301);
    }
    // Cache key: only the two filter parameters, in a fixed order.
    const norm = new URLSearchParams();
    for (const k of ["status", "group"]) {
      const v = q.get(k);
      if (v) norm.set(k, v);
    }
    return htmlPage(c, norm.toString(), async () =>
      brandsIndexPage(c.env.DB, originOf(c), norm, pageOpts(c)),
    );
  });

  app.get("/brands/dormant-and-dead", (c) =>
    c.redirect("/brands/dormant-and-defunct", 301),
  );

  app.get("/brands/dormant-and-defunct", (c) =>
    htmlPage(c, "", () => dormantAndDefunctPage(c.env.DB, originOf(c), pageOpts(c))),
  );

  // ── Prices (behind PRICES_PUBLIC; 404 while the flag is off) ───────────────

  app.get("/prices", (c) =>
    pricesEnabled(c.env) ? htmlPage(c, "", () => pricesIndexPage(c.env.DB, originOf(c))) : notFoundPage(c),
  );

  // The public price dataset under CC BY 4.0. Registered before /prices/:slug.
  app.get(DATASET_CSV_PATH, (c) =>
    pricesEnabled(c.env)
      ? cachedPage(
          c,
          "",
          "text/csv; charset=utf-8",
          async () => ({ body: datasetCsv(await listDatasetRows(c.env.DB)) }),
          {
            "Content-Disposition": 'attachment; filename="tick-ticker-list-prices.csv"',
            Link: '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
          },
        )
      : notFoundPage(c),
  );

  // Registered before /prices/:slug so "methodology" is not read as a report.
  app.get("/prices/methodology", (c) =>
    pricesEnabled(c.env) ? htmlPage(c, "", async () => methodologyPage(originOf(c))) : notFoundPage(c),
  );

  // Yearly report, e.g. /prices/increases-2027; sorting is a query string (sort, dir).
  app.get("/prices/:slug", (c) => {
    const report = findPriceReport(c.req.param("slug"));
    if (!pricesEnabled(c.env) || !report) return notFoundPage(c);
    const q = new URL(c.req.url).searchParams;
    const { sort, dir } = parseSort(q);
    // Cache key: the sort order only, normalised, so stray parameters cannot fragment it.
    const key = sort === DEFAULT_SORT && dir === DEFAULT_DIR ? "" : `sort=${sort}&dir=${dir}`;
    return htmlPage(c, key, () =>
      increasesPage(c.env.DB, originOf(c), report, new URLSearchParams(key)),
    );
  });

  app.get("/prices/:brand/:ref", async (c) => {
    if (!pricesEnabled(c.env)) return notFoundPage(c);
    const { brand, ref } = c.req.param();
    const slug = `${brand}/${ref}`;
    if (slug !== slug.toLowerCase()) return c.redirect(`/prices/${slug.toLowerCase()}`, 301);
    return htmlPage(c, "", () => referencePricePage(c.env.DB, originOf(c), slug));
  });

  app.get("/sitemap.xml", (c) =>
    cachedPage(c, "", "application/xml; charset=utf-8", async () => {
      const origin = originOf(c);
      const rows = await listSitemapRows(c.env.DB);
      const url = (loc: string, lastmod?: string) =>
        `<url><loc>${xmlEscape(origin + loc)}</loc>${
          lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""
        }</url>`;
      const urls = [
        url("/brands"),
        url("/brands/dormant-and-defunct"),
        url(`/group/${INDEPENDENT_SLUG}`),
        ...rows.map((r) => url(`/${r.kind}/${r.slug}`, r.updated_at)),
      ];
      if (pricesEnabled(c.env)) {
        // Price pages only while the flag is on; lastmod is the latest snapshot.
        const refs = await listPriceSitemapRows(c.env.DB);
        if (refs.length) {
          const latest = refs.map((r) => r.lastmod).sort().pop();
          urls.push(url("/prices", latest), url("/prices/methodology"));
          // A report with no changes is noindex, so it stays out of the sitemap.
          for (const report of PRICE_REPORTS) {
            const changes = await getPublicPriceChanges(c.env.DB, report);
            if (changes.length)
              urls.push(url(`/prices/${report.slug}`, changes.map((x) => x.current_captured_at).sort().pop()));
          }
          urls.push(...refs.map((r) => url(`/prices/${r.slug}`, r.lastmod)));
        }
      }
      return {
        body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      };
    }),
  );

  app.get("/llms.txt", (c) =>
    c.text(llmsTxt(originOf(c), pricesEnabled(c.env)), 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    }),
  );

  app.get("/robots.txt", (c) =>
    c.text(`User-agent: *\nAllow: /\n\nSitemap: ${originOf(c)}/sitemap.xml\n`, 200, {
      "Cache-Control": "public, max-age=3600",
    }),
  );

  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? c.json({ error: "not_found" }, 404) : notFoundPage(c),
  );

  app.onError((err, c) => {
    console.error("registry error", err);
    if (!c.req.path.startsWith("/api/"))
      return new Response(
        errorPageHtml(originOf(c), 500, "Something went wrong", "Please try again in a moment."),
        { status: 500, headers: { ...HTML_HEADERS, "Cache-Control": "no-store" } },
      );
    return c.json({ error: "internal_error" }, 500, {
      "Cache-Control": "no-store",
    });
  });

  return app;
}
