/**
 * Price hub pages (unit 10): the /prices index, the yearly increases report, the
 * methodology, and the price section of a brand page. All server-rendered; the only
 * "interaction" is sorting by query string, which is a plain link.
 */
import {
  MARKET_NAME,
  MARKET_ORDER,
  DATASET_LICENSE_NAME,
  DATASET_LICENSE_URL,
  brandHasPublicPrices,
  formatMoney,
  getPublicPriceChanges,
  getSiteText,
  listLatestChangePerMarket,
  listPublicPriceIndex,
  listTrackedReferences,
  sortChanges,
  type ChangeSort,
  type PriceReport,
  type PublicPriceChange,
  type TrackedReference,
} from "@baromontres/shared/price-public";
import type { BrandRow } from "@baromontres/shared/registry";
import { crumbs, escapeHtml, layout } from "./html.ts";
import { breadcrumbLd, type Page } from "./pages.ts";
import { METHODOLOGY_PATH, pctText } from "./price-pages.ts";

const PRICES_NAV = { navCurrent: "/prices", pricesNav: true } as const;

/** Plain text from site_text: blank lines separate paragraphs; everything is escaped. */
export function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const marketList = (csv: string): string =>
  MARKET_ORDER.filter((m) => csv.split(",").includes(m)).join(" · ");

const refLabel = (r: {
  ref_name: string | null;
  family?: string | null;
  ref_code: string;
}): string => r.ref_name ?? r.family ?? r.ref_code;

// ── Brand page section ───────────────────────────────────────────────────────

/** Empty unless the brand is public and has a publishable price. */
export async function brandPriceSection(
  db: D1Database,
  brand: BrandRow,
): Promise<string> {
  if (!(await brandHasPublicPrices(db, brand.id))) return "";
  const [refs, changes] = await Promise.all([
    listTrackedReferences(db, brand.id),
    listLatestChangePerMarket(db, brand.id),
  ]);
  if (!refs.length) return "";
  const last = refs
    .map((r) => r.last_checked.slice(0, 10))
    .sort()
    .pop()!;

  const changeRows = changes
    .map(
      (c) =>
        `<tr><td>${escapeHtml(MARKET_NAME[c.market_code])}</td><td class="num ${c.change_pct > 0 ? "up" : "down"}">${pctText(c.from_amount_minor, c.to_amount_minor)}</td><td><a href="/prices/${escapeHtml(c.reference_slug)}">${escapeHtml(refLabel(c))}</a> <span class="muted">(${escapeHtml(formatMoney(c.from_amount_minor, c.currency))} to ${escapeHtml(formatMoney(c.to_amount_minor, c.currency))})</span></td><td>${c.changed_at.slice(0, 10)}</td></tr>`,
    )
    .join("");
  const changesBlock = changes.length
    ? `<div class="tablewrap"><table class="data"><caption>The most recent list-price change in each market.</caption>
<thead><tr><th>Market</th><th class="num">Change</th><th>Reference</th><th>Captured</th></tr></thead><tbody>${changeRows}</tbody></table></div>`
    : `<p class="note">No list-price change has been captured since the December 2026 baseline.</p>`;

  const byFamily = new Map<string, TrackedReference[]>();
  for (const r of refs) {
    const k = r.family ?? "Other references";
    byFamily.set(k, [...(byFamily.get(k) ?? []), r]);
  }
  const lists = [...byFamily]
    .map(
      ([family, rs]) =>
        `<h3>${escapeHtml(family)}</h3><ul class="brandlist">${rs
          .map(
            (r) =>
              `<li><a class="nm" href="/prices/${escapeHtml(r.slug)}">${escapeHtml(r.name ?? r.ref_code)}</a> <span class="meta">ref. ${escapeHtml(r.ref_code)} · ${marketList(r.markets)}</span></li>`,
          )
          .join("")}</ul>`,
    )
    .join("");

  return `<section class="block" id="prices"><h2>List prices</h2>
<p class="small">Official list prices for ${refs.length} tracked ${refs.length === 1 ? "reference" : "references"} of ${escapeHtml(brand.name)}, last checked ${last}. Prices include VAT in Switzerland, France and the United Kingdom and exclude sales tax in the United States. See the <a href="${METHODOLOGY_PATH}">methodology</a> and the <a href="/prices/increases-2027">2027 price-increase report</a>.</p>
${changesBlock}
${lists}</section>`;
}

