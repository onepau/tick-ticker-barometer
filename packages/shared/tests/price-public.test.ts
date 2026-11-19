import { describe, expect, it } from 'vitest';
import {
  buildMarketSeries,
  convertToChf,
  formatMoney,
  getFxSnapshot,
  pricesEnabled,
  sourceLabel,
  type PublicSnapshot,
} from '../src/price-public.ts';
import type { PriceMarketRow } from '../src/prices.ts';
import { freshPriceDb } from './d1-shim.ts';

const MARKETS: PriceMarketRow[] = [
  { code: 'CH', currency: 'CHF', tax_included: 1 },
  { code: 'US', currency: 'USD', tax_included: 0 },
];

let id = 0;
const snap = (o: Partial<PublicSnapshot>): PublicSnapshot => ({
  id: ++id,
  reference_id: 1,
  market_code: 'CH',
  amount_minor: 100000,
  currency: 'CHF',
  status: 'ok',
  captured_at: '2026-12-01T10:00:00Z',
  source: 'brand:www.x.com',
  source_url: null,
  tax_label: null,
  ...o,
});

describe('pricesEnabled', () => {
  it('is on only for "1"', () => {
    expect(pricesEnabled({ PRICES_PUBLIC: '1' })).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'on']) expect(pricesEnabled({ PRICES_PUBLIC: v })).toBe(false);
  });
});

describe('formatMoney and sourceLabel', () => {
  it('shows whole amounts without decimals and keeps pence', () => {
    expect(formatMoney(990000, 'CHF')).toBe('CHF 9,900');
    expect(formatMoney(990050, 'GBP')).toBe('GBP 9,900.50');
  });
  it('names retailers and brand sites', () => {
    expect(sourceLabel('retailer:www.bucherer.com')).toBe('Bucherer (authorised retailer)');
    expect(sourceLabel('retailer:www.watches-of-switzerland.co.uk')).toBe('Watches of Switzerland (authorised retailer)');
    expect(sourceLabel('brand:www.rolex.com')).toBe('rolex.com (brand site)');
    expect(sourceLabel('retailer:shop.example.com')).toBe('shop.example.com (authorised retailer)');
    expect(sourceLabel(null)).toBe('Source not recorded');
  });
});

describe('convertToChf', () => {
  const fx = { rates: { EUR: { rate: 1, date: 'x' }, CHF: { rate: 0.93, date: '2026-12-01' }, USD: { rate: 1.06, date: '2026-12-01' } } };
  it('goes through EUR', () => {
    expect(convertToChf(745000, 'EUR', fx)).toEqual({ chfMinor: 692850, rateDate: '2026-12-01' });
    expect(convertToChf(700000, 'USD', fx)).toEqual({ chfMinor: 614151, rateDate: '2026-12-01' });
    expect(convertToChf(100, 'CHF', fx)).toEqual({ chfMinor: 100, rateDate: '2026-12-01' });
  });
  it('is null when a rate is missing', () => {
    expect(convertToChf(100, 'GBP', fx)).toBeNull();
  });
});

describe('getFxSnapshot', () => {
  it('takes the latest rate on or before the day, else the earliest after', async () => {
    const t = freshPriceDb();
    t.raw.exec(`INSERT INTO fx_rates (date, base, currency, rate) VALUES
      ('2026-12-01','EUR','CHF',0.93),('2026-12-03','EUR','CHF',0.94),('2026-12-03','EUR','USD',1.05)`);
    const on = await getFxSnapshot(t.d1, '2026-12-02');
    expect(on.rates.CHF).toEqual({ rate: 0.93, date: '2026-12-01' });
    // USD has nothing on or before 2 December: falls back to the earliest after.
    expect(on.rates.USD).toEqual({ rate: 1.05, date: '2026-12-03' });
    expect(on.rates.GBP).toBeUndefined();
  });
});

describe('buildMarketSeries', () => {
  it('keeps the first capture and each change, not unchanged checks', () => {
    const [s] = buildMarketSeries(
      [
        snap({ captured_at: '2026-12-01T10:00:00Z' }),
        snap({ captured_at: '2026-12-29T10:00:00Z' }),
        snap({ captured_at: '2027-01-02T10:00:00Z', amount_minor: 103000 }),
        snap({ captured_at: '2027-01-03T10:00:00Z', amount_minor: 103000 }),
      ],
      MARKETS,
    );
    expect(s!.changes.map((c) => c.amount_minor)).toEqual([100000, 103000]);
    expect(s!.checks).toBe(4);
    expect(s!.latest.captured_at).toBe('2027-01-03T10:00:00Z');
  });

  it('a market that moved to "unavailable" keeps its last listed price', () => {
    const [s] = buildMarketSeries(
      [snap({}), snap({ captured_at: '2027-01-02T10:00:00Z', status: 'unavailable', amount_minor: null })],
      MARKETS,
    );
    expect(s!.latest.status).toBe('unavailable');
    expect(s!.lastOk?.amount_minor).toBe(100000);
  });

  it('uses one source per market: the latest, the brand site winning a tie', () => {
    const [s] = buildMarketSeries(
      [
        snap({ source: 'retailer:www.bucherer.com', amount_minor: 111111 }),
        snap({ source: 'brand:www.x.com', amount_minor: 100000 }),
        snap({ source: 'retailer:www.bucherer.com', amount_minor: 122222, captured_at: '2026-11-01T10:00:00Z' }),
      ],
      MARKETS,
    );
    expect(s!.source).toBe('brand:www.x.com');
    expect(s!.changes).toHaveLength(1);
    expect(s!.latest.amount_minor).toBe(100000);
  });

  it('skips markets without snapshots and keeps market order', () => {
    const out = buildMarketSeries([snap({ market_code: 'US', currency: 'USD' })], MARKETS);
    expect(out.map((x) => x.market)).toEqual(['US']);
    expect(out[0]!.taxIncluded).toBe(false);
  });
});
