// List-price tracker: row types and SQL helpers for the tables created in
// migrations/0007_price_schema.sql.
//
// Kept in its own module (rather than schema.ts and queries.ts) so the price
// units can proceed in parallel with the registry units without touching the
// same files.
//
// Money is always an integer number of minor units (centimes, cents, pence).
// Helpers reject non-integer amounts before they reach the database, and the
// database rejects them again with a CHECK constraint.

export type MarketCode = "CH" | "FR" | "UK" | "US";
export type CurrencyCode = "CHF" | "EUR" | "GBP" | "USD";
export type PriceStatus = "ok" | "price_on_request" | "unavailable" | "error";
export type CaptureTrigger = "cron" | "manual";
export type FetchMethod = "fetch" | "browser" | "manual";
/** Where a price came from: the brand's own site or an authorised retailer (0008). */
export type SourceKey = `brand:${string}` | `retailer:${string}`;

export const PRICE_STATUSES: readonly PriceStatus[] = [
  "ok",
  "price_on_request",
  "unavailable",
  "error",
];

export interface PriceMarketRow {
  code: MarketCode;
  currency: CurrencyCode;
  tax_included: 0 | 1;
}

export interface PriceSourceRow {
  id: number;
  brand_id: number; // brands.id (unit 1)
  market_code: MarketCode;
  source: SourceKey;
  url_template: string | null;
  adapter_key: string | null;
  method: FetchMethod;
  robots_ok: 0 | 1;
  robots_rules: string | null; // JSON
  checked_at: string | null;
  tax_label: string | null;
  notes: string | null;
  created_at: string;
}

export interface PriceSnapshotRow {
  id: number;
  reference_id: number; // watch_references.id (unit 1)
  market_code: MarketCode;
  amount_minor: number | null;
  currency: string;
  status: PriceStatus;
  captured_at: string;
  source_url: string | null;
  evidence_key: string | null;
  content_hash: string | null;
  run_id: number | null;
  source: SourceKey | null;
  method: FetchMethod | null;
  tax_label: string | null;
}

export interface CaptureRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: CaptureTrigger;
  counts: string | null; // JSON
  errors: string | null; // JSON
}

export interface FxRateRow {
  date: string;
  base: "EUR";
  currency: string;
  rate: number;
}

export interface NewPriceSnapshot {
  reference_id: number;
  market_code: MarketCode;
  /** Required (positive integer) when status is 'ok'; must be null otherwise. */
  amount_minor: number | null;
  currency: string;
  status: PriceStatus;
  /** ISO 8601; defaults to now. */
  captured_at?: string;
  source_url?: string | null;
  evidence_key?: string | null;
  content_hash?: string | null;
  run_id?: number | null;
  source?: SourceKey | null;
  method?: FetchMethod | null;
  tax_label?: string | null;
}

export interface PriceChange {
  reference_id: number;
  market_code: MarketCode;
  currency: string;
  baseline_amount_minor: number;
  baseline_captured_at: string;
  current_amount_minor: number;
  current_captured_at: string;
  delta_minor: number;
  /** Percentage change, rounded to two decimals (a ratio, not an amount). */
  change_pct: number;
}

/** Throws unless the snapshot's amount and status agree and the amount is an integer. */
export function assertValidSnapshot(s: NewPriceSnapshot): void {
  if (!PRICE_STATUSES.includes(s.status)) {
    throw new Error(`invalid price status: ${String(s.status)}`);
  }
  if (s.status === "ok") {
    if (
      s.amount_minor === null ||
      !Number.isSafeInteger(s.amount_minor) ||
      s.amount_minor <= 0
    ) {
      throw new Error(
        `status 'ok' needs a positive integer amount_minor, got ${String(s.amount_minor)}`,
      );
    }
  } else if (s.amount_minor !== null) {
    throw new Error(`status '${s.status}' must not carry an amount`);
  }
  if (!/^[A-Z]{3}$/.test(s.currency)) {
    throw new Error(`invalid currency code: ${s.currency}`);
  }
  if (s.source != null && !isSourceKey(s.source)) {
    throw new Error(`invalid source: ${String(s.source)}`);
  }
}

