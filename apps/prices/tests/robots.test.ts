import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../src/robots.ts';
import { PRODUCT_TOKEN } from '../src/polite-fetch.ts';

// Shapes taken from the robots.txt files recorded in u5-price-search-log.md.
const ROLEX = `User-agent: *
Crawl-delay: 2
Disallow: /search?
Disallow: /wishlist
Disallow: /*/rolex-dealers/*/buy-a-rolex-watch$
`;
const BREITLING = `User-agent: *
Disallow: /fr-en/
Disallow: /gb-zh/
Disallow: /*?interest=
Disallow: /*/my-account/*/
Content-Signal: ai-train=no, search=yes, ai-input=yes
`;
const GS = `User-agent: *
Allow: /en-*
Allow: /fr-FR
Allow: /$
Disallow: /

User-agent: AhrefsBot
Crawl-delay: 10
`;

describe('robots.txt', () => {
  it('reads Crawl-delay and wildcard rules for *', () => {
    const r = parseRobots(ROLEX, PRODUCT_TOKEN);
    expect(r.crawlDelaySec).toBe(2);
    expect(isAllowed(r, '/en-ch/watches/submariner/m126610ln-0001')).toBe(true);
    expect(isAllowed(r, '/search?q=x')).toBe(false);
    expect(isAllowed(r, '/fr/rolex-dealers/geneva/buy-a-rolex-watch')).toBe(false);
    expect(isAllowed(r, '/fr/rolex-dealers/geneva/buy-a-rolex-watch/x')).toBe(true);
  });

  it('allows the Breitling locales used and blocks the others', () => {
    const r = parseRobots(BREITLING, PRODUCT_TOKEN);
    expect(isAllowed(r, '/ch-en/watches/navitimer/x/AB0138211B1A1/')).toBe(true);
    expect(isAllowed(r, '/fr-en/watches/navitimer/')).toBe(false);
    expect(isAllowed(r, '/ch-en/x?interest=1')).toBe(false);
  });

  it('longest match wins and Allow wins a tie; other bots’ delays do not apply', () => {
    const r = parseRobots(GS, PRODUCT_TOKEN);
    expect(r.crawlDelaySec).toBeNull();
    expect(isAllowed(r, '/en-gb/collections/sbga211')).toBe(true);
    expect(isAllowed(r, '/de-DE/collections/sbga211')).toBe(false);
    expect(isAllowed(r, '/')).toBe(true);
  });

  it('prefers a group naming our product token', () => {
    const r = parseRobots(`User-agent: *\nDisallow:\n\nUser-agent: tick-ticker-prices\nDisallow: /\n`, PRODUCT_TOKEN);
    expect(r.group).toBe(PRODUCT_TOKEN);
    expect(isAllowed(r, '/anything')).toBe(false);
  });
});
