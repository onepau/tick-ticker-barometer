// Public price pages: queries and pure helpers (units 9–11).
//
// Everything public reads the view `price_snapshots_countable` (retailer prices count
// only once the reference has a manual brand capture; snapshots with an unresolved
// review flag are left out) and never shows status 'error'. A brand is public only when
// `brands.prices_public = 1`, and the Worker serves nothing price-related unless its
// PRICES_PUBLIC variable is "1" (see pricesEnabled).
import type {
  FxRateRow,
  MarketCode,
  PriceMarketRow,
  PriceStatus,
  SourceKey,
} from "./prices.ts";

export const MARKET_ORDER: readonly MarketCode[] = ["CH", "FR", "UK", "US"];
export const MARKET_NAME: Record<MarketCode, string> = {
  CH: "Switzerland",
  FR: "France",
  UK: "United Kingdom",
  US: "United States",
};

/** Licence of the published dataset and its CSV. */
export const DATASET_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const DATASET_LICENSE_NAME = "CC BY 4.0";

/** The feature flag: price pages, price sections, sitemap entries and feed URLs exist only when "1". */
export function pricesEnabled(env: { PRICES_PUBLIC?: string }): boolean {
  return env.PRICES_PUBLIC === "1";
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PublicReference {
  id: number;
  slug: string;
  ref_code: string;
  family: string | null;
  name: string | null;
  case_material: string | null;
  diameter_mm: number | null;
  brand_id: number;
  brand_slug: string;
  brand_name: string;
}

/** A publishable snapshot: countable, never an error. */
export interface PublicSnapshot {
  id: number;
  reference_id: number;
  market_code: MarketCode;
  amount_minor: number | null;
  currency: string;
  status: Exclude<PriceStatus, "error">;
  captured_at: string;
  source: SourceKey | null;
  source_url: string | null;
  tax_label: string | null;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * A reference of a brand whose prices are public, provided it has at least one
 * publishable 'ok' price (an empty page is not worth publishing).
 */
export async function getPublicReference(
  db: D1Database,
  slug: string,
): Promise<PublicReference | null> {
  return db
    .prepare(
      `SELECT r.id, r.slug, r.ref_code, r.family, r.name, r.case_material, r.diameter_mm,
              b.id AS brand_id, b.slug AS brand_slug, b.name AS brand_name
         FROM watch_references r
         JOIN brands b ON b.id = r.brand_id
        WHERE r.slug = ? AND b.prices_public = 1
          AND EXISTS (SELECT 1 FROM price_snapshots_countable s
                       WHERE s.reference_id = r.id AND s.status = 'ok')`,
    )
    .bind(slug)
    .first<PublicReference>();
}

/** Every publishable snapshot of one reference: by market, then oldest first. */
export async function listPublicSnapshots(
  db: D1Database,
  referenceId: number,
): Promise<PublicSnapshot[]> {
  const { results } = await db
    .prepare(
      `SELECT id, reference_id, market_code, amount_minor, currency, status,
              captured_at, source, source_url, tax_label
         FROM price_snapshots_countable
        WHERE reference_id = ? AND status <> 'error'
        ORDER BY market_code, captured_at, id`,
    )
    .bind(referenceId)
    .all<PublicSnapshot>();
  return results;
}

export async function listMarkets(db: D1Database): Promise<PriceMarketRow[]> {
  const { results } = await db
    .prepare(`SELECT code, currency, tax_included FROM price_markets`)
    .all<PriceMarketRow>();
  return MARKET_ORDER.flatMap((c) => results.filter((m) => m.code === c));
}

export interface FxSnapshot {
  /** Units of currency per 1 EUR, with the ECB date each came from. */
  rates: Record<string, { rate: number; date: string }>;
}

/**
 * ECB rates (EUR base) for the currencies we hold, as of `day`: the latest rate on or
 * before it, or, when none is that old (rates start with the first daily fetch), the
 * earliest rate after it. Each rate carries its own date so the page can say which one it used.
 */
export async function getFxSnapshot(db: D1Database, day: string): Promise<FxSnapshot> {
  const rates: FxSnapshot["rates"] = { EUR: { rate: 1, date: day } };
  for (const cur of ["CHF", "GBP", "USD"]) {
    const row =
      (await db
        .prepare(
          `SELECT date, base, currency, rate FROM fx_rates
            WHERE base = 'EUR' AND currency = ? AND date <= ?
            ORDER BY date DESC LIMIT 1`,
        )
        .bind(cur, day)
        .first<FxRateRow>()) ??
      (await db
        .prepare(
          `SELECT date, base, currency, rate FROM fx_rates
            WHERE base = 'EUR' AND currency = ? ORDER BY date ASC LIMIT 1`,
        )
        .bind(cur)
        .first<FxRateRow>());
    if (row) rates[cur] = { rate: row.rate, date: row.date };
  }
  return { rates };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** "9900.5" style amounts: whole numbers without decimals, otherwise two. */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const whole = amountMinor % 100 === 0;
  const text = major.toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${currency} ${text}`;
}

/** Converts an amount through EUR: amount / rate(from) * rate(CHF). Null if a rate is missing. */
export function convertToChf(
  amountMinor: number,
  currency: string,
  fx: FxSnapshot,
): { chfMinor: number; rateDate: string } | null {
  const from = fx.rates[currency];
  const chf = fx.rates.CHF;
  if (!from || !chf) return null;
  return {
    chfMinor: Math.round((amountMinor / from.rate) * chf.rate),
    // EUR has no date of its own (rate 1); report the latest ECB date actually used.
    rateDate: currency === "EUR" || currency === "CHF" ? chf.date : from.date > chf.date ? from.date : chf.date,
  };
}

/** Readable name for a source key: retailers are named, brand sites say "official site". */
const RETAILER_NAMES: Record<string, string> = {
  "bucherer.com": "Bucherer",
  "watches-of-switzerland.co.uk": "Watches of Switzerland",
  "watchesofswitzerland.com": "Watches of Switzerland",
};
export function sourceLabel(source: SourceKey | null): string {
  if (!source) return "Source not recorded";
  const [kind, host] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
  const bare = host.replace(/^www\./, "");
  if (kind === "retailer") return `${RETAILER_NAMES[bare] ?? bare} (authorised retailer)`;
  return `${bare} (brand site)`;
}

export interface SeriesPoint {
  captured_at: string;
  status: PublicSnapshot["status"];
  amount_minor: number | null;
  currency: string;
  source_url: string | null;
}

export interface MarketSeries {
  market: MarketCode;
  currency: string;
  taxIncluded: boolean;
  source: SourceKey | null;
  /** Latest publishable snapshot of the primary source. */
  latest: SeriesPoint;
  /** Latest 'ok' price of the primary source, if any. */
  lastOk: SeriesPoint | null;
  /** Number of checks of the primary source (every snapshot). */
  checks: number;
  /** First observation and each later change of price or status, oldest first. */
  changes: SeriesPoint[];
}

const point = (s: PublicSnapshot): SeriesPoint => ({
  captured_at: s.captured_at,
  status: s.status,
  amount_minor: s.amount_minor,
  currency: s.currency,
  source_url: s.source_url,
});

/**
 * One series per market. Where a market has several sources (the brand's site and a
 * retailer), the primary source is the one with the latest snapshot, the brand's own
 * site winning a tie; the others are left out so a line never mixes sources.
 */
export function buildMarketSeries(
  snapshots: PublicSnapshot[],
  markets: PriceMarketRow[],
): MarketSeries[] {
  const out: MarketSeries[] = [];
  for (const m of markets) {
    const inMarket = snapshots.filter((s) => s.market_code === m.code);
    if (!inMarket.length) continue;
    // Chronological, ties by id, so "latest" is the last element.
    inMarket.sort((a, b) => (a.captured_at === b.captured_at ? a.id - b.id : a.captured_at < b.captured_at ? -1 : 1));
    const rank = (s: PublicSnapshot) => (s.source?.startsWith("brand:") ? 1 : 0);
    let primary = inMarket[inMarket.length - 1]!;
    for (const s of inMarket) {
      if (s.captured_at === primary.captured_at && rank(s) > rank(primary)) primary = s;
    }
    const series = inMarket.filter((s) => s.source === primary.source);
    const changes: SeriesPoint[] = [];
    for (const s of series) {
      const prev = changes[changes.length - 1];
      if (!prev || prev.status !== s.status || prev.amount_minor !== s.amount_minor || prev.currency !== s.currency)
        changes.push(point(s));
    }
    const okRows = series.filter((s) => s.status === "ok");
    out.push({
      market: m.code,
      currency: m.currency,
      taxIncluded: m.tax_included === 1,
      source: primary.source,
      latest: point(series[series.length - 1]!),
      lastOk: okRows.length ? point(okRows[okRows.length - 1]!) : null,
      checks: series.length,
      changes,
    });
  }
  return out;
}

/** YYYY-MM-DD part of an ISO timestamp. */
export const dayOf = (iso: string): string => iso.slice(0, 10);

export const TAX_TEXT = (taxIncluded: boolean): string =>
  taxIncluded ? "including VAT" : "excluding sales tax";

// ── Reports: changes since a baseline (unit 10) ──────────────────────────────

/**
 * A yearly price-change report. The January 2027 report compares the December 2026
 * baseline with the latest capture; a 2028 report is one more entry here (and an intro
 * row in site_text), with no new template.
 */
export interface PriceReport {
  year: number;
  /** URL path segment: /prices/<slug>. */
  slug: string;
  /** Baseline capture window, UTC dates inclusive: the first 'ok' price in it is the baseline. */
  baselineFrom: string;
  baselineTo: string;
  /** Changes are measured against captures after the window and before this date (exclusive), if set. */
  until?: string;
  /** site_text key of the introduction. */
  introKey: string;
  /** "December 2026", as written in prose. */
  baselineLabel: string;
}

export const PRICE_REPORTS: readonly PriceReport[] = [
  {
    year: 2027,
    slug: "increases-2027",
    baselineFrom: "2026-12-01",
    // The monthly capture period is open for three days (apps/prices calendar).
    baselineTo: "2026-12-03",
    until: "2027-12-01",
    introKey: "increases-2027-intro",
    baselineLabel: "December 2026",
  },
];

export const findPriceReport = (slug: string): PriceReport | undefined =>
  PRICE_REPORTS.find((r) => r.slug === slug);

export interface PublicPriceChange {
  reference_id: number;
  reference_slug: string;
  ref_code: string;
  ref_name: string | null;
  family: string | null;
  brand_slug: string;
  brand_name: string;
  market_code: MarketCode;
  currency: string;
  source: SourceKey | null;
  baseline_amount_minor: number;
  baseline_captured_at: string;
  current_amount_minor: number;
  current_captured_at: string;
  /** First capture at the current price after the last capture at any other price. */
  first_new_at: string;
  delta_minor: number;
  /** Percentage, two decimals (a ratio, not an amount). */
  change_pct: number;
}

const nextDayOf = (isoDate: string): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Public price changes since a baseline. Per reference × market × source, the baseline is
 * the first 'ok' snapshot inside the baseline window and the current price is the latest
 * 'ok' snapshot after the window. Only the countable view is read, so errors and flagged
 * rows are ignored and a retailer price needs its brand capture; a pair is compared only
 * when both prices share one source and one currency (currencies are never mixed). Cells
 * whose amount did not change are not returned. Brands must have prices_public = 1.
 */
export async function getPublicPriceChanges(
  db: D1Database,
  report: Pick<PriceReport, "baselineFrom" | "baselineTo" | "until">,
): Promise<PublicPriceChange[]> {
  const from = report.baselineFrom;
  const afterWindow = nextDayOf(report.baselineTo);
  const until = report.until ?? "9999-12-31";
  const { results } = await db
    .prepare(
      `WITH base AS (
         SELECT reference_id, market_code, COALESCE(source, '') AS src, source, currency,
                amount_minor, captured_at,
                ROW_NUMBER() OVER (
                  PARTITION BY reference_id, market_code, COALESCE(source, '')
                  ORDER BY captured_at, id) AS rn
           FROM price_snapshots_countable
          WHERE status = 'ok' AND captured_at >= ? AND captured_at < ?
       ),
       cur AS (
         SELECT reference_id, market_code, COALESCE(source, '') AS src, currency,
                amount_minor, captured_at,
                ROW_NUMBER() OVER (
                  PARTITION BY reference_id, market_code, COALESCE(source, '')
                  ORDER BY captured_at DESC, id DESC) AS rn
           FROM price_snapshots_countable
          WHERE status = 'ok' AND captured_at >= ? AND captured_at < ?
       )
       SELECT r.id AS reference_id, r.slug AS reference_slug, r.ref_code,
              r.name AS ref_name, r.family,
              br.slug AS brand_slug, br.name AS brand_name,
              b.market_code, b.currency, b.source,
              b.amount_minor AS baseline_amount_minor, b.captured_at AS baseline_captured_at,
              c.amount_minor AS current_amount_minor, c.captured_at AS current_captured_at,
              (SELECT MIN(x.captured_at) FROM price_snapshots_countable x
                WHERE x.reference_id = c.reference_id AND x.market_code = c.market_code
                  AND COALESCE(x.source, '') = c.src AND x.status = 'ok'
                  AND x.currency = c.currency AND x.amount_minor = c.amount_minor
                  AND x.captured_at > COALESCE(
                        (SELECT MAX(y.captured_at) FROM price_snapshots_countable y
                          WHERE y.reference_id = c.reference_id AND y.market_code = c.market_code
                            AND COALESCE(y.source, '') = c.src AND y.status = 'ok'
                            AND y.currency = c.currency AND y.amount_minor <> c.amount_minor
                            AND y.captured_at >= ?), '')
               ) AS first_new_at,
              c.amount_minor - b.amount_minor AS delta_minor
         FROM base b
         JOIN cur c ON c.reference_id = b.reference_id AND c.market_code = b.market_code
                   AND c.src = b.src AND c.currency = b.currency
         JOIN watch_references r ON r.id = b.reference_id
         JOIN brands br ON br.id = r.brand_id
        WHERE b.rn = 1 AND c.rn = 1
          AND c.amount_minor <> b.amount_minor
          AND br.prices_public = 1
        ORDER BY br.name, r.ref_code, b.market_code`,
    )
    .bind(from, afterWindow, afterWindow, until, from)
    .all<Omit<PublicPriceChange, "change_pct">>();
  return results.map((r) => ({
    ...r,
    change_pct: Math.round((r.delta_minor / r.baseline_amount_minor) * 10_000) / 100,
  }));
}

export type ChangeSort = "brand" | "market" | "pct";

/** Sorts a copy: by brand, market or percentage; ties break on brand, reference, market. */
export function sortChanges(
  rows: PublicPriceChange[],
  sort: ChangeSort,
  dir: "asc" | "desc",
): PublicPriceChange[] {
  const sign = dir === "asc" ? 1 : -1;
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const market = (m: MarketCode) => MARKET_ORDER.indexOf(m);
  const tie = (a: PublicPriceChange, b: PublicPriceChange) =>
    text(a.brand_name, b.brand_name) ||
    text(a.ref_code, b.ref_code) ||
    market(a.market_code) - market(b.market_code);
  return [...rows].sort((a, b) => {
    const primary =
      sort === "brand"
        ? text(a.brand_name.toLowerCase(), b.brand_name.toLowerCase())
        : sort === "market"
          ? market(a.market_code) - market(b.market_code)
          : a.change_pct - b.change_pct;
    return primary * sign || tie(a, b);
  });
}

// ── Brand and index summaries ────────────────────────────────────────────────

export interface TrackedReference {
  slug: string;
  ref_code: string;
  name: string | null;
  family: string | null;
  markets: string; // 'CH,FR,UK,US'
  last_checked: string;
}

/** References of one brand that have at least one publishable 'ok' price. */
export async function listTrackedReferences(db: D1Database, brandId: number): Promise<TrackedReference[]> {
  const { results } = await db
    .prepare(
      `SELECT r.slug, r.ref_code, r.name, r.family,
              GROUP_CONCAT(DISTINCT s.market_code) AS markets,
              MAX(s.captured_at) AS last_checked
         FROM watch_references r
         JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status = 'ok'
        WHERE r.brand_id = ?
        GROUP BY r.id
        ORDER BY r.family IS NULL, r.family, r.ref_code`,
    )
    .bind(brandId)
    .all<TrackedReference>();
  return results;
}

export interface MarketLatestChange {
  market_code: MarketCode;
  currency: string;
  reference_slug: string;
  ref_code: string;
  ref_name: string | null;
  from_amount_minor: number;
  to_amount_minor: number;
  changed_at: string;
  change_pct: number;
}

/**
 * The most recent price change in each market across a brand's references: a snapshot
 * whose amount differs from the previous 'ok' snapshot of the same reference, market,
 * source and currency.
 */
export async function listLatestChangePerMarket(
  db: D1Database,
  brandId: number,
): Promise<MarketLatestChange[]> {
  const { results } = await db
    .prepare(
      `WITH s AS (
         SELECT x.reference_id, x.market_code, x.currency, x.amount_minor, x.captured_at, x.id,
                LAG(x.amount_minor) OVER w AS prev_amount,
                LAG(x.currency) OVER w AS prev_currency
           FROM price_snapshots_countable x
          WHERE x.status = 'ok'
            AND x.reference_id IN (SELECT id FROM watch_references WHERE brand_id = ?)
         WINDOW w AS (PARTITION BY x.reference_id, x.market_code, COALESCE(x.source, '')
                      ORDER BY x.captured_at, x.id)
       ),
       ch AS (
         SELECT *, ROW_NUMBER() OVER (
                  PARTITION BY market_code ORDER BY captured_at DESC, id DESC) AS rn
           FROM s
          WHERE prev_amount IS NOT NULL AND prev_amount <> amount_minor AND prev_currency = currency
       )
       SELECT ch.market_code, ch.currency, r.slug AS reference_slug, r.ref_code, r.name AS ref_name,
              ch.prev_amount AS from_amount_minor, ch.amount_minor AS to_amount_minor,
              ch.captured_at AS changed_at
         FROM ch JOIN watch_references r ON r.id = ch.reference_id
        WHERE ch.rn = 1`,
    )
    .bind(brandId)
    .all<Omit<MarketLatestChange, "change_pct">>();
  return MARKET_ORDER.flatMap((m) =>
    results
      .filter((r) => r.market_code === m)
      .map((r) => ({
        ...r,
        change_pct: Math.round(((r.to_amount_minor - r.from_amount_minor) / r.from_amount_minor) * 10_000) / 100,
      })),
  );
}

export interface PriceIndexRow {
  brand_slug: string;
  brand_name: string;
  reference_slug: string;
  ref_code: string;
  ref_name: string | null;
  family: string | null;
  markets: string;
}

/** Every public reference with a publishable price, grouped by brand (for /prices). */
export async function listPublicPriceIndex(db: D1Database): Promise<PriceIndexRow[]> {
  const { results } = await db
    .prepare(
      `SELECT b.slug AS brand_slug, b.name AS brand_name, r.slug AS reference_slug, r.ref_code,
              r.name AS ref_name, r.family, GROUP_CONCAT(DISTINCT s.market_code) AS markets
         FROM watch_references r
         JOIN brands b ON b.id = r.brand_id AND b.prices_public = 1
         JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status = 'ok'
        GROUP BY r.id
        ORDER BY b.name COLLATE NOCASE, r.family IS NULL, r.family, r.ref_code`,
    )
    .all<PriceIndexRow>();
  return results;
}

/** True when the brand is public and has at least one reference with a publishable price. */
export async function brandHasPublicPrices(db: D1Database, brandId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM brands b
        WHERE b.id = ? AND b.prices_public = 1
          AND EXISTS (SELECT 1 FROM watch_references r
                        JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status = 'ok'
                       WHERE r.brand_id = b.id)`,
    )
    .bind(brandId)
    .first<{ ok: number }>();
  return row !== null;
}

// ── Editable text ────────────────────────────────────────────────────────────

/** A site_text block, or null when the row (or the table, before migration 0010) is missing. */
export async function getSiteText(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT body FROM site_text WHERE key = ?`)
      .bind(key)
      .first<{ body: string }>();
    return row?.body ?? null;
  } catch {
    return null;
  }
}

// ── Sitemap, feed and dataset (unit 11) ──────────────────────────────────────

/** A public reference page and the date of its latest publishable snapshot. */
export interface PriceSitemapRow {
  slug: string;
  lastmod: string;
}

/** Reference price pages for the sitemap: public brands, at least one 'ok' price; lastmod = latest snapshot. */
export async function listPriceSitemapRows(db: D1Database): Promise<PriceSitemapRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.slug, MAX(s.captured_at) AS lastmod
         FROM watch_references r
         JOIN brands b ON b.id = r.brand_id AND b.prices_public = 1
         JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status <> 'error'
        GROUP BY r.id
       HAVING SUM(s.status = 'ok') > 0
        ORDER BY r.slug`,
    )
    .all<PriceSitemapRow>();
  return results;
}