/** True for 'brand:<domain>' or 'retailer:<domain>'. */
export function isSourceKey(v: unknown): v is SourceKey {
  return (
    typeof v === "string" &&
    /^(brand|retailer):[a-z0-9.-]+\.[a-z]{2,}$/.test(v)
  );
}

/** Builds a source key from a page URL or hostname, e.g. brand:www.cartier.com. */
export function sourceKey(
  kind: "brand" | "retailer",
  urlOrHost: string,
): SourceKey {
  const host = urlOrHost.includes("://")
    ? new URL(urlOrHost).hostname
    : urlOrHost;
  const key = `${kind}:${host.toLowerCase()}`;
  if (!isSourceKey(key)) throw new Error(`invalid source host: ${urlOrHost}`);
  return key;
}

// ---------------------------------------------------------------------------
// Markets and sources
// ---------------------------------------------------------------------------

export async function listPriceMarkets(
  db: D1Database,
): Promise<PriceMarketRow[]> {
  const { results } = await db
    .prepare(
      `SELECT code, currency, tax_included FROM price_markets ORDER BY code`,
    )
    .all<PriceMarketRow>();
  return results;
}

export async function listPriceSources(
  db: D1Database,
  brandId?: number,
): Promise<PriceSourceRow[]> {
  const stmt =
    brandId === undefined
      ? db.prepare(`SELECT * FROM price_sources ORDER BY brand_id, market_code`)
      : db
          .prepare(
            `SELECT * FROM price_sources WHERE brand_id = ? ORDER BY market_code`,
          )
          .bind(brandId);
  const { results } = await stmt.all<PriceSourceRow>();
  return results;
}

// ---------------------------------------------------------------------------
// Capture runs
// ---------------------------------------------------------------------------

export async function startCaptureRun(
  db: D1Database,
  trigger: CaptureTrigger,
  startedAt: string = new Date().toISOString(),
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO capture_runs (started_at, "trigger") VALUES (?, ?) RETURNING id`,
    )
    .bind(startedAt, trigger)
    .first<{ id: number }>();
  if (!row) throw new Error("startCaptureRun: insert returned no id");
  return row.id;
}

export async function finishCaptureRun(
  db: D1Database,
  runId: number,
  counts: Record<string, number>,
  errors: unknown[] = [],
  finishedAt: string = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE capture_runs
          SET finished_at = ?, counts = ?, errors = ?
        WHERE id = ?`,
    )
    .bind(finishedAt, JSON.stringify(counts), JSON.stringify(errors), runId)
    .run();
}

export async function getCaptureRun(
  db: D1Database,
  runId: number,
): Promise<CaptureRunRow | null> {
  return db
    .prepare(
      `SELECT id, started_at, finished_at, "trigger" AS "trigger", counts, errors
         FROM capture_runs WHERE id = ?`,
    )
    .bind(runId)
    .first<CaptureRunRow>();
}

// ---------------------------------------------------------------------------
// Snapshots (append-only)
// ---------------------------------------------------------------------------

export async function insertPriceSnapshot(
  db: D1Database,
  s: NewPriceSnapshot,
): Promise<number> {
  assertValidSnapshot(s);
  const row = await db
    .prepare(
      `INSERT INTO price_snapshots
           (reference_id, market_code, amount_minor, currency, status,
          captured_at, source_url, evidence_key, content_hash, run_id,
          source, method, tax_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      s.reference_id,
      s.market_code,
      s.amount_minor,
      s.currency,
      s.status,
      s.captured_at ?? new Date().toISOString(),
      s.source_url ?? null,
      s.evidence_key ?? null,
      s.content_hash ?? null,
      s.run_id ?? null,
      s.source ?? null,
      s.method ?? null,
      s.tax_label ?? null,
    )
    .first<{ id: number }>();
  if (!row) throw new Error("insertPriceSnapshot: insert returned no id");
  return row.id;
}

export interface LatestPriceOptions {
  referenceId?: number;
  marketCode?: MarketCode;
  /** Only consider snapshots with status 'ok' (the last known price). */
  okOnly?: boolean;
}

/**
 * Latest snapshot per reference × market. By default the latest of any status
 * (so a reference that has moved to "price on request" shows that); pass
 * okOnly for the last known price instead.
 */
export async function getLatestPrices(
  db: D1Database,
  opts: LatestPriceOptions = {},
): Promise<PriceSnapshotRow[]> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (opts.referenceId !== undefined) {
    where.push("reference_id = ?");
    binds.push(opts.referenceId);
  }
  if (opts.marketCode !== undefined) {
    where.push("market_code = ?");
    binds.push(opts.marketCode);
  }
  if (opts.okOnly) where.push(`status = 'ok'`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT id, reference_id, market_code, amount_minor, currency, status,
              captured_at, source_url, evidence_key, content_hash, run_id,
              source, method, tax_label
         FROM (
           SELECT *,
                  ROW_NUMBER() OVER (
                    PARTITION BY reference_id, market_code
                    ORDER BY captured_at DESC, id DESC
                  ) AS rn
             FROM price_snapshots
             ${whereSql}
         )
        WHERE rn = 1
        ORDER BY reference_id, market_code`,
    )
    .bind(...binds)
    .all<PriceSnapshotRow>();
  return results;
}

