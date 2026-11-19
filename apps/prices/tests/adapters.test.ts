import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MarketCode } from '@baromontres/shared';
import { adapterFor, MARKET_CURRENCY, type Adapter } from '../src/adapters/index.ts';
import { breitling } from '../src/adapters/breitling.ts';
import { bucherer } from '../src/adapters/bucherer.ts';
import { cartier } from '../src/adapters/cartier.ts';
import { watchesOfSwitzerland } from '../src/adapters/watches-of-switzerland.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function run(a: Adapter, file: string, refCode: string, market: MarketCode, brandSlug = a.brands[0]!) {
  return a.parse(fixture(file), { refCode, brandSlug, url: 'https://example.test/' }, market, MARKET_CURRENCY[market]);
}

// Expected figures are the prices recorded in docs/plans/u5-reference-candidates.csv
// from the same pages (6 November 2026).
describe('Cartier', () => {
  it.each([
    ['CH', 700_000, 'CHF 7,000', 'incl. VAT'],
    ['FR', 830_000, '8,300€', 'TVA incluse'],
    ['UK', 725_000, '£7,250', 'incl. VAT'],
    ['US', 840_000, '$8,400', null],
  ] as const)('CRWSSA0029 %s', (market, minor, text, tax) => {
    const r = run(cartier, `cartier-CRWSSA0029-${market.toLowerCase()}.html`, 'CRWSSA0029', market);
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, currency: MARKET_CURRENCY[market], priceText: text, taxLabel: tax });
    expect(r.evidenceParts.join('')).toContain('application/ld+json');
  });

  it('CRWGTA0011 CH (gold, five figures)', () => {
    expect(run(cartier, 'cartier-CRWGTA0011-ch.html', 'CRWGTA0011', 'CH')).toMatchObject({ status: 'ok', amountMinor: 1_300_000 });
  });

  it('refuses a page for another reference', () => {
    const r = run(cartier, 'cartier-CRWSSA0029-ch.html', 'CRWGTA0011', 'CH');
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/not found/);
  });

  it('refuses a currency that does not match the market', () => {
    const r = run(cartier, 'cartier-CRWSSA0029-fr.html', 'CRWSSA0029', 'CH');
    expect(r).toMatchObject({ status: 'error', amountMinor: null });
    expect(r.message).toMatch(/currency EUR/);
  });
});

describe('Breitling', () => {
  it.each([
    ['CH', 910_000, 'VAT Incl.'],
    ['FR', 985_000, 'TVA incluse'],
    ['UK', 815_000, 'VAT Incl.'],
    ['US', 1_070_000, 'Excl. Sales Tax'],
  ] as const)('AB0138211B1A1 %s', (market, minor, tax) => {
    const r = run(breitling, `breitling-AB0138211B1A1-${market.toLowerCase()}.html`, 'AB0138211B1A1', market);
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, taxLabel: tax, refSeen: 'AB0138211B1A1' });
    expect(r.priceText).toBeTruthy();
  });

  it('A17376211B1A1 UK', () => {
    expect(run(breitling, 'breitling-A17376211B1A1-uk.html', 'A17376211B1A1', 'UK')).toMatchObject({ status: 'ok', amountMinor: 470_000 });
  });

  it('refuses a page for another reference', () => {
    expect(run(breitling, 'breitling-AB0138211B1A1-ch.html', 'A17376211B1A1', 'CH').status).toBe('error');
  });
});

describe('Bucherer (retailer)', () => {
  it.each([
    ['CH', 1_015_000, 'Suggested retail price inclusive of V.A.T.'],
    ['FR', 1_100_000, 'Suggested retail price inclusive of V.A.T.'],
    ['US', 1_135_000, null],
  ] as const)('Rolex 126610LN %s', (market, minor, tax) => {
    const r = run(bucherer, `bucherer-126610LN-${market.toLowerCase()}.html`, '126610LN', market, 'rolex');
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, taxLabel: tax });
    expect(r.refSeen).toMatch(/126610LN/);
  });

  it('checks the reference on the locale page', () => {
    expect(run(bucherer, 'bucherer-126610LN-ch.html', '126000', 'CH', 'rolex').status).toBe('error');
  });

  it('checks the pricebook matches the market', () => {
    const r = run(bucherer, 'bucherer-126610LN-fr.html', '126610LN', 'CH', 'rolex');
    expect(r.status).toBe('error');
  });
});

