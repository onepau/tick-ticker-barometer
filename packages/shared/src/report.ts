// Validation report for a price capture run (unit 7).
//
// Built when a run finishes and stored in run_reports:
//  - coverage: share of reference × market cells in the run's scope that ended
//    with an 'ok' snapshot, overall and by brand and market;
//  - changes: every cell whose 'ok' price differs from the previous 'ok' price of
//    the same cell and source, with the percentage change;
//  - outliers, to be looked at by a person and not published meanwhile:
//      change_over_15        the price moved by more than 15% either way;
//      currency_mismatch     the page showed another currency than the market's, the
//                            snapshot's currency is not the market's, or the cell
//                            switched currency since the previous capture;
//      retailer_unconfirmed  a retailer price for a reference without an 'ok'
//                            manual capture from the brand's own site.
//    Each outlier with a snapshot also gets a price_review_flags row, and the
//    publishable view skips snapshots with an unresolved flag.

import type { MarketCode } from "./prices.ts";

export const CHANGE_THRESHOLD_PCT = 15;

export type OutlierKind = "change_over_15" | "currency_mismatch" | "retailer_unconfirmed";

export interface ReportCell {
  reference_id: number;
  market_code: MarketCode;
  brand_slug: string;
}

export interface CoverageGroup {
  key: string;
  cells: number;
  ok: number;
  /** ok / cells, rounded to four decimals (0.9375 = 93.75%). */
  share: number;
}

export interface ReportChange {
  snapshot_id: number;
  reference: string;
  market: MarketCode;
  source: string | null;
  currency: string;
  previous_minor: number;
  current_minor: number;
  /** Percentage change, two decimals. */
  change_pct: number;
  previous_captured_at: string;
  flagged: boolean;
}

export interface ReportOutlier {
  kind: OutlierKind;
  snapshot_id: number;
  reference: string;
  market: MarketCode;
  source: string | null;
  detail: string;
}

export interface RunReport {
  run_id: number;
  generated_at: string;
  threshold_pct: number;
  coverage: {
    cells: number;
    ok: number;
    share: number;
    /** Cells of the scope by their best status in this run. */
    by_status: Record<string, number>;
    by_brand: CoverageGroup[];
    by_market: CoverageGroup[];
  };
  changes: ReportChange[];
  outliers: ReportOutlier[];
}

/** An error recorded by the run: the page, and for adapter errors the cell. */
export interface RunProblem {
  url?: string;
  status?: string;
  message?: string;
  reference_id?: number;
  market_code?: string;
}

interface SnapRow {
  id: number;
  reference_id: number;
  market_code: MarketCode;
  amount_minor: number | null;
  currency: string;
  status: string;
  source: string | null;
  slug: string;
  mcur: string;
}

const share = (ok: number, cells: number) => (cells === 0 ? 0 : Math.round((ok / cells) * 10_000) / 10_000);

export function isCurrencyProblem(message: string | undefined): boolean {
  return !!message && /\bcurrency\b|is not in [A-Z]{3}/.test(message);
}