export interface PriceHistoryOptions {
  marketCode?: MarketCode;
  /** Inclusive lower bound on captured_at (ISO date or timestamp). */
  since?: string;
}

/** Every snapshot for one reference, oldest first, across markets unless filtered. */
export async function getPriceHistory(
  db: D1Database,
  referenceId: number,
  opts: PriceHistoryOptions = {},
): Promise<PriceSnapshotRow[]> {
  const where = ["reference_id = ?"];
  const binds: (string | number)[] = [referenceId];
  if (opts.marketCode !== undefined) {
    where.push("market_code = ?");
    binds.push(opts.marketCode);
  }
  if (opts.since !== undefined) {
    where.push("captured_at >= ?");
    binds.push(opts.since);
  }
  const { results } = await db
    .prepare(
      `SELECT id, reference_id, market_code, amount_minor, currency, status,
              captured_at, source_url, evidence_key, content_hash, run_id,
              source, method, tax_label
         FROM price_snapshots
        WHERE ${where.join(" AND ")}
        ORDER BY market_code, captured_at, id`,
    )
    .bind(...binds)
    .all<PriceSnapshotRow>();
  return results;
}

/**
 * Price changes since a baseline. For each reference × market, compares the
 * last 'ok' price captured on or before the end of baselineDate (YYYY-MM-DD)
 * with the latest 'ok' price captured after it. Returns only cells whose amount
 * changed in the same currency; currency switches are left for manual review.
 */
export async function getPriceChangesSince(
  db: D1Database,
  baselineDate: string,
  opts: { marketCode?: MarketCode } = {},
): Promise<PriceChange[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDate)) {
    throw new Error(`baselineDate must be YYYY-MM-DD, got ${baselineDate}`);
  }
  // captured_at is ISO 8601, so anything on baselineDate sorts below the next day.
  const cutoff = nextDay(baselineDate);
  const marketSql = opts.marketCode !== undefined ? "AND market_code = ?" : "";
  const marketBind = opts.marketCode !== undefined ? [opts.marketCode] : [];
  const { results } = await db
    .prepare(
      `WITH ranked AS (
         SELECT reference_id, market_code, amount_minor, currency, captured_at,
                captured_at < ? AS is_baseline,
                ROW_NUMBER() OVER (
                  PARTITION BY reference_id, market_code, captured_at < ?
                  ORDER BY captured_at DESC, id DESC
                ) AS rn
           FROM price_snapshots
          WHERE status = 'ok' ${marketSql}
       ),
       base AS (SELECT * FROM ranked WHERE is_baseline = 1 AND rn = 1),
       cur  AS (SELECT * FROM ranked WHERE is_baseline = 0 AND rn = 1)
       SELECT base.reference_id,
              base.market_code,
              base.currency,
              base.amount_minor AS baseline_amount_minor,
              base.captured_at  AS baseline_captured_at,
              cur.amount_minor  AS current_amount_minor,
              cur.captured_at   AS current_captured_at,
              cur.amount_minor - base.amount_minor AS delta_minor
         FROM base
         JOIN cur
           ON cur.reference_id = base.reference_id
          AND cur.market_code  = base.market_code
          AND cur.currency     = base.currency
        WHERE cur.amount_minor <> base.amount_minor
        ORDER BY base.reference_id, base.market_code`,
    )
    .bind(cutoff, cutoff, ...marketBind)
    .all<Omit<PriceChange, "change_pct">>();
  return results.map((r) => ({
    ...r,
    change_pct:
      Math.round((r.delta_minor / r.baseline_amount_minor) * 10_000) / 100,
  }));
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// FX rates (ECB, base EUR)
// ---------------------------------------------------------------------------