describe('Watches of Switzerland UK (retailer)', () => {
  it('Rolex 126610LN', () => {
    expect(run(watchesOfSwitzerland, 'wos-126610LN-uk.html', '126610LN', 'UK', 'rolex')).toMatchObject({
      status: 'ok', amountMinor: 950_000, priceText: '£9,500', taxLabel: 'Suggested retail price inclusive of V.A.T.', refSeen: 'M126610LN-0001',
    });
  });

  it('Rolex 126234', () => {
    expect(run(watchesOfSwitzerland, 'wos-126234-uk.html', '126234', 'UK', 'rolex')).toMatchObject({ status: 'ok', amountMinor: 845_000 });
  });

  it('serves the UK market only', () => {
    expect(run(watchesOfSwitzerland, 'wos-126234-uk.html', '126234', 'US', 'rolex').status).toBe('error');
  });
});

describe('adapterFor', () => {
  it('picks the adapter by key or host', () => {
    expect(adapterFor('https://www.cartier.com/en-ch/x')?.key).toBe('cartier');
    expect(adapterFor('https://www.bucherer.com/ch/en/x')?.key).toBe('bucherer');
    expect(adapterFor('https://x.test/', 'breitling')?.key).toBe('breitling');
    expect(adapterFor('https://www.rolex.com/en-ch/x')).toBeNull();
  });
});

// Unit 7: Swatch Group storefronts. Expected figures match the 6 November prices
// in docs/plans/u5-reference-candidates.csv; pages fetched again on 9 November.
import { grandSeiko } from '../src/adapters/grand-seiko.ts';
import { oris } from '../src/adapters/oris.ts';
import { longines } from '../src/adapters/longines.ts';
import { omega } from '../src/adapters/omega.ts';
import { rado } from '../src/adapters/rado.ts';
import { tissot } from '../src/adapters/tissot.ts';

describe('Longines', () => {
  it.each([
    ['CH', 95_000, 'CHF 950.00'],
    ['FR', 105_000, '1,050.00 €'],
    ['UK', 90_000, '£900.00'],
    ['US', 110_000, '$1,100.00'],
  ] as const)('L2.286.4.52.6 %s', (market, minor, text) => {
    const r = run(longines, `longines-L22864526-${market.toLowerCase()}.html`, 'L2.286.4.52.6', market);
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, currency: MARKET_CURRENCY[market], taxLabel: null, refSeen: 'L2.286.4.52.6' });
    expect(r.priceText).toBeTruthy();
    expect(text).toBeTruthy();
  });
  it('refuses another reference and a wrong-market currency', () => {
    expect(run(longines, 'longines-L22864526-ch.html', 'L2.142.4.70.6', 'CH').status).toBe('error');
    expect(run(longines, 'longines-L22864526-fr.html', 'L2.286.4.52.6', 'CH').message).toMatch(/currency EUR/);
  });
});

describe('Tissot', () => {
  it.each([
    ['CH', 28_500],
    ['US', 35_000],
  ] as const)('T150.410.11.041.00 %s', (market, minor) => {
    const r = run(tissot, `tissot-T1504101104100-${market.toLowerCase()}.html`, 'T150.410.11.041.00', market);
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, taxLabel: null });
  });
  it('refuses another reference', () => {
    expect(run(tissot, 'tissot-T1504101104100-ch.html', 'T150.410.16.031.00', 'CH').status).toBe('error');
  });
});

describe('Rado', () => {
  it.each([
    ['CH', 210_000],
    ['US', 250_000],
  ] as const)('R32505313 %s', (market, minor) => {
    const r = run(rado, `rado-R32505313-${market.toLowerCase()}.html`, 'R32505313', market);
    expect(r).toMatchObject({ status: 'ok', amountMinor: minor, refSeen: 'R32505313' });
  });
  it('refuses another reference and the wrong currency', () => {
    expect(run(rado, 'rado-R32505313-ch.html', 'R32505314', 'CH').status).toBe('error');
    expect(run(rado, 'rado-R32505313-us.html', 'R32505313', 'CH').message).toMatch(/currency USD/);
  });
});