// ── /prices ──────────────────────────────────────────────────────────────────

export async function pricesIndexPage(
  db: D1Database,
  origin: string,
): Promise<Page> {
  const rows = await listPublicPriceIndex(db);
  const byBrand = new Map<string, { name: string; refs: typeof rows }>();
  for (const r of rows) {
    const e = byBrand.get(r.brand_slug) ?? { name: r.brand_name, refs: [] };
    e.refs.push(r);
    byBrand.set(r.brand_slug, e);
  }
  const brands = [...byBrand];
  const blocks = brands
    .map(
      ([slug, { name, refs }]) =>
        `<section class="letter" id="${escapeHtml(slug)}"><h2><a href="/brand/${escapeHtml(slug)}">${escapeHtml(name)}</a></h2>
<ul class="brandlist">${refs
          .map(
            (r) =>
              `<li><a class="nm" href="/prices/${escapeHtml(r.reference_slug)}">${escapeHtml(r.ref_name ?? r.ref_code)}</a> <span class="meta">ref. ${escapeHtml(r.ref_code)} · ${marketList(r.markets)}</span></li>`,
          )
          .join("")}</ul></section>`,
    )
    .join("");
  const body = `${crumbs([{ name: "Prices" }])}
  <header class="page-head"><span class="eyebrow">List-price tracker</span>
    <h1 class="display">Watch list prices by brand and reference</h1>
    <p class="lead">Official list prices of new watches in Switzerland, France, the United Kingdom and the United States, captured from brand websites or named authorised retailers, with dated history. ${brands.length} ${brands.length === 1 ? "brand" : "brands"} and ${rows.length} ${rows.length === 1 ? "reference" : "references"} tracked.</p>
    <p><a href="/prices/increases-2027">2027 price-increase report →</a> · <a href="${METHODOLOGY_PATH}">How the prices are collected →</a></p>
  </header>
  ${blocks || `<p class="note">No prices are published yet.</p>`}`;
  return {
    html: layout(
      origin,
      {
        title: "Watch list prices by brand and reference",
        description: `Official list prices of new watches in four markets with dated history: ${brands.length} brands, ${rows.length} references, captured from brand sites and named authorised retailers.`,
        canonical: "/prices",
        ...PRICES_NAV,
        noindex: rows.length === 0,
        jsonld: [
          breadcrumbLd(origin, [{ name: "Prices", path: "/prices" }]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Brands with tracked list prices",
            numberOfItems: brands.length,
            itemListElement: brands
              .slice(0, 100)
              .map(([slug, { name }], i) => ({
                "@type": "ListItem",
                position: i + 1,
                name,
                url: `${origin}/brand/${slug}`,
              })),
          },
        ],
      },
      body,
    ),
  };
}

// ── /prices/increases-<year> ─────────────────────────────────────────────────

export const DEFAULT_SORT: ChangeSort = "pct";
export const DEFAULT_DIR = "desc";

export function parseSort(q: URLSearchParams): {
  sort: ChangeSort;
  dir: "asc" | "desc";
} {
  const sort =
    (["brand", "market", "pct"] as const).find((s) => s === q.get("sort")) ??
    DEFAULT_SORT;
  const defaultDir = sort === "pct" ? "desc" : "asc";
  const dir =
    q.get("dir") === "asc"
      ? "asc"
      : q.get("dir") === "desc"
        ? "desc"
        : defaultDir;
  return { sort, dir };
}

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct1 = (n: number): string =>
  `${n > 0 ? "+" : ""}${(Math.round(n * 10) / 10).toFixed(1)}%`;

