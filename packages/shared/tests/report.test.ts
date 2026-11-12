import { beforeEach, describe, expect, it } from 'vitest';
import { buildRunReport, getRunReport, listOpenReviewFlags, storeRunReport, type ReportCell } from '../src/report.ts';
import { insertPriceSnapshot, startCaptureRun, type NewPriceSnapshot } from '../src/prices.ts';
import { freshPriceDb, type TestDb } from './d1-shim.ts';

let t: TestDb;
// Two brands, three references. ids: omega/a 1, omega/b 2, oris/c 3.
beforeEach(() => {
  t = freshPriceDb();
  t.raw.exec(`INSERT INTO brands (id, slug, name) VALUES (1, 'omega', 'Omega'), (2, 'oris', 'Oris')`);
  t.raw.exec(`INSERT INTO watch_references (id, brand_id, slug, ref_code) VALUES
    (1, 1, 'omega/a', 'A'), (2, 1, 'omega/b', 'B'), (3, 2, 'oris/c', 'C')`);
});

const snap = (runId: number, over: Partial<NewPriceSnapshot>): Promise<void> =>
  insertPriceSnapshot(t.d1, {
    reference_id: 1, market_code: 'CH', amount_minor: 100_000, currency: 'CHF', status: 'ok',
    run_id: runId, source: 'brand:www.omegawatches.com', method: 'fetch', captured_at: '2026-11-01T04:00:00Z', ...over,
  });
const cell = (reference_id: number, market_code: ReportCell['market_code'], brand_slug: string): ReportCell => ({ reference_id, market_code, brand_slug });