export async function upsertFxRate(
  db: D1Database,
  r: { date: string; currency: string; rate: number },
): Promise<void> {
  if (!(r.rate > 0) || !Number.isFinite(r.rate)) {
    throw new Error(`invalid fx rate: ${r.rate}`);
  }
  await db
    .prepare(
      `INSERT INTO fx_rates (date, base, currency, rate)
       VALUES (?, 'EUR', ?, ?)
       ON CONFLICT(date, base, currency) DO UPDATE SET rate = excluded.rate`,
    )
    .bind(r.date, r.currency, r.rate)
    .run();
}

/** Latest ECB rate for a currency on or before the given date. */
export async function getFxRate(
  db: D1Database,
  currency: string,
  onOrBefore: string,
): Promise<FxRateRow | null> {
  return db
    .prepare(
      `SELECT date, base, currency, rate FROM fx_rates
        WHERE base = 'EUR' AND currency = ? AND date <= ?
        ORDER BY date DESC LIMIT 1`,
    )
    .bind(currency, onOrBefore)
    .first<FxRateRow>();
}

// ---------------------------------------------------------------------------
// Unit 6: sources by domain, reference URLs, capture targets (migration 0008)
// ---------------------------------------------------------------------------

export interface UpsertPriceSource {
  brand_id: number;
  market_code: MarketCode;
  source: SourceKey;
  method: FetchMethod;
  url_template?: string | null;
  adapter_key?: string | null;
  robots_ok?: boolean;
  robots_rules?: unknown;
  checked_at?: string | null;
  tax_label?: string | null;
  notes?: string | null;
}

/**
 * Inserts or updates a source. Fields left undefined keep their stored value, so
 * the robots check and the tax label can be recorded separately.
 */
export async function upsertPriceSource(
  db: D1Database,
  s: UpsertPriceSource,
): Promise<void> {
  if (!isSourceKey(s.source)) throw new Error(`invalid source: ${s.source}`);
  const opt = <T>(v: T | undefined) => (v === undefined ? null : v);
  await db
    .prepare(
      `INSERT INTO price_sources
         (brand_id, market_code, source, method, url_template, adapter_key,
          robots_ok, robots_rules, checked_at, tax_label, notes)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 0), ?, ?, ?, ?)
       ON CONFLICT(brand_id, market_code, source, method) DO UPDATE SET
         url_template = COALESCE(excluded.url_template, url_template),
         adapter_key  = COALESCE(excluded.adapter_key, adapter_key),
         robots_ok    = CASE WHEN ? IS NULL THEN robots_ok ELSE excluded.robots_ok END,
         robots_rules = COALESCE(excluded.robots_rules, robots_rules),
         checked_at   = COALESCE(excluded.checked_at, checked_at),
         tax_label    = COALESCE(excluded.tax_label, tax_label),
         notes        = COALESCE(excluded.notes, notes)`,
    )
    .bind(
      s.brand_id,
      s.market_code,
      s.source,
      s.method,
      opt(s.url_template),
      opt(s.adapter_key),
      s.robots_ok === undefined ? null : s.robots_ok ? 1 : 0,
      s.robots_rules === undefined ? null : JSON.stringify(s.robots_rules),
      opt(s.checked_at),
      opt(s.tax_label),
      opt(s.notes),
      s.robots_ok === undefined ? null : 1,
    )
    .run();
}

/** Records the robots.txt outcome for every source on one domain. */
export async function recordRobotsCheck(
  db: D1Database,
  source: SourceKey,
  robotsOk: boolean,
  rules: unknown,
  checkedAt: string = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE price_sources
          SET robots_ok = ?, robots_rules = ?, checked_at = ?
        WHERE source = ? AND method <> 'manual'`,
    )
    .bind(robotsOk ? 1 : 0, JSON.stringify(rules), checkedAt, source)
    .run();
}

export async function upsertReferencePriceUrl(
  db: D1Database,
  r: {
    reference_id: number;
    market_code: MarketCode;
    source: SourceKey;
    url: string;
    notes?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reference_price_urls (reference_id, market_code, source, url, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reference_id, market_code, source) DO UPDATE SET
         url = excluded.url, notes = excluded.notes, active = 1,
         updated_at = datetime('now')`,
    )
    .bind(r.reference_id, r.market_code, r.source, r.url, r.notes ?? null)
    .run();
}

