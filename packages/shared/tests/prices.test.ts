import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidSnapshot,
  finishCaptureRun,
  getCaptureRun,
  getFxRate,
  getLatestPrices,
  getPriceChangesSince,
  getPriceHistory,
  insertPriceSnapshot,
  listPriceMarkets,
  startCaptureRun,
  upsertFxRate,
  type NewPriceSnapshot,
} from '../src/prices.ts';
import { freshPriceDb, migrationSql, type TestDb } from './d1-shim.ts';

let t: TestDb;
beforeEach(() => {
  t = freshPriceDb();
});

const ok = (over: Partial<NewPriceSnapshot> = {}): NewPriceSnapshot => ({
  reference_id: 1,
  market_code: 'CH',
  amount_minor: 990_000,
  currency: 'CHF',
  status: 'ok',
  captured_at: '2026-12-10T08:00:00Z',
  ...over,
});

describe('migration 0007', () => {
  it('seeds the four markets with currency and tax rule', async () => {
    expect(await listPriceMarkets(t.d1)).toEqual([
      { code: 'CH', currency: 'CHF', tax_included: 1 },
      { code: 'FR', currency: 'EUR', tax_included: 1 },
      { code: 'UK', currency: 'GBP', tax_included: 1 },
      { code: 'US', currency: 'USD', tax_included: 0 },
    ]);
  });

  it('is idempotent (re-applying does not fail or duplicate seeds)', async () => {
    t.raw.exec(migrationSql('0007_price_schema.sql'));
    expect(await listPriceMarkets(t.d1)).toHaveLength(4);
  });

  it('creates the latest/history index led by reference_id and market_code', () => {
    const cols = t.raw
      .prepare(`PRAGMA index_info('idx_price_snapshots_ref_market_time')`)
      .all()
      .map((r) => r.name);
    expect(cols).toEqual(['reference_id', 'market_code', 'captured_at', 'id']);
  });

  it('uses the index for the latest-price lookup', () => {
    const plan = t.raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM price_snapshots
          WHERE reference_id = 1 AND market_code = 'CH'
          ORDER BY captured_at DESC, id DESC LIMIT 1`,
      )
      .all()
      .map((r) => String(r.detail))
      .join(' | ');
    expect(plan).toContain('idx_price_snapshots_ref_market_time');
    expect(plan).not.toContain('TEMP B-TREE');
  });

  it('has no foreign key from snapshots to watch_references (unit 1 adds that table)', () => {
    const fks = t.raw.prepare(`PRAGMA foreign_key_list('price_snapshots')`).all();
    expect(fks.map((f) => f.table).sort()).toEqual(['capture_runs', 'price_markets']);
  });
});

describe('price_snapshots is append-only', () => {
  it('blocks UPDATE', async () => {
    await insertPriceSnapshot(t.d1, ok());
    expect(() => t.raw.exec('UPDATE price_snapshots SET amount_minor = 1')).toThrow(
      /append-only/,
    );
  });

  it('blocks DELETE', async () => {
    await insertPriceSnapshot(t.d1, ok());
    expect(() => t.raw.exec('DELETE FROM price_snapshots')).toThrow(/append-only/);
  });
});

describe('amount and status rules', () => {
  it('rejects a fractional amount at the database level', () => {
    expect(() =>
      t.raw.exec(
        `INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at)
         VALUES (1, 'CH', 990.5, 'CHF', 'ok', '2026-12-10')`,
      ),
    ).toThrow(/CHECK/);
  });

  it('rejects an amount on a non-ok status at the database level', () => {
    expect(() =>
      t.raw.exec(
        `INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at)
         VALUES (1, 'CH', 100, 'CHF', 'price_on_request', '2026-12-10')`,
      ),
    ).toThrow(/CHECK/);
  });

  it('rejects an unknown status and an unknown market', () => {
    expect(() =>
      t.raw.exec(
        `INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at)
         VALUES (1, 'CH', NULL, 'CHF', 'sold_out', '2026-12-10')`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      t.raw.exec(
        `INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at)
         VALUES (1, 'DE', NULL, 'EUR', 'error', '2026-12-10')`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('assertValidSnapshot guards before SQL', () => {
    expect(() => assertValidSnapshot(ok({ amount_minor: 9900.5 }))).toThrow(/integer/);
    expect(() => assertValidSnapshot(ok({ amount_minor: null }))).toThrow(/integer/);
    expect(() => assertValidSnapshot(ok({ amount_minor: 0 }))).toThrow(/positive/);
    expect(() =>
      assertValidSnapshot(ok({ status: 'unavailable', amount_minor: 100 })),
    ).toThrow(/must not carry/);
    expect(() => assertValidSnapshot(ok({ currency: 'chf' }))).toThrow(/currency/);
    expect(() =>
      assertValidSnapshot(ok({ status: 'price_on_request', amount_minor: null })),
    ).not.toThrow();
  });

  it('insertPriceSnapshot returns ids and stores integers', async () => {
    const id = await insertPriceSnapshot(t.d1, ok());
    expect(id).toBe(1);
    const row = t.raw.prepare('SELECT typeof(amount_minor) AS t FROM price_snapshots').get();
    expect(row?.t).toBe('integer');
  });
});

describe('capture runs', () => {
  it('starts and finishes a run with JSON counts and errors', async () => {
    const id = await startCaptureRun(t.d1, 'manual', '2026-12-10T08:00:00Z');
    await finishCaptureRun(
      t.d1,
      id,
      { ok: 3, error: 1 },
      [{ ref: 7, market: 'US', msg: 'timeout' }],
      '2026-12-10T08:05:00Z',
    );
    const run = await getCaptureRun(t.d1, id);
    expect(run).toMatchObject({
      id,
      trigger: 'manual',
      started_at: '2026-12-10T08:00:00Z',
      finished_at: '2026-12-10T08:05:00Z',
    });
    expect(JSON.parse(run!.counts!)).toEqual({ ok: 3, error: 1 });
    expect(JSON.parse(run!.errors!)).toHaveLength(1);
  });

  it('rejects an unknown trigger', async () => {
    await expect(startCaptureRun(t.d1, 'webhook' as never)).rejects.toThrow(/CHECK/);
  });

  it('links snapshots to a run', async () => {
    const runId = await startCaptureRun(t.d1, 'cron');
    await insertPriceSnapshot(t.d1, ok({ run_id: runId }));
    const [row] = await getLatestPrices(t.d1);
    expect(row?.run_id).toBe(runId);
  });
});

describe('getLatestPrices and getPriceHistory', () => {
  beforeEach(async () => {
    // Reference 1: CH rises, FR goes to price on request; US has a tie in time.
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2026-12-10T08:00:00Z', amount_minor: 990_000 }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2027-01-02T08:00:00Z', amount_minor: 1_020_000 }));
    await insertPriceSnapshot(t.d1, ok({ market_code: 'FR', currency: 'EUR', amount_minor: 1_050_000 }));
    await insertPriceSnapshot(
      t.d1,
      ok({ market_code: 'FR', currency: 'EUR', status: 'price_on_request', amount_minor: null, captured_at: '2027-01-02T08:00:00Z' }),
    );
    await insertPriceSnapshot(t.d1, ok({ market_code: 'US', currency: 'USD', amount_minor: 1_100_000 }));
    await insertPriceSnapshot(t.d1, ok({ market_code: 'US', currency: 'USD', amount_minor: 1_150_000 }));
    // Reference 2: one CH price.
    await insertPriceSnapshot(t.d1, ok({ reference_id: 2, amount_minor: 500_000 }));
  });

  it('returns one row per reference × market, newest first, ties broken by id', async () => {
    const rows = await getLatestPrices(t.d1);
    expect(rows.map((r) => [r.reference_id, r.market_code, r.status, r.amount_minor])).toEqual([
      [1, 'CH', 'ok', 1_020_000],
      [1, 'FR', 'price_on_request', null],
      [1, 'US', 'ok', 1_150_000],
      [2, 'CH', 'ok', 500_000],
    ]);
  });

  it('okOnly returns the last known price', async () => {
    const rows = await getLatestPrices(t.d1, { referenceId: 1, marketCode: 'FR', okOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount_minor).toBe(1_050_000);
  });

  it('filters by reference and market', async () => {
    const rows = await getLatestPrices(t.d1, { marketCode: 'CH' });
    expect(rows.map((r) => r.reference_id)).toEqual([1, 2]);
  });

  it('history is ordered by market then time, and can be filtered', async () => {
    const all = await getPriceHistory(t.d1, 1);
    expect(all.map((r) => r.market_code)).toEqual(['CH', 'CH', 'FR', 'FR', 'US', 'US']);
    const chSince = await getPriceHistory(t.d1, 1, { marketCode: 'CH', since: '2027-01-01' });
    expect(chSince.map((r) => r.amount_minor)).toEqual([1_020_000]);
  });
});

describe('getPriceChangesSince', () => {
  it('compares the last ok price on or before the baseline date with the latest after it', async () => {
    // Two baseline captures; the later one (29 December) is the baseline.
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2026-12-14T08:00:00Z', amount_minor: 980_000 }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2026-12-29T23:59:00Z', amount_minor: 1_000_000 }));
    // January: an error, then two increases; the latest counts.
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2027-01-02T08:00:00Z', status: 'error', amount_minor: null }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2027-01-03T08:00:00Z', amount_minor: 1_030_000 }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2027-01-05T08:00:00Z', amount_minor: 1_045_000 }));
    // Unchanged cell: excluded.
    await insertPriceSnapshot(t.d1, ok({ market_code: 'UK', currency: 'GBP', captured_at: '2026-12-29T08:00:00Z', amount_minor: 800_000 }));
    await insertPriceSnapshot(t.d1, ok({ market_code: 'UK', currency: 'GBP', captured_at: '2027-01-04T08:00:00Z', amount_minor: 800_000 }));
    // Currency switch: excluded, left for manual review.
    await insertPriceSnapshot(t.d1, ok({ market_code: 'US', currency: 'USD', captured_at: '2026-12-29T08:00:00Z', amount_minor: 1_100_000 }));
    await insertPriceSnapshot(t.d1, ok({ market_code: 'US', currency: 'EUR', captured_at: '2027-01-04T08:00:00Z', amount_minor: 1_000_000 }));
    // No post-baseline capture: excluded.
    await insertPriceSnapshot(t.d1, ok({ reference_id: 3, captured_at: '2026-12-29T08:00:00Z' }));

    const changes = await getPriceChangesSince(t.d1, '2026-12-29');
    expect(changes).toEqual([
      {
        reference_id: 1,
        market_code: 'CH',
        currency: 'CHF',
        baseline_amount_minor: 1_000_000,
        baseline_captured_at: '2026-12-29T23:59:00Z',
        current_amount_minor: 1_045_000,
        current_captured_at: '2027-01-05T08:00:00Z',
        delta_minor: 45_000,
        change_pct: 4.5,
      },
    ]);
  });

  it('filters by market and handles decreases', async () => {
    await insertPriceSnapshot(t.d1, ok({ market_code: 'FR', currency: 'EUR', captured_at: '2026-12-15T08:00:00Z', amount_minor: 300_000 }));
    await insertPriceSnapshot(t.d1, ok({ market_code: 'FR', currency: 'EUR', captured_at: '2027-01-10T08:00:00Z', amount_minor: 290_000 }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2026-12-15T08:00:00Z', amount_minor: 100_000 }));
    await insertPriceSnapshot(t.d1, ok({ captured_at: '2027-01-10T08:00:00Z', amount_minor: 110_000 }));
    const fr = await getPriceChangesSince(t.d1, '2026-12-15', { marketCode: 'FR' });
    expect(fr).toHaveLength(1);
    expect(fr[0]).toMatchObject({ delta_minor: -10_000, change_pct: -3.33 });
  });

  it('rejects a malformed baseline date', async () => {
    await expect(getPriceChangesSince(t.d1, '15/12/2026')).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('fx rates', () => {
  it('upserts and reads the latest rate on or before a date', async () => {
    await upsertFxRate(t.d1, { date: '2026-12-14', currency: 'CHF', rate: 0.9312 });
    await upsertFxRate(t.d1, { date: '2026-12-15', currency: 'CHF', rate: 0.93 });
    await upsertFxRate(t.d1, { date: '2026-12-15', currency: 'CHF', rate: 0.9351 }); // ECB revision
    const n = t.raw.prepare('SELECT COUNT(*) AS n FROM fx_rates').get();
    expect(n?.n).toBe(2);
    expect(await getFxRate(t.d1, 'CHF', '2026-12-16')).toEqual({
      date: '2026-12-15',
      base: 'EUR',
      currency: 'CHF',
      rate: 0.9351,
    });
    expect((await getFxRate(t.d1, 'CHF', '2026-12-14'))?.rate).toBe(0.9312);
    expect(await getFxRate(t.d1, 'GBP', '2026-12-16')).toBeNull();
  });

  it('rejects non-positive rates', async () => {
    await expect(upsertFxRate(t.d1, { date: '2026-12-15', currency: 'USD', rate: 0 })).rejects.toThrow();
  });
});
