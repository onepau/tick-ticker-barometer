import { describe, expect, it } from 'vitest';
import { buildReferencesSql } from '../scripts/references-sql.ts';
import { CSV, seededDb } from './helpers.ts';

describe('CSV import', () => {
  it('loads every reference, URL and source from the unit 5 CSV', () => {
    const built = buildReferencesSql(CSV);
    expect(built.skipped).toEqual([]);
    const t = seededDb();
    const n = (sql: string) => (t.raw.prepare(sql).get() as { n: number }).n;
    expect(n(`SELECT COUNT(*) AS n FROM watch_references`)).toBe(built.references);
    expect(built.references).toBe(161);
    expect(n(`SELECT COUNT(*) AS n FROM reference_price_urls`)).toBe(built.urls);
    expect(n(`SELECT COUNT(*) AS n FROM price_sources`)).toBe(built.sources);
  });

  it('is idempotent', () => {
    const t = seededDb();
    t.raw.exec(buildReferencesSql(CSV).sql);
    expect((t.raw.prepare(`SELECT COUNT(*) AS n FROM watch_references`).get() as { n: number }).n).toBe(161);
  });

  it('marks Rolex retailer pages as retailer sources, per host', () => {
    const t = seededDb();
    const rows = t.raw
      .prepare(
        `SELECT u.market_code, u.source FROM reference_price_urls u JOIN watch_references r ON r.id = u.reference_id
          WHERE r.ref_code = '126610LN' ORDER BY u.market_code`,
      )
      .all();
    expect(rows).toEqual([
      { market_code: 'CH', source: 'retailer:www.bucherer.com' },
      { market_code: 'FR', source: 'retailer:www.bucherer.com' },
      { market_code: 'UK', source: 'retailer:www.watches-of-switzerland.co.uk' },
      { market_code: 'US', source: 'retailer:www.bucherer.com' },
    ]);
  });

  it('gives every source its adapter (units 6 and 7), none pending', () => {
    const t = seededDb();
    const src = t.raw.prepare(`SELECT source, adapter_key, notes FROM price_sources WHERE market_code = 'CH' ORDER BY source`).all() as {
      source: string; adapter_key: string; notes: string | null;
    }[];
    expect(src.find((s) => s.source === 'brand:www.cartier.com')).toMatchObject({ adapter_key: 'cartier', notes: null });
    expect(src.find((s) => s.source === 'retailer:www.bucherer.com')).toMatchObject({ adapter_key: 'bucherer' });
    for (const [host, key] of [['longines', 'longines'], ['tissotwatches', 'tissot'], ['rado', 'rado'], ['omegawatches', 'omega'], ['oris', 'oris'], ['grand-seiko', 'grand-seiko']]) {
      expect(src.find((s) => s.source.includes(host))).toMatchObject({ adapter_key: key, notes: null });
    }
    expect(src.filter((s) => s.notes?.includes('pending'))).toEqual([]);
  });
});