function summaryTables(rows: PublicPriceChange[]): string {
  const byMarket = MARKET_ORDER.map((m) => ({
    m,
    rs: rows.filter((r) => r.market_code === m),
  })).filter((x) => x.rs.length);
  const brandMap = new Map<
    string,
    { name: string; slug: string; rs: PublicPriceChange[] }
  >();
  for (const r of rows) {
    const e = brandMap.get(r.brand_slug) ?? {
      name: r.brand_name,
      slug: r.brand_slug,
      rs: [],
    };
    e.rs.push(r);
    brandMap.set(r.brand_slug, e);
  }
  const brands = [...brandMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const tr = (label: string, rs: PublicPriceChange[]) => {
    const pcts = rs.map((r) => r.change_pct);
    return `<tr><td>${label}</td><td class="num">${rs.length}</td><td class="num">${pct1(avg(pcts))}</td><td class="num">${pct1(Math.min(...pcts))} to ${pct1(Math.max(...pcts))}</td></tr>`;
  };
  const head = `<thead><tr><th>%s</th><th class="num">Changes</th><th class="num">Average</th><th class="num">Range</th></tr></thead>`;
  return `<section class="block"><h2>Summary</h2>
<div class="tablewrap"><table class="data"><caption>By market</caption>${head.replace("%s", "Market")}<tbody>${byMarket
    .map(({ m, rs }) => tr(escapeHtml(MARKET_NAME[m]), rs))
    .join("")}</tbody></table></div>
<div class="tablewrap"><table class="data"><caption>By brand</caption>${head.replace("%s", "Brand")}<tbody>${brands
    .map((b) =>
      tr(
        `<a href="/brand/${escapeHtml(b.slug)}">${escapeHtml(b.name)}</a>`,
        b.rs,
      ),
    )
    .join("")}</tbody></table></div></section>`;
}

export async function increasesPage(
  db: D1Database,
  origin: string,
  report: PriceReport,
  query: URLSearchParams,
): Promise<Page> {
  const { sort, dir } = parseSort(query);
  const isDefault = sort === DEFAULT_SORT && dir === DEFAULT_DIR;
  const [changes, introText] = await Promise.all([
    getPublicPriceChanges(db, report),
    getSiteText(db, report.introKey),
  ]);
  const rows = sortChanges(changes, sort, dir);
  const path = `/prices/${report.slug}`;
  const intro = paragraphs(
    introText ??
      `This page lists every official list price that has changed since our ${report.baselineLabel} baseline.`,
  );

  const sortLink = (
    key: ChangeSort,
    label: string,
    numeric = false,
  ): string => {
    const active = sort === key;
    const nextDir = active
      ? dir === "asc"
        ? "desc"
        : "asc"
      : key === "pct"
        ? "desc"
        : "asc";
    const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
    return `<th${numeric ? ' class="num"' : ""}${active ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : ""}><a href="${path}?sort=${key}&amp;dir=${nextDir}">${label}${arrow}</a></th>`;
  };

  const tableRows = rows
    .map(
      (
        r,
      ) => `<tr><td><a href="/brand/${escapeHtml(r.brand_slug)}">${escapeHtml(r.brand_name)}</a></td>
<td><a href="/prices/${escapeHtml(r.reference_slug)}">${escapeHtml(refLabel(r))}</a> <span class="muted">ref. ${escapeHtml(r.ref_code)}</span></td>
<td>${escapeHtml(MARKET_NAME[r.market_code])}</td>
<td class="num">${escapeHtml(formatMoney(r.baseline_amount_minor, r.currency))}</td>
<td class="num">${escapeHtml(formatMoney(r.current_amount_minor, r.currency))}</td>
<td class="num ${r.change_pct > 0 ? "up" : "down"}">${pct1(r.change_pct)}</td>
<td>${r.first_new_at.slice(0, 10)}</td></tr>`,
    )
    .join("\n");

  const latest = changes
    .map((c) => c.current_captured_at.slice(0, 10))
    .sort()
    .pop();
  const table = rows.length
    ? `<section class="block"><h2>Every change since ${escapeHtml(report.baselineLabel)}</h2>
<div class="tablewrap"><table class="data"><caption>${rows.length} list-price ${rows.length === 1 ? "change" : "changes"}${
        latest ? `, latest capture ${latest}` : ""
      }. Click a column heading to sort.</caption>
<thead><tr>${sortLink("brand", "Brand")}<th>Reference</th>${sortLink("market", "Market")}<th class="num">${escapeHtml(report.baselineLabel)}</th><th class="num">Now</th>${sortLink("pct", "Change", true)}<th>First seen</th></tr></thead>
<tbody>
${tableRows}
</tbody></table></div>
<p class="small">Prices are in each market's own currency and are never converted here. Switzerland, France and the United Kingdom include VAT; the United States excludes sales tax. "First seen" is the first capture at the new price, so the change happened between that date and the capture before it. Changes of more than 15% are checked by hand before they appear. See the <a href="${METHODOLOGY_PATH}">methodology</a>.</p></section>`
    : `<section class="block"><p class="note">No list-price change has been captured since the ${escapeHtml(report.baselineLabel)} baseline. This page updates as new captures arrive.</p></section>`;

  const body = `${crumbs([{ name: "Prices", href: "/prices" }, { name: `Increases ${report.year}` }])}
  <header class="page-head"><span class="eyebrow">Price-change report · ${report.year}</span>
    <h1 class="display">Watch price increases in ${report.year}</h1>
    <div class="lead prose">${intro}</div>
  </header>
  ${rows.length ? summaryTables(changes) : ""}
  ${table}`;

  const title = `Watch price increases in ${report.year}`;
  const description = rows.length
    ? `${rows.length} official list-price changes since ${report.baselineLabel} across ${new Set(changes.map((c) => c.brand_slug)).size} watch brands, by brand, market and percentage.`
    : `Official watch list-price changes since ${report.baselineLabel}, by brand, market and percentage. No change captured yet.`;
  return {
    html: layout(
      origin,
      {
        title,
        description,
        canonical: path,
        ...PRICES_NAV,
        // Sorted variants and the empty report stay out of the index.
        noindex: !isDefault || rows.length === 0,
        jsonld: [
          breadcrumbLd(origin, [
            { name: "Prices", path: "/prices" },
            { name: `Increases ${report.year}`, path },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `Official watch list-price changes since ${report.baselineLabel}`,
            description,
            url: `${origin}${path}`,
            creator: {
              "@type": "Organization",
              name: "tick-ticker",
              url: "https://tick-ticker.com",
            },
            license: DATASET_LICENSE_URL,
            isAccessibleForFree: true,
            temporalCoverage: `${report.baselineFrom}/${latest ?? report.baselineTo}`,
          },
        ],
      },
      body,
    ),
  };
}

// ── /prices/methodology ──────────────────────────────────────────────────────

/**
 * DRAFT for Paul's review. British English, sentence-case headings, no Oxford comma.
 * If the capture calendar (apps/prices/src/calendar.ts) or the source rules change, update it here.
 */
export function methodologyPage(origin: string): Page {
  const body = `${crumbs([{ name: "Prices", href: "/prices" }, { name: "Methodology" }])}
  <header class="page-head"><span class="eyebrow">List-price tracker</span>
    <h1 class="display">How the list prices are collected</h1>
    <p class="lead">What we record, where it comes from, how often we check it and how we correct it.</p>
  </header>
  <div class="prose">
  <section class="block"><h2>What the tracker records</h2>
    <p>The tracker records the official list price of new watches: the price a brand or one of its authorised retailers publishes on its own website. It does not record pre-owned, grey-market or auction prices, discounts or dealer quotes. tick-ticker does not sell watches and earns nothing from any brand listed.</p>
    <p>Each price is stored with the date we captured it, the page it came from and an extract of that page, so every figure can be traced back. Prices are only ever added, never overwritten: a correction is a new dated entry.</p>
  </section>
  <section class="block"><h2>Sources</h2>
    <p>The first source is the brand's own website in each market. Where a brand does not show prices on its own site (Rolex and Panerai are the two cases so far), we use a named authorised retailer instead, and the retailer is named on every page where its price appears.</p>
    <p>The retailer rule: a retailer's price counts only once a person at tick-ticker has also opened the same reference on the brand's own site and captured it by hand. That confirms the reference exists and is in the current catalogue. Until then the retailer price is held back and not published.</p>
    <p>We check each site's robots.txt and do not collect from sites that disallow it. Requests are slow (one at a time per site, with a pause between them) and identify themselves as tick-ticker.</p>
  </section>
  <section class="block"><h2>Markets, currencies and tax</h2>
    <div class="tablewrap"><table class="data"><thead><tr><th>Market</th><th>Currency</th><th>Tax treatment of the listed price</th></tr></thead><tbody>
      <tr><td>Switzerland</td><td>CHF</td><td>Includes VAT</td></tr>
      <tr><td>France</td><td>EUR</td><td>Includes VAT</td></tr>
      <tr><td>United Kingdom</td><td>GBP</td><td>Includes VAT</td></tr>
      <tr><td>United States</td><td>USD</td><td>Excludes sales tax</td></tr>
    </tbody></table></div>
    <p>We record the price exactly as the site shows it, in the market's own currency, as a whole amount in the smallest unit (centimes, cents or pence). US sales tax varies by state and is added at the till, so US prices are always shown as listed and are not comparable with the three tax-inclusive markets without that caveat.</p>
  </section>
  <section class="block"><h2>How often prices are checked</h2>
    <p>Prices are captured once a month, on the 1st. For the January 2027 price-increase report the calendar is tighter:</p>
    <ul>
      <li>1 December 2026: the baseline capture.</li>
      <li>29 December 2026: a second capture before the year ends.</li>
      <li>1 to 20 January 2027: a capture every day, so increases can be dated to the day.</li>
      <li>From 21 January 2027: back to monthly.</li>
    </ul>
    <p>A page shows the date of the latest check. When a price has not changed, we list only the first capture and each later change in the history, and count the checks in between.</p>
  </section>
  <section class="block"><h2>Checks before publication</h2>
    <p>After each capture, any change of more than 15% and any change of currency is held for a manual check and does not appear until a person has confirmed it against the source page. A capture that fails (a page that will not load or a price that cannot be read) is not published and is never shown as a price.</p>
  </section>
  <section class="block"><h2>Currency conversion</h2>
    <p>The regional comparison converts prices to Swiss francs using the euro foreign exchange reference rates published by the European Central Bank each working day at about 16:00 CET, for the date the price was last checked (the nearest available rate if there is none for that day). The conversion is for comparison only: converted figures are not stored in place of a captured price, and they carry the tax caveat above.</p>
  </section>
  <section class="block"><h2>"Price on request" and "not available online"</h2>
    <p><strong>Price on request</strong> means the brand's page for that reference in that market shows no price and invites the visitor to ask a boutique or retailer. We record it as a status, because it is information in its own right.</p>
    <p><strong>Not available online</strong> means the reference could not be found for sale on the brand's website in that market (Oris uses this wording, for instance). It does not mean the watch is discontinued.</p>
  </section>
  <section class="block"><h2>Corrections</h2>
    <p>If a published price differs from the brand's page on the day we checked it, tell us and we will recheck it. A confirmed error is corrected by adding a new dated entry and, where the history was misleading, a note on the page. Earlier entries are not deleted. Contact: through <a href="https://tick-ticker.com">tick-ticker.com</a>.</p>
  </section>
  <section class="block"><h2>Data, credits and licence</h2>
    <p>The price dataset is published under the <a href="${DATASET_LICENSE_URL}" rel="license noopener">${DATASET_LICENSE_NAME}</a> licence. You may reuse it, including commercially, if you credit "tick-ticker list-price tracker (${escapeHtml(origin.replace(/^https?:\/\//, ""))})" and link to the page you used.</p>
    <p>Brand facts in the registry (founding dates, groups, headquarters and websites) come from public records and from Wikidata, which is released under CC0, and are reviewed by hand. tick-ticker is an independent project and is not affiliated with any brand listed.</p>
  </section>
  </div>`;
  return {
    html: layout(
      origin,
      {
        title: "Methodology: how the list prices are collected",
        description:
          "Sources, capture frequency, tax treatment, exchange rates and corrections policy of the tick-ticker watch list-price tracker.",
        canonical: METHODOLOGY_PATH,
        ...PRICES_NAV,
        jsonld: [
          breadcrumbLd(origin, [
            { name: "Prices", path: "/prices" },
            { name: "Methodology", path: METHODOLOGY_PATH },
          ]),
        ],
      },
      body,
    ),
  };
}