export async function buildRunReport(
  db: D1Database,
  runId: number,
  cells: ReportCell[],
  problems: RunProblem[] = [],
  now: Date = new Date(),
): Promise<RunReport> {
  const { results: snaps } = await db
    .prepare(
      `SELECT s.id, s.reference_id, s.market_code, s.amount_minor, s.currency, s.status,
              s.source, r.slug, m.currency AS mcur
         FROM price_snapshots s
         JOIN watch_references r ON r.id = s.reference_id
         JOIN price_markets m ON m.code = s.market_code
        WHERE s.run_id = ?
        ORDER BY s.id`,
    )
    .bind(runId)
    .all<SnapRow>();

  // --- coverage -------------------------------------------------------------
  const rank: Record<string, number> = { ok: 3, price_on_request: 2, unavailable: 1, error: 0 };
  const best = new Map<string, string>();
  for (const s of snaps) {
    const k = `${s.reference_id}:${s.market_code}`;
    const cur = best.get(k);
    if (cur === undefined || (rank[s.status] ?? 0) > (rank[cur] ?? 0)) best.set(k, s.status);
  }
  const seen = new Set<string>();
  const scope = cells.filter((c) => {
    const k = `${c.reference_id}:${c.market_code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const by_status: Record<string, number> = {};
  const brandAcc = new Map<string, { cells: number; ok: number }>();
  const marketAcc = new Map<string, { cells: number; ok: number }>();
  let okCells = 0;
  for (const c of scope) {
    const st = best.get(`${c.reference_id}:${c.market_code}`) ?? "not_attempted";
    by_status[st] = (by_status[st] ?? 0) + 1;
    const isOk = st === "ok" ? 1 : 0;
    okCells += isOk;
    for (const [m, key] of [[brandAcc, c.brand_slug], [marketAcc, c.market_code]] as const) {
      const a = m.get(key) ?? { cells: 0, ok: 0 };
      a.cells++;
      a.ok += isOk;
      m.set(key, a);
    }
  }
  const groups = (m: Map<string, { cells: number; ok: number }>): CoverageGroup[] =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) => ({ key, ...a, share: share(a.ok, a.cells) }));

  // --- changes and outliers -------------------------------------------------
  const changes: ReportChange[] = [];
  const outliers: ReportOutlier[] = [];
  const ident = (s: SnapRow) => ({ snapshot_id: s.id, reference: s.slug, market: s.market_code, source: s.source });

  for (const s of snaps) {
    if (s.currency !== s.mcur) {
      outliers.push({ kind: "currency_mismatch", ...ident(s), detail: `snapshot is in ${s.currency}, the ${s.market_code} market is in ${s.mcur}` });
    }
    if (s.status !== "ok" || s.amount_minor === null) continue;
    const prev = await db
      .prepare(
        `SELECT amount_minor, currency, captured_at FROM price_snapshots
          WHERE reference_id = ? AND market_code = ? AND status = 'ok' AND id < ?
            AND COALESCE(source, '') = COALESCE(?, '')
          ORDER BY id DESC LIMIT 1`,
      )
      .bind(s.reference_id, s.market_code, s.id, s.source)
      .first<{ amount_minor: number; currency: string; captured_at: string }>();
    if (prev) {
      if (prev.currency !== s.currency) {
        outliers.push({ kind: "currency_mismatch", ...ident(s), detail: `currency changed from ${prev.currency} to ${s.currency} since the previous capture` });
      } else if (prev.amount_minor !== s.amount_minor) {
        const pct = Math.round(((s.amount_minor - prev.amount_minor) / prev.amount_minor) * 10_000) / 100;
        // Compare the exact ratio, not the rounded figure: 15.001% is over.
        const flagged = (Math.abs(s.amount_minor - prev.amount_minor) / prev.amount_minor) * 100 > CHANGE_THRESHOLD_PCT;
        changes.push({ ...ident(s), currency: s.currency, previous_minor: prev.amount_minor, current_minor: s.amount_minor, change_pct: pct, previous_captured_at: prev.captured_at, flagged });
        if (flagged) {
          outliers.push({ kind: "change_over_15", ...ident(s), detail: `${pct > 0 ? "+" : ""}${pct}% (${prev.amount_minor} to ${s.amount_minor} minor units ${s.currency})` });
        }
      }
    }
    if (s.source?.startsWith("retailer:")) {
      const manual = await db
        .prepare(
          `SELECT 1 AS ok FROM price_snapshots
            WHERE reference_id = ? AND method = 'manual' AND source GLOB 'brand:*' AND status = 'ok' LIMIT 1`,
        )
        .bind(s.reference_id)
        .first<{ ok: number }>();
      if (!manual) {
        outliers.push({ kind: "retailer_unconfirmed", ...ident(s), detail: "retailer price, no manual capture from the brand's own site yet" });
      }
    }
  }
  // Pages that showed another currency than the market's: the adapter refused the
  // price (an error snapshot), so only the run's problem list knows why.
  for (const p of problems) {
    if (!isCurrencyProblem(p.message) || p.reference_id === undefined || p.market_code === undefined) continue;
    const s = snaps.find((x) => x.reference_id === p.reference_id && x.market_code === p.market_code && x.status === "error");
    if (s) outliers.push({ kind: "currency_mismatch", ...ident(s), detail: p.message! });
  }

  changes.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  return {
    run_id: runId,
    generated_at: now.toISOString(),
    threshold_pct: CHANGE_THRESHOLD_PCT,
    coverage: { cells: scope.length, ok: okCells, share: share(okCells, scope.length), by_status, by_brand: groups(brandAcc), by_market: groups(marketAcc) },
    changes,
    outliers,
  };
}

/** Builds the report, stores it, and records a review flag for each outlier. */
export async function storeRunReport(
  db: D1Database,
  runId: number,
  cells: ReportCell[],
  problems: RunProblem[] = [],
  now: Date = new Date(),
): Promise<RunReport> {
  const report = await buildRunReport(db, runId, cells, problems, now);
  await db
    .prepare(`INSERT OR REPLACE INTO run_reports (run_id, created_at, report) VALUES (?, ?, ?)`)
    .bind(runId, report.generated_at, JSON.stringify(report))
    .run();
  for (const o of report.outliers) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO price_review_flags (snapshot_id, run_id, kind, detail, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(o.snapshot_id, runId, o.kind, o.detail, report.generated_at)
      .run();
  }
  return report;
}

/** The stored report of a run, or of the latest run that has one. */
export async function getRunReport(db: D1Database, runId?: number): Promise<RunReport | null> {
  const row = runId !== undefined
    ? await db.prepare(`SELECT report FROM run_reports WHERE run_id = ?`).bind(runId).first<{ report: string }>()
    : await db.prepare(`SELECT report FROM run_reports ORDER BY run_id DESC LIMIT 1`).first<{ report: string }>();
  return row ? (JSON.parse(row.report) as RunReport) : null;
}

export interface OpenFlagRow {
  id: number;
  snapshot_id: number;
  run_id: number | null;
  kind: OutlierKind;
  detail: string | null;
  reference: string;
  market: MarketCode;
  created_at: string;
}

/** Flags nobody has resolved yet: the snapshots held back from publishing. */
export async function listOpenReviewFlags(db: D1Database): Promise<OpenFlagRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.snapshot_id, f.run_id, f.kind, f.detail, r.slug AS reference,
              s.market_code AS market, f.created_at
         FROM price_review_flags f
         JOIN price_snapshots s ON s.id = f.snapshot_id
         JOIN watch_references r ON r.id = s.reference_id
        WHERE f.resolved_at IS NULL
        ORDER BY f.id`,
    )
    .all<OpenFlagRow>();
  return results;
}