/** One reference of the registry feed (references.json). */
export interface ReferenceFeedRow {
  id: number;
  slug: string;
  brand_slug: string;
  brand_name: string;
  ref_code: string;
  family: string | null;
  name: string | null;
  markets: string;
  last_checked: string;
}

export async function listReferenceFeedRows(db: D1Database): Promise<ReferenceFeedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.slug, b.slug AS brand_slug, b.name AS brand_name, r.ref_code, r.family, r.name,
              GROUP_CONCAT(DISTINCT s.market_code) AS markets, MAX(s.captured_at) AS last_checked
         FROM watch_references r
         JOIN brands b ON b.id = r.brand_id AND b.prices_public = 1
         JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status = 'ok'
        GROUP BY r.id
        ORDER BY r.slug`,
    )
    .all<ReferenceFeedRow>();
  return results;
}

/** Slugs of the brands that have public prices, for the feed's price_url. */
export async function listBrandSlugsWithPublicPrices(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT b.slug FROM brands b
        WHERE b.prices_public = 1
          AND EXISTS (SELECT 1 FROM watch_references r
                        JOIN price_snapshots_countable s ON s.reference_id = r.id AND s.status = 'ok'
                       WHERE r.brand_id = b.id)`,
    )
    .all<{ slug: string }>();
  return new Set(results.map((r) => r.slug));
}

