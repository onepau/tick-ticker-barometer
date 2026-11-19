import { describe, expect, it } from 'vitest';
import { amountMinorFromJson, formatMinor, parsePrice } from '../src/parse.ts';

const price = (text: string, expected?: Parameters<typeof parsePrice>[1]) => {
  const p = parsePrice(text, expected);
  return p?.kind === 'price' ? { amountMinor: p.amountMinor, currency: p.currency } : p?.kind ?? null;
};

describe('parsePrice: the locale formats in the plan', () => {
  it('Swiss apostrophe groups and ".–"', () => {
    expect(price('CHF 9’900.–')).toEqual({ amountMinor: 990_000, currency: 'CHF' });
    expect(price("CHF 9'900.-")).toEqual({ amountMinor: 990_000, currency: 'CHF' });
    expect(price('CHF 12’345.50')).toEqual({ amountMinor: 1_234_550, currency: 'CHF' });
  });

  it('French no-break space groups with the symbol after', () => {
    expect(price('9 900 €')).toEqual({ amountMinor: 990_000, currency: 'EUR' });
    expect(price('9 900 €')).toEqual({ amountMinor: 990_000, currency: 'EUR' });
    expect(price('9 900,50 €')).toEqual({ amountMinor: 990_050, currency: 'EUR' });
  });

  it('pounds and dollars with comma groups', () => {
    expect(price('£9,900')).toEqual({ amountMinor: 990_000, currency: 'GBP' });
    expect(price('$9,900')).toEqual({ amountMinor: 990_000, currency: 'USD' });
    expect(price('$9,900.00')).toEqual({ amountMinor: 990_000, currency: 'USD' });
    expect(price('US$ 9,900')).toEqual({ amountMinor: 990_000, currency: 'USD' });
  });

  it('price on request', () => {
    expect(price('POR')).toBe('price_on_request');
    expect(price('Price on request')).toBe('price_on_request');
    expect(price('Prix sur demande')).toBe('price_on_request');
    expect(price('Price upon request')).toBe('price_on_request');
  });
});

describe('parsePrice: formats seen on the pilot pages', () => {
  it.each([
    ['CHF 7,000', 700_000, 'CHF'], // Cartier CH JSON-LD
    ['8,300€', 830_000, 'EUR'], // Cartier FR JSON-LD
    ['£7,250', 725_000, 'GBP'], // Cartier UK JSON-LD
    ['9 100 CHF', 910_000, 'CHF'], // Breitling CH
    ['USD 10,700', 1_070_000, 'USD'],
    ['Price CHF 10,150', 1_015_000, 'CHF'], // Bucherer
    ['Price €11,000', 1_100_000, 'EUR'],
    ['9.900 €', 990_000, 'EUR'], // dot groups
    ['10.50 CHF', 1_050, 'CHF'], // dot decimal
    ['GBP2,100.00', 210_000, 'GBP'], // Oris UK, no space
    ['USD2,900.00', 290_000, 'USD'], // Oris US
    ["CHF 2'450.00", 245_000, 'CHF'], // Oris CH
    ['2 450,00 EUR', 245_000, 'EUR'], // Oris FR
    ['695,00 CHF', 69_500, 'CHF'], // Tissot CH
    ['EUR 7 000,00', 700_000, 'EUR'], // Grand Seiko FR
    ['CHF 2’100.00', 210_000, 'CHF'], // Longines CH
  ])('%s', (text, minor, cur) => {
    expect(price(text)).toEqual({ amountMinor: minor, currency: cur });
  });

  it('picks the number next to the currency, not a size or year', () => {
    expect(price('Santos 40 mm, 2026 — CHF 7,000')).toEqual({ amountMinor: 700_000, currency: 'CHF' });
  });

  it('uses the expected currency only when the text has none', () => {
    expect(price('9,900', 'GBP')).toEqual({ amountMinor: 990_000, currency: 'GBP' });
    expect(price('$9,900', 'GBP')).toEqual({ amountMinor: 990_000, currency: 'USD' });
  });

  it('returns null for text without a price', () => {
    expect(parsePrice('Add to bag')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });
});

describe('amountMinorFromJson', () => {
  it('reads numbers and plain decimal strings without float drift', () => {
    expect(amountMinorFromJson(9100)).toBe(910_000);
    expect(amountMinorFromJson('8400.00')).toBe(840_000);
    expect(amountMinorFromJson(19.99)).toBe(1_999);
    expect(amountMinorFromJson('CHF 7,000', 'CHF')).toBe(700_000);
    expect(amountMinorFromJson(0)).toBeNull();
    expect(amountMinorFromJson(null)).toBeNull();
  });

  it('formats minor units for reports', () => {
    expect(formatMinor(990_000, 'CHF')).toBe('CHF 9,900');
    expect(formatMinor(990_050, 'EUR')).toBe('EUR 9,900.50');
  });
});