describe('validation report', () => {
  it('coverage: share of cells with an ok snapshot, by brand and market, with the other statuses', async () => {
    const run = await startCaptureRun(t.d1, 'manual');
    await snap(run, { reference_id: 1 });
    await snap(run, { reference_id: 2, amount_minor: null, status: 'error' });
    await snap(run, { reference_id: 3, market_code: 'US', currency: 'USD', amount_minor: null, status: 'price_on_request' });
    const cells = [cell(1, 'CH', 'omega'), cell(2, 'CH', 'omega'), cell(3, 'US', 'oris'), cell(3, 'CH', 'oris')];
    const r = await buildRunReport(t.d1, run, cells);
    expect(r.coverage).toMatchObject({ cells: 4, ok: 1, share: 0.25, by_status: { ok: 1, error: 1, price_on_request: 1, not_attempted: 1 } });
    expect(r.coverage.by_brand).toEqual([{ key: 'omega', cells: 2, ok: 1, share: 0.5 }, { key: 'oris', cells: 2, ok: 0, share: 0 }]);
    expect(r.coverage.by_market.map((g) => g.key)).toEqual(['CH', 'US']);
  });

  it('coverage counts a cell once even when two sources list it', async () => {
    const run = await startCaptureRun(t.d1, 'manual');
    await snap(run, {});
    const r = await buildRunReport(t.d1, run, [cell(1, 'CH', 'omega'), cell(1, 'CH', 'omega')]);
    expect(r.coverage).toMatchObject({ cells: 1, ok: 1, share: 1 });
  });

  it('empty scope gives share 0, not NaN', async () => {
    const run = await startCaptureRun(t.d1, 'manual');
    expect((await buildRunReport(t.d1, run, [])).coverage.share).toBe(0);
  });

  it('changes: percentage against the previous ok price of the same cell and source', async () => {
    const r1 = await startCaptureRun(t.d1, 'manual');
    await snap(r1, { amount_minor: 100_000 });
    await snap(r1, { reference_id: 2, amount_minor: 200_000 });
    const r2 = await startCaptureRun(t.d1, 'manual');
    await snap(r2, { amount_minor: 105_000, captured_at: '2026-12-01T04:00:00Z' }); // +5%
    await snap(r2, { reference_id: 2, amount_minor: 200_000, captured_at: '2026-12-01T04:00:00Z' }); // unchanged
    const r = await buildRunReport(t.d1, r2, [cell(1, 'CH', 'omega'), cell(2, 'CH', 'omega')]);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ reference: 'omega/a', market: 'CH', previous_minor: 100_000, current_minor: 105_000, change_pct: 5, flagged: false });
    expect(r.outliers).toEqual([]);
  });

  it('a first capture has no change; a different source is not compared', async () => {
    const r1 = await startCaptureRun(t.d1, 'manual');
    await snap(r1, { source: 'brand:other.example.com', amount_minor: 50_000 });
    const r2 = await startCaptureRun(t.d1, 'manual');
    await snap(r2, { amount_minor: 100_000 });
    expect((await buildRunReport(t.d1, r2, [cell(1, 'CH', 'omega')])).changes).toEqual([]);
  });

  it('outlier: a change above 15% either way is flagged (compared unrounded); exactly 15% is not', async () => {
    const r1 = await startCaptureRun(t.d1, 'manual');
    for (const id of [1, 2, 3]) await snap(r1, { reference_id: id, amount_minor: 100_000 });
    const r2 = await startCaptureRun(t.d1, 'manual');
    await snap(r2, { reference_id: 1, amount_minor: 115_000 }); // +15.00%: not flagged
    await snap(r2, { reference_id: 2, amount_minor: 115_001 }); // +15.001%: over, though it rounds to 15
    await snap(r2, { reference_id: 3, amount_minor: 80_000 }); // -20%
    const r = await buildRunReport(t.d1, r2, [cell(1, 'CH', 'omega'), cell(2, 'CH', 'omega'), cell(3, 'CH', 'oris')]);
    const flagged = r.outliers.filter((o) => o.kind === 'change_over_15');
    expect(flagged.map((o) => o.reference).sort()).toEqual(['omega/b', 'oris/c']);
    expect(flagged.find((o) => o.reference === 'oris/c')!.detail).toMatch(/-20%/);
    expect(r.changes[0]).toMatchObject({ reference: 'oris/c', change_pct: -20, flagged: true });
    expect(r.changes.find((c) => c.reference === 'omega/a')).toMatchObject({ change_pct: 15, flagged: false });
  });

  it('outlier: currency mismatch (page currency, snapshot currency, currency switch)', async () => {
    const r1 = await startCaptureRun(t.d1, 'manual');
    await snap(r1, { reference_id: 1, amount_minor: 100_000 });
    const r2 = await startCaptureRun(t.d1, 'manual');
    await snap(r2, { reference_id: 1, currency: 'USD', amount_minor: 100_000 }); // CH market, USD snapshot; and a switch
    await snap(r2, { reference_id: 2, amount_minor: null, status: 'error' });
    const r = await buildRunReport(t.d1, r2, [cell(1, 'CH', 'omega'), cell(2, 'CH', 'omega')], [
      { url: 'https://x', status: 'error', message: 'currency EUR on page, expected CHF', reference_id: 2, market_code: 'CH' },
      { url: 'https://y', status: 'error', message: 'visible price CHF 1 disagrees with product data', reference_id: 1, market_code: 'CH' },
    ]);
    const cm = r.outliers.filter((o) => o.kind === 'currency_mismatch').map((o) => `${o.reference}: ${o.detail}`);
    expect(cm).toContain('omega/a: snapshot is in USD, the CH market is in CHF');
    expect(cm).toContain('omega/a: currency changed from CHF to USD since the previous capture');
    expect(cm).toContain('omega/b: currency EUR on page, expected CHF');
    expect(cm).toHaveLength(3); // the disagreeing visible price is an error, not a currency problem
  });

  it('outlier: retailer price without a manual brand capture; none once there is one', async () => {
    const run = await startCaptureRun(t.d1, 'manual');
    await snap(run, { source: 'retailer:www.bucherer.com' });
    const cells = [cell(1, 'CH', 'omega')];
    expect((await buildRunReport(t.d1, run, cells)).outliers.map((o) => o.kind)).toEqual(['retailer_unconfirmed']);
    await snap(run, { source: 'brand:www.omegawatches.com', method: 'manual' });
    expect((await buildRunReport(t.d1, run, cells)).outliers).toEqual([]);
  });

  it('storeRunReport saves the report, flags outliers and holds them back from the publishable view', async () => {
    const r1 = await startCaptureRun(t.d1, 'manual');
    await snap(r1, { amount_minor: 100_000 });
    const r2 = await startCaptureRun(t.d1, 'manual');
    await snap(r2, { amount_minor: 150_000, captured_at: '2026-12-01T04:00:00Z' });
    const cells = [cell(1, 'CH', 'omega')];
    await storeRunReport(t.d1, r2, cells, [], new Date('2026-12-01T05:00:00Z'));
    await storeRunReport(t.d1, r2, cells, [], new Date('2026-12-01T05:01:00Z')); // finishing twice is harmless
    expect((await getRunReport(t.d1))?.run_id).toBe(r2);
    expect((await getRunReport(t.d1, r1))).toBeNull();
    const flags = await listOpenReviewFlags(t.d1);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'change_over_15', reference: 'omega/a', market: 'CH' });
    const countable = (t.raw.prepare(`SELECT amount_minor FROM price_snapshots_countable WHERE run_id = ?`).all(r2) as unknown[]);
    expect(countable).toEqual([]); // held back
    expect(t.raw.prepare(`SELECT COUNT(*) AS n FROM price_snapshots_countable WHERE run_id = ?`).get(r1)).toEqual({ n: 1 });
    // A person resolves the flag: the snapshot is publishable again.
    t.raw.exec(`UPDATE price_review_flags SET resolved_at = '2026-12-02T00:00:00Z', resolution = 'checked on the brand site'`);
    expect(await listOpenReviewFlags(t.d1)).toEqual([]);
    expect(t.raw.prepare(`SELECT COUNT(*) AS n FROM price_snapshots_countable WHERE run_id = ?`).get(r2)).toEqual({ n: 1 });
  });
});