/** One reference × market × source page to fetch. */
export interface CaptureTarget {
  url_id: number;
  reference_id: number;
  ref_code: string;
  reference_slug: string;
  brand_id: number;
  brand_slug: string;
  market_code: MarketCode;
  currency: CurrencyCode;
  source: SourceKey;
  url: string;
  adapter_key: string | null;
}

export interface CaptureTargetFilter {
  brandSlugs?: string[];
  markets?: MarketCode[];
  referenceIds?: number[];
  /** Skip targets that already have a snapshot in this run (resume). */
  excludeRunId?: number;
  limit?: number;
}

/** Active fetchable pages (manual sources are never fetched). */
export async function listCaptureTargets(
  db: D1Database,
  f: CaptureTargetFilter = {},
): Promise<CaptureTarget[]> {
  const where = ["u.active = 1", "r.active = 1"];
  const binds: (string | number)[] = [];
  const inList = (col: string, vals: (string | number)[]) => {
    where.push(`${col} IN (${vals.map(() => "?").join(", ")})`);
    binds.push(...vals);
  };
  if (f.brandSlugs?.length) inList("b.slug", f.brandSlugs);
  if (f.markets?.length) inList("u.market_code", f.markets);
  if (f.referenceIds?.length) inList("u.reference_id", f.referenceIds);
  if (f.excludeRunId !== undefined) {
    // An uncorrelated NOT IN is read once into a temporary index (about one row read
    // per snapshot of the run). The correlated NOT EXISTS it replaces made SQLite scan
    // the whole run for every URL: 561 x n rows read per call, which D1 bills.
    where.push(
      `(u.reference_id, u.market_code, u.source) NOT IN
         (SELECT s.reference_id, s.market_code, s.source FROM price_snapshots s
           WHERE s.run_id = ? AND s.source IS NOT NULL)`,
    );
    binds.push(f.excludeRunId);
  }
  const limit = f.limit !== undefined ? `LIMIT ${Math.max(0, f.limit | 0)}` : "";
  const { results } = await db
    .prepare(
      `SELECT u.id AS url_id, u.reference_id, r.ref_code, r.slug AS reference_slug,
              b.id AS brand_id, b.slug AS brand_slug, u.market_code, m.currency,
              u.source, u.url,
              (SELECT ps.adapter_key FROM price_sources ps
                WHERE ps.brand_id = b.id AND ps.market_code = u.market_code
                  AND ps.source = u.source AND ps.method = 'fetch') AS adapter_key
         FROM reference_price_urls u
         JOIN watch_references r ON r.id = u.reference_id
         JOIN brands b ON b.id = r.brand_id
         JOIN price_markets m ON m.code = u.market_code
        WHERE ${where.join(" AND ")}
        ORDER BY u.source, b.slug, r.ref_code, u.market_code
        ${limit}`,
    )
    .bind(...binds)
    .all<CaptureTarget>();
  return results;
}

/** The latest unfinished run with this trigger, if any. */
export async function findOpenCaptureRun(
  db: D1Database,
  trigger: CaptureTrigger,
): Promise<CaptureRunRow | null> {
  return db
    .prepare(
      `SELECT id, started_at, finished_at, "trigger" AS "trigger", counts, errors
         FROM capture_runs
        WHERE "trigger" = ? AND finished_at IS NULL
        ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .bind(trigger)
    .first<CaptureRunRow>();
}

/** The latest run with this trigger started on or after the given instant. */
export async function findCaptureRunSince(
  db: D1Database,
  trigger: CaptureTrigger,
  since: string,
): Promise<CaptureRunRow | null> {
  return db
    .prepare(
      `SELECT id, started_at, finished_at, "trigger" AS "trigger", counts, errors
         FROM capture_runs
        WHERE "trigger" = ? AND started_at >= ?
        ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .bind(trigger, since)
    .first<CaptureRunRow>();
}

/** Snapshot counts by status for one run. */
export async function countRunSnapshots(
  db: D1Database,
  runId: number,
): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM price_snapshots WHERE run_id = ? GROUP BY status`,
    )
    .bind(runId)
    .all<{ status: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

// ---------------------------------------------------------------------------
// Catalogue check: retailer prices count only after a manual brand capture
// ---------------------------------------------------------------------------

export async function hasManualBrandCapture(
  db: D1Database,
  referenceId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM price_snapshots
        WHERE reference_id = ? AND method = 'manual'
          AND source GLOB 'brand:*' AND status = 'ok' LIMIT 1`,
    )
    .bind(referenceId)
    .first<{ ok: number }>();
  return row !== null;
}

