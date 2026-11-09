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