export interface DatasetRow {
  snapshot_id: number;
  brand_slug: string;
  brand_name: string;
  reference_slug: string;
  ref_code: string;
  reference_name: string | null;
  market_code: MarketCode;
  currency: string;
  tax_included: 0 | 1;
  status: string;
  amount_minor: number | null;
  captured_at: string;
  series_last_checked: string;
  source: SourceKey | null;
  source_url: string | null;
}

/**
 * The public price series, compactly: per reference × market × source, the first capture
 * and every later change of price, currency or status (unchanged repeat checks are
 * collapsed; `series_last_checked` says when the series was last looked at). Same rules
 * as the pages: countable view only, no errors, public brands, at least one 'ok' price.
 */
export async function listDatasetRows(db: D1Database): Promise<DatasetRow[]> {
  const { results } = await db
    .prepare(
      `WITH s AS (
         SELECT x.id, x.reference_id, x.market_code, x.currency, x.amount_minor, x.status,
                x.captured_at, x.source, x.source_url,
                LAG(x.amount_minor) OVER w AS pa, LAG(x.status) OVER w AS ps,
                LAG(x.currency) OVER w AS pc, ROW_NUMBER() OVER w AS rn,
                MAX(x.captured_at) OVER (
                  PARTITION BY x.reference_id, x.market_code, COALESCE(x.source, '')) AS series_last_checked
           FROM price_snapshots_countable x
          WHERE x.status <> 'error'
         WINDOW w AS (PARTITION BY x.reference_id, x.market_code, COALESCE(x.source, '')
                      ORDER BY x.captured_at, x.id)
       )
       SELECT s.id AS snapshot_id, b.slug AS brand_slug, b.name AS brand_name,
              r.slug AS reference_slug, r.ref_code, r.name AS reference_name,
              s.market_code, s.currency, m.tax_included, s.status, s.amount_minor,
              s.captured_at, s.series_last_checked, s.source, s.source_url
         FROM s
         JOIN watch_references r ON r.id = s.reference_id
         JOIN brands b ON b.id = r.brand_id AND b.prices_public = 1
         JOIN price_markets m ON m.code = s.market_code
        WHERE (s.rn = 1 OR s.ps <> s.status OR s.pc <> s.currency
               OR COALESCE(s.pa, -1) <> COALESCE(s.amount_minor, -1))
          AND r.id IN (SELECT reference_id FROM price_snapshots_countable WHERE status = 'ok')
        ORDER BY b.name COLLATE NOCASE, r.ref_code, s.market_code, s.captured_at, s.id`,
    )
    .all<DatasetRow>();
  return results;
}