export interface UnconfirmedRetailerRow {
  reference_id: number;
  reference_slug: string;
  source: SourceKey;
  market_code: MarketCode;
  snapshots: number;
}

/**
 * Retailer prices that do not count yet: the reference has no 'ok' manual
 * capture from the brand's own site. These are flagged, not published.
 */
export async function listUnconfirmedRetailerPrices(
  db: D1Database,
): Promise<UnconfirmedRetailerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.reference_id, r.slug AS reference_slug, s.source, s.market_code,
              COUNT(*) AS snapshots
         FROM price_snapshots s
         JOIN watch_references r ON r.id = s.reference_id
        WHERE s.source GLOB 'retailer:*'
          AND NOT EXISTS (
                SELECT 1 FROM price_snapshots m
                 WHERE m.reference_id = s.reference_id AND m.method = 'manual'
                   AND m.source GLOB 'brand:*' AND m.status = 'ok')
        GROUP BY s.reference_id, s.source, s.market_code
        ORDER BY r.slug, s.market_code`,
    )
    .all<UnconfirmedRetailerRow>();
  return results;
}

// ---------------------------------------------------------------------------
// References: matching a code seen on a page, and adding one (bookmarklet)
// ---------------------------------------------------------------------------

/**
 * Forms a reference code may take on a brand page: Rolex shows M126610LN-0001
 * for the catalogue reference 126610LN; Panerai URLs carry pam01707.
 */
export function refCodeVariants(code: string): string[] {
  const n = code
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!n) return [];
  const out = new Set<string>([n, n.replace(/-/g, "")]);
  const noSuffix = n.replace(/-\d{4}$/, "");
  out.add(noSuffix);
  if (/^m\d/.test(noSuffix)) out.add(noSuffix.slice(1));
  if (/^m\d/.test(n)) out.add(n.slice(1));
  return [...out].filter(Boolean);
}

export interface ReferenceMatch {
  id: number;
  slug: string;
  ref_code: string;
  brand_id: number;
}

/** Finds a brand's reference by a code seen on a page, tolerating format variants. */
export async function findReferenceByCode(
  db: D1Database,
  brandId: number,
  code: string,
): Promise<ReferenceMatch | null> {
  const wanted = new Set(refCodeVariants(code));
  if (wanted.size === 0) return null;
  const { results } = await db
    .prepare(
      `SELECT id, slug, ref_code, brand_id FROM watch_references WHERE brand_id = ?`,
    )
    .bind(brandId)
    .all<ReferenceMatch>();
  for (const r of results) {
    if (refCodeVariants(r.ref_code).some((v) => wanted.has(v))) return r;
  }
  return null;
}

/** Adds a reference (bookmarklet create=1). Returns the new or existing row. */
export async function insertWatchReference(
  db: D1Database,
  r: { brand_id: number; slug: string; ref_code: string; name: string; family?: string | null; notes?: string | null },
): Promise<ReferenceMatch> {
  await db
    .prepare(
      `INSERT INTO watch_references (brand_id, slug, ref_code, name, family, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(brand_id, ref_code) DO NOTHING`,
    )
    .bind(r.brand_id, r.slug, r.ref_code, r.name, r.family ?? null, r.notes ?? null)
    .run();
  const row = await db
    .prepare(
      `SELECT id, slug, ref_code, brand_id FROM watch_references
        WHERE brand_id = ? AND ref_code = ?`,
    )
    .bind(r.brand_id, r.ref_code)
    .first<ReferenceMatch>();
  if (!row) throw new Error("insertWatchReference: row not found after insert");
  return row;
}
