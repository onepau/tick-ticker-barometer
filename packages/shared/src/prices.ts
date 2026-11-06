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
export type FetchMethod = "fetch" | "browser";

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
  url_template: string | null;
  adapter_key: string | null;
  method: FetchMethod;
  robots_ok: 0 | 1;
  checked_at: string | null;
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
          captured_at, source_url, evidence_key, content_hash, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              captured_at, source_url, evidence_key, content_hash, run_id
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
              captured_at, source_url, evidence_key, content_hash, run_id
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
