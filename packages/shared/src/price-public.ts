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