describe('Omega (CH only)', () => {
  it('310.30.42.50.01.001 CH takes the main offer, not an addOn variant', () => {
    const r = run(omega, 'omega-31030425001001-ch.html', '310.30.42.50.01.001', 'CH');
    expect(r).toMatchObject({ status: 'ok', amountMinor: 660_000, taxLabel: null, refSeen: '310.30.42.50.01.001' });
  });
  it('does not read other markets', () => {
    const r = run(omega, 'omega-31030425001001-ch.html', '310.30.42.50.01.001', 'FR');
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/CH only/);
  });
  it('refuses an addOn reference (page is for another watch)', () => {
    expect(run(omega, 'omega-31030425001001-ch.html', '310.30.42.50.04.001', 'CH').status).toBe('error');
  });
});

describe('Oris', () => {
  const REF = '01 733 7707 4053-07 8 20 18';
  it('prices CH and US from the stage block, not the strap carousel', () => {
    expect(run(oris, 'oris-0173377074053-ch.html', REF, 'CH')).toMatchObject({ status: 'ok', amountMinor: 245_000, priceText: "CHF 2'450.00", taxLabel: null, refSeen: REF });
    expect(run(oris, 'oris-0173377074053-us.html', REF, 'US')).toMatchObject({ status: 'ok', amountMinor: 290_000 });
  });
  it('4064: unavailable in CH (not available online, never price on request), 2,400 USD in the US', () => {
    const na = run(oris, 'oris-0173377074064-ch.html', '01 733 7707 4064-07 8 20 18', 'CH');
    expect(na).toMatchObject({ status: 'unavailable', amountMinor: null, message: 'not available online' });
    expect(na.priceText).toMatch(/nicht verfügbar/);
    expect(run(oris, 'oris-0173377074064-us.html', '01 733 7707 4064-07 8 20 18', 'US')).toMatchObject({ status: 'ok', amountMinor: 240_000 });
  });
  it('refuses another reference and the wrong currency', () => {
    expect(run(oris, 'oris-0173377074053-ch.html', '01 733 7707 4064-07 8 20 18', 'CH').status).toBe('error');
    expect(run(oris, 'oris-0173377074053-us.html', REF, 'CH').message).toMatch(/currency USD/);
  });
});

describe('Grand Seiko', () => {
  it('SBGX363 CH and US', () => {
    expect(run(grandSeiko, 'gs-sbgx363-ch.html', 'SBGX363', 'CH')).toMatchObject({ status: 'ok', amountMinor: 370_000, taxLabel: null, refSeen: 'SBGX363' });
    expect(run(grandSeiko, 'gs-sbgx363-us.html', 'SBGX363', 'US')).toMatchObject({ status: 'ok', amountMinor: 360_000 });
  });
  it('SBGD201: five-figure CH price; boutique-only US page is price on request', () => {
    expect(run(grandSeiko, 'gs-sbgd201-ch.html', 'SBGD201', 'CH')).toMatchObject({ status: 'ok', amountMinor: 6_310_000 });
    expect(run(grandSeiko, 'gs-sbgd201-us.html', 'SBGD201', 'US')).toMatchObject({ status: 'price_on_request', amountMinor: null });
  });
  it('refuses another reference, the wrong currency and a page without a header', () => {
    expect(run(grandSeiko, 'gs-sbgx363-ch.html', 'SBGX365', 'CH').status).toBe('error');
    expect(run(grandSeiko, 'gs-sbgx363-us.html', 'SBGX363', 'CH').message).toMatch(/currency USD/);
    const r = grandSeiko.parse('<html><body>maintenance</body></html>', { refCode: 'SBGX363', brandSlug: 'grand-seiko', url: 'x' }, 'CH', 'CHF');
    expect(r.status).toBe('error');
  });
});
