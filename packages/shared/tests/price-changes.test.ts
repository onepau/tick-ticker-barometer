import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPublicPriceChanges,
  listLatestChangePerMarket,
  sortChanges,
  type PublicPriceChange,
} from '../src/price-public.ts';
import { freshPriceDb, type TestDb } from './d1-shim.ts';

// Baseline window 1–3 December 2026; changes are measured against captures from 4 December on.
const REPORT = { baselineFrom: '2026-12-01', baselineTo: '2026-12-03', until: '2027-12-01' };

let t: TestDb;
const snap = (
  ref: number,
  market: string,
  amount: number | null,
  at: string,
  o: { cur?: string; status?: string; source?: string; method?: string } = {},
) =>
  t.raw
    .prepare(
      `INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ref, market, amount, o.cur ?? 'CHF', o.status ?? 'ok', at, o.source ?? 'brand:www.omegawatches.com', o.method ?? 'fetch');

const changes = () => getPublicPriceChanges(t.d1, REPORT);

beforeEach(() => {
  t = freshPriceDb();
  t.raw.exec(`
    INSERT INTO brands (id, slug, name, prices_public) VALUES (1,'omega','Omega',1),(2,'rolex','Rolex',1),(3,'tissot','Tissot',0);
    INSERT INTO watch_references (id, brand_id, slug, ref_code, name) VALUES
      (1,1,'omega/a','A','Alpha'),(2,1,'omega/b','B','Bravo'),(3,2,'rolex/c','C','Charlie'),(4,3,'tissot/d','D','Delta');
  `);
});

describe('getPublicPriceChanges', () => {
  it('compares the first ok price in the baseline window with the latest ok price after it', async () => {
    snap(1, 'CH', 700000, '2026-11-20T10:00:00Z'); // before the window: ignored
    snap(1, 'CH', 710000, '2026-12-01T10:00:00Z'); // first in window = baseline
    snap(1, 'CH', 720000, '2026-12-02T10:00:00Z'); // later in window: not the baseline
    snap(1, 'CH', 710000, '2026-12-29T10:00:00Z');
    snap(1, 'CH', 731300, '2027-01-02T10:00:00Z');
    snap(1, 'CH', 731300, '2027-01-03T10:00:00Z');
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference_slug: 'omega/a',
      market_code: 'CH',
      baseline_amount_minor: 710000,
      baseline_captured_at: '2026-12-01T10:00:00Z',
      current_amount_minor: 731300,
      current_captured_at: '2027-01-03T10:00:00Z',
      first_new_at: '2027-01-02T10:00:00Z',
      delta_minor: 21300,
      change_pct: 3,
    });
  });

  it('does not report unchanged prices, a lone baseline or a price that went up and came back', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z');
    snap(1, 'CH', 700000, '2027-01-02T10:00:00Z'); // unchanged
    snap(2, 'CH', 700000, '2026-12-01T10:00:00Z'); // no later capture
    snap(1, 'FR', 700000, '2026-12-01T10:00:00Z', { cur: 'EUR' });
    snap(1, 'FR', 720000, '2027-01-02T10:00:00Z', { cur: 'EUR' });
    snap(1, 'FR', 700000, '2027-01-03T10:00:00Z', { cur: 'EUR' }); // back to baseline
    expect(await changes()).toEqual([]);
  });

  it('ignores errors, price on request and unavailable: only ok prices are compared', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z');
    snap(1, 'CH', null, '2027-01-02T10:00:00Z', { status: 'error' });
    snap(1, 'CH', null, '2027-01-03T10:00:00Z', { status: 'price_on_request' });
    snap(1, 'CH', null, '2027-01-04T10:00:00Z', { status: 'unavailable' });
    expect(await changes()).toEqual([]);
    // An error in the baseline window is not a baseline either.
    snap(2, 'CH', null, '2026-12-01T09:00:00Z', { status: 'error' });
    snap(2, 'CH', 500000, '2026-12-01T10:00:00Z');
    snap(2, 'CH', 520000, '2027-01-02T10:00:00Z');
    const rows = await changes();
    expect(rows.map((r) => [r.reference_slug, r.baseline_amount_minor])).toEqual([['omega/b', 500000]]);
  });

  it('ignores snapshots with an open review flag, and counts them again once resolved', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z');
    const flagged = Number(snap(1, 'CH', 900000, '2027-01-02T10:00:00Z').lastInsertRowid);
    t.raw.prepare(`INSERT INTO price_review_flags (snapshot_id, kind, created_at) VALUES (?, 'change_over_15', '2027-01-02')`).run(flagged);
    expect(await changes()).toEqual([]);
    t.raw.prepare(`UPDATE price_review_flags SET resolved_at = '2027-01-05' WHERE snapshot_id = ?`).run(flagged);
    expect((await changes())[0]).toMatchObject({ current_amount_minor: 900000, change_pct: 28.57 });
  });

  it('a flagged latest price falls back to the latest unflagged one', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z');
    snap(1, 'CH', 721000, '2027-01-02T10:00:00Z');
    const flagged = Number(snap(1, 'CH', 990000, '2027-01-03T10:00:00Z').lastInsertRowid);
    t.raw.prepare(`INSERT INTO price_review_flags (snapshot_id, kind, created_at) VALUES (?, 'change_over_15', '2027-01-03')`).run(flagged);
    expect((await changes())[0]).toMatchObject({ current_amount_minor: 721000 });
  });

  it('never mixes currencies: a baseline and a current price in different currencies are not compared', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z', { cur: 'CHF' });
    snap(1, 'CH', 720000, '2027-01-02T10:00:00Z', { cur: 'EUR' });
    expect(await changes()).toEqual([]);
  });

  it('never mixes sources: brand baseline against a retailer price is not a change', async () => {
    snap(3, 'CH', 1000000, '2026-11-09T10:00:00Z', { source: 'brand:www.rolex.com', method: 'manual' });
    snap(3, 'CH', 1000000, '2026-12-01T10:00:00Z', { source: 'retailer:www.bucherer.com' });
    snap(3, 'CH', 1050000, '2027-01-02T10:00:00Z', { source: 'retailer:www.bucherer.com' });
    snap(3, 'FR', 900000, '2026-12-01T10:00:00Z', { cur: 'EUR', source: 'retailer:www.bucherer.com' });
    snap(3, 'FR', 950000, '2027-01-02T10:00:00Z', { cur: 'EUR', source: 'brand:www.rolex.com', method: 'manual' });
    const rows = await changes();
    expect(rows.map((r) => [r.market_code, r.source, r.change_pct])).toEqual([['CH', 'retailer:www.bucherer.com', 5]]);
  });

  it('retailer prices need a manual brand capture of the same reference', async () => {
    snap(3, 'CH', 1000000, '2026-12-01T10:00:00Z', { source: 'retailer:www.bucherer.com' });
    snap(3, 'CH', 1050000, '2027-01-02T10:00:00Z', { source: 'retailer:www.bucherer.com' });
    expect(await changes()).toEqual([]);
    snap(3, 'CH', 1000000, '2026-11-09T10:00:00Z', { source: 'brand:www.rolex.com', method: 'manual' });
    expect(await changes()).toHaveLength(1);
  });

  it('leaves out brands that are not public and honours the end date', async () => {
    snap(4, 'CH', 100000, '2026-12-01T10:00:00Z');
    snap(4, 'CH', 110000, '2027-01-02T10:00:00Z');
    snap(1, 'CH', 100000, '2026-12-01T10:00:00Z');
    snap(1, 'CH', 110000, '2028-01-02T10:00:00Z'); // after "until"
    expect(await changes()).toEqual([]);
    expect(await getPublicPriceChanges(t.d1, { ...REPORT, until: undefined })).toHaveLength(1);
  });

  it('reports decreases with a negative percentage', async () => {
    snap(1, 'US', 100000, '2026-12-01T10:00:00Z', { cur: 'USD' });
    snap(1, 'US', 95000, '2027-01-02T10:00:00Z', { cur: 'USD' });
    expect((await changes())[0]).toMatchObject({ delta_minor: -5000, change_pct: -5 });
  });
});

describe('listLatestChangePerMarket', () => {
  it('picks the most recent change per market across the brand, per source and currency', async () => {
    snap(1, 'CH', 700000, '2026-12-01T10:00:00Z');
    snap(1, 'CH', 721000, '2027-01-02T10:00:00Z');
    snap(2, 'CH', 500000, '2026-12-01T10:00:00Z');
    snap(2, 'CH', 520000, '2027-01-05T10:00:00Z'); // later: wins for CH
    snap(1, 'UK', 600000, '2026-12-01T10:00:00Z', { cur: 'GBP' });
    snap(1, 'UK', 600000, '2027-01-02T10:00:00Z', { cur: 'GBP' }); // no change
    snap(1, 'US', 600000, '2026-12-01T10:00:00Z', { cur: 'USD' });
    snap(1, 'US', 600000, '2027-01-02T10:00:00Z', { cur: 'EUR' }); // currency switch: not a change
    const out = await listLatestChangePerMarket(t.d1, 1);
    expect(out.map((c) => [c.market_code, c.reference_slug, c.change_pct])).toEqual([['CH', 'omega/b', 4]]);
  });
});

describe('sortChanges', () => {
  const row = (brand: string, ref: string, market: string, pct: number) =>
    ({ brand_name: brand, ref_code: ref, market_code: market, change_pct: pct }) as PublicPriceChange;
  const rows = [row('Omega', 'A', 'US', 2), row('Cartier', 'B', 'CH', 5), row('Omega', 'A', 'CH', 5), row('Cartier', 'C', 'FR', -1)];
  const key = (rs: PublicPriceChange[]) => rs.map((r) => `${r.brand_name[0]}${r.ref_code}${r.market_code}`);
  it('by percentage, ties by brand then reference then market', () => {
    expect(key(sortChanges(rows, 'pct', 'desc'))).toEqual(['CBCH', 'OACH', 'OAUS', 'CCFR']);
    expect(key(sortChanges(rows, 'pct', 'asc'))[0]).toBe('CCFR');
  });
  it('by brand and by market (CH, FR, UK, US order)', () => {
    expect(key(sortChanges(rows, 'brand', 'asc'))).toEqual(['CBCH', 'CCFR', 'OACH', 'OAUS']);
    expect(key(sortChanges(rows, 'market', 'asc'))).toEqual(['CBCH', 'OACH', 'CCFR', 'OAUS']);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    sortChanges(rows, 'pct', 'asc');
    expect(rows).toEqual(copy);
  });
});