export const DATASET_CSV_PATH = "/prices/dataset.csv";
export const DATASET_CSV_COLUMNS = [
  "brand_slug",
  "brand",
  "reference_slug",
  "reference_code",
  "reference_name",
  "market",
  "currency",
  "amount",
  "amount_minor",
  "tax",
  "status",
  "captured_at",
  "series_last_checked",
  "source",
  "source_url",
  "license",
] as const;

/** One CSV cell: quoted when needed; text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(v: string | number | null | undefined, text = true): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Renders the dataset as CSV (CRLF line endings, header row, CC BY 4.0 in every row). */
export function datasetCsv(rows: DatasetRow[]): string {
  const lines = [DATASET_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.brand_slug),
        csvCell(r.brand_name),
        csvCell(r.reference_slug),
        csvCell(r.ref_code),
        csvCell(r.reference_name),
        csvCell(r.market_code),
        csvCell(r.currency),
        r.amount_minor === null ? "" : (r.amount_minor / 100).toFixed(2),
        r.amount_minor === null ? "" : String(r.amount_minor),
        r.tax_included ? "including VAT" : "excluding sales tax",
        csvCell(r.status),
        csvCell(r.captured_at),
        csvCell(r.series_last_checked),
        csvCell(r.source),
        csvCell(r.source_url),
        DATASET_LICENSE_NAME,
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
