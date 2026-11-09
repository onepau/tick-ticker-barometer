import { describe, expect, it } from 'vitest';
import { getLatestPrices, getCaptureRun } from '@baromontres/shared';
import { runCapture } from '../src/run.ts';
import { fakeR2, fixture, fixtureNet, seededDb } from './helpers.ts';

const URLS = {
  cartierCH: 'https://www.cartier.com/en-ch/watches/collections/santos-de-cartier/santos-de-cartier-watch-CRWSSA0029',
  cartierUS: 'https://www.cartier.com/en-us/watches/collections/santos-de-cartier/santos-de-cartier-watch-CRWSSA0029.html',
  breitlingFR: 'https://www.breitling.com/fr-fr/watches/navitimer/navitimer-b01-chronograph-43-my22/AB0138211B1A1/',
  buchererCH: 'https://www.bucherer.com/ch/en/rolex/watches/submariner/1335-897-7.html',
};

describe('runCapture end to end (fixtures, fake network and R2)', () => {
  it('captures Cartier and Breitling with evidence, robots and tax labels', async () => {
    const t = seededDb();
    const r2 = fakeR2();
    const net = fixtureNet({
      [URLS.cartierCH]: fixture('cartier-CRWSSA0029-ch.html'),
      [URLS.cartierUS]: fixture('cartier-CRWSSA0029-us.html'),
      [URLS.breitlingFR]: fixture('breitling-AB0138211B1A1-fr.html'),
    });
    const report = await runCapture(t.d1, r2.bucket, {
      trigger: 'manual',
      filter: { brandSlugs: ['cartier', 'breitling'], referenceIds: refIds(t, ['CRWSSA0029', 'AB0138211B1A1']), markets: ['CH', 'US', 'FR'] },
      fetcher: net.opts,
    });
    expect(report.finished).toBe(true);
    const ok = report.results.filter((x) => x.result.status === 'ok').map((x) => `${x.target.ref_code} ${x.target.market_code} ${x.result.amountMinor}`);
    expect(ok.sort()).toEqual(['AB0138211B1A1 FR 985000', 'CRWSSA0029 CH 700000', 'CRWSSA0029 US 840000']);
    // Pages not served by the fixture network come back 404 → 'unavailable', not guessed.
    expect(report.results.filter((x) => x.result.status === 'unavailable').length).toBe(report.results.length - 3);
    // robots.txt once per domain, before any page on it.
    expect(net.calls.filter((c) => c.endsWith('robots.txt')).sort()).toEqual([
      'https://www.breitling.com/robots.txt', 'https://www.cartier.com/robots.txt',
    ]);
    const latest = await getLatestPrices(t.d1, { okOnly: true });
    expect(latest).toHaveLength(3);
    const ch = latest.find((s) => s.market_code === 'CH')!;
    expect(ch).toMatchObject({ currency: 'CHF', source: 'brand:www.cartier.com', method: 'fetch', tax_label: 'incl. VAT' });
    expect(ch.evidence_key).toBe(`runs/${report.runId}/cartier/crwssa0029/CH.html`);
    const ev = r2.objects.get(ch.evidence_key!)!;
    expect(ev.body).toContain('CHF 7,000');
    expect(ev.body).toContain('tick-ticker-prices/1.0');
    expect(ev.meta.sha256).toBe(ch.content_hash);
    const src = t.raw.prepare(`SELECT robots_ok, tax_label FROM price_sources WHERE source = 'brand:www.cartier.com' AND market_code = 'CH'`).get();
    expect(src).toEqual({ robots_ok: 1, tax_label: 'incl. VAT' });
    expect(JSON.parse((await getCaptureRun(t.d1, report.runId))!.counts!)).toMatchObject({ ok: 3 });
  });

  it('flags a retailer price without a manual brand capture', async () => {
    const t = seededDb();
    const net = fixtureNet({ [URLS.buchererCH]: fixture('bucherer-126610LN-ch.html') });
    const report = await runCapture(t.d1, fakeR2().bucket, {
      trigger: 'manual',
      filter: { brandSlugs: ['rolex'], markets: ['CH'], referenceIds: refIds(t, ['126610LN']) },
      fetcher: net.opts,
    });
    expect(report.results[0]!.result).toMatchObject({ status: 'ok', amountMinor: 1_015_000 });
    expect(report.unconfirmedRetailer).toEqual(['rolex/126610ln CH (retailer:www.bucherer.com)']);
    const countable = t.raw.prepare(`SELECT COUNT(*) AS n FROM price_snapshots_countable`).get();
    expect(countable).toEqual({ n: 0 });
  });

  it('skips pages robots.txt disallows and records the robots result', async () => {
    const t = seededDb();
    const net = fixtureNet({}, 'User-agent: *\nDisallow: /\n');
    const report = await runCapture(t.d1, fakeR2().bucket, {
      trigger: 'manual',
      filter: { brandSlugs: ['cartier'], markets: ['CH'], limit: 2 },
      fetcher: net.opts,
    });
    expect(net.calls).toEqual(['https://www.cartier.com/robots.txt']);
    expect(report.results.every((x) => x.result.status === 'error' && x.result.fetchStatus === 'disallowed')).toBe(true);
  });

  it('cron runs resume across invocations until every page has a snapshot', async () => {
    const t = seededDb();
    const filter = { brandSlugs: ['cartier'], markets: ['CH' as const], referenceIds: refIds(t, ['CRWSSA0029', 'CRWGTA0011', 'CRWSTA0053']) };
    const now = () => new Date('2026-12-01T04:00:00Z');
    const first = await runCapture(t.d1, fakeR2().bucket, { trigger: 'cron', filter, now, fetcher: { ...fixtureNet({}).opts, maxRequests: 2 } });
    expect(first).toMatchObject({ resumed: false, finished: false, attempted: 2, remaining: 2 });
    const second = await runCapture(t.d1, fakeR2().bucket, { trigger: 'cron', filter, now, fetcher: { ...fixtureNet({}).opts, maxRequests: 10 } });
    expect(second).toMatchObject({ runId: first.runId, resumed: true, finished: true, remaining: 0 });
    const third = await runCapture(t.d1, fakeR2().bucket, { trigger: 'cron', filter, now, fetcher: fixtureNet({}).opts });
    expect(third).toMatchObject({ runId: first.runId, attempted: 0, requests: 0 });
    const next = await runCapture(t.d1, fakeR2().bucket, { trigger: 'cron', filter, now: () => new Date('2027-01-01T04:00:00Z'), fetcher: fixtureNet({}).opts });
    expect(next.runId).not.toBe(first.runId);
  });

  it('leaves brands without an adapter out of the run', async () => {
    const t = seededDb();
    // A page on a host no adapter reads (and no explicit adapter key) is left out.
    t.raw.exec(`UPDATE reference_price_urls SET url = replace(url, 'www.omegawatches.com', 'unknown.example.test'); UPDATE price_sources SET adapter_key = 'none' WHERE adapter_key IS NOT NULL`);
    const net = fixtureNet({});
    const report = await runCapture(t.d1, fakeR2().bucket, { trigger: 'manual', filter: { brandSlugs: ['omega'] }, fetcher: net.opts });
    expect(report).toMatchObject({ attempted: 0, remaining: 0 });
    expect(net.calls).toEqual([]);
  });
});

function refIds(t: ReturnType<typeof seededDb>, codes: string[]): number[] {
  return codes.map((c) => (t.raw.prepare(`SELECT id FROM watch_references WHERE ref_code = ?`).get(c) as { id: number }).id);
}
