import { describe, expect, it } from 'vitest';
import { hasManualBrandCapture, listUnconfirmedRetailerPrices } from '@baromontres/shared';
import { createApp, tokenOk } from '../src/app.ts';
import { bookmarkletHref, capturePage } from '../src/bookmarklet.ts';
import { handleCapture, marketFromUrl } from '../src/capture.ts';
import { fakeR2, seededDb } from './helpers.ts';

const ROLEX_SUB = 'https://www.rolex.com/en-ch/watches/submariner/m126610ln-0001';
const HTML = '<html><head><title>Submariner Date</title></head><body><p>CHF 10,150</p></body></html>';
const base = { url: ROLEX_SUB, html: HTML, ref: '126610LN', price_text: 'CHF 10’150.–', tax_text: 'Suggested retail price including VAT' };

describe('marketFromUrl', () => {
  it.each([
    [ROLEX_SUB, 'CH'],
    ['https://www.rolex.com/fr-ch/montres/m126000-0001', 'CH'],
    ['https://www.rolex.com/en-gb/watches/m126000-0001', 'UK'],
    ['https://www.rolex.com/en-us/watches/m126000-0001', 'US'],
    ['https://www.panerai.com/ch/en/collections/watch-collection/luminor/pam01707-luminor-marina.html', 'CH'],
    ['https://www.panerai.com/fr/fr/collections/x.html', 'FR'],
    ['https://www.rolex.com/watches/m126000-0001', null],
  ])('%s → %s', (url, market) => expect(marketFromUrl(url)).toBe(market));
});

describe('handleCapture', () => {
  it('stores a manual brand capture with the page as evidence and unlocks retailer prices', async () => {
    const t = seededDb();
    const r2 = fakeR2();
    const r = await handleCapture(t.d1, r2.bucket, base, new Date('2026-11-20T10:00:00Z'));
    expect(r).toMatchObject({ ok: true, status: 'ok', reference: 'rolex/126610ln', market: 'CH', amount_minor: 1_015_000, currency: 'CHF', created: false });
    if (!r.ok) throw new Error('expected ok');
    expect(r.evidence_key).toBe(`runs/${r.run_id}/rolex/126610ln/CH--brand-www.rolex.com.html`);
    expect(r2.objects.get(r.evidence_key)!.body).toContain(HTML);
    const snap = t.raw.prepare(`SELECT method, source, status, tax_label FROM price_snapshots`).get();
    expect(snap).toEqual({ method: 'manual', source: 'brand:www.rolex.com', status: 'ok', tax_label: 'Suggested retail price including VAT' });
    expect(t.raw.prepare(`SELECT method, source FROM price_sources WHERE method = 'manual'`).get()).toEqual({ method: 'manual', source: 'brand:www.rolex.com' });
    const id = (t.raw.prepare(`SELECT id FROM watch_references WHERE ref_code = '126610LN'`).get() as { id: number }).id;
    expect(await hasManualBrandCapture(t.d1, id)).toBe(true);
    expect(await listUnconfirmedRetailerPrices(t.d1)).toEqual([]);
  });

  it('matches the rolex.com form of the reference', async () => {
    const r = await handleCapture(seededDb().d1, fakeR2().bucket, { ...base, ref: 'M126610LN-0001' });
    expect(r).toMatchObject({ ok: true, reference: 'rolex/126610ln' });
  });

  it('rejects a reference not in watch_references unless create=1 with brand and name', async () => {
    const t = seededDb();
    const page = 'https://www.panerai.com/ch/en/collections/watch-collection/luminor/pam01707-luminor-marina.html';
    const p = { ...base, url: page, ref: 'PAM01707', price_text: 'CHF 9,400', tax_text: null };
    expect(await handleCapture(t.d1, fakeR2().bucket, p)).toMatchObject({ ok: false, status: 404 });
    expect(await handleCapture(t.d1, fakeR2().bucket, { ...p, create: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await handleCapture(t.d1, fakeR2().bucket, { ...p, create: 1, brand: 'rolex', name: 'x' })).toMatchObject({ ok: false, status: 400 });
    const r = await handleCapture(t.d1, fakeR2().bucket, { ...p, create: '1', brand: 'panerai', name: 'Luminor Marina', family: 'Luminor' });
    expect(r).toMatchObject({ ok: true, created: true, reference: 'panerai/pam01707', amount_minor: 940_000 });
    expect(t.raw.prepare(`SELECT name, family FROM watch_references WHERE ref_code = 'PAM01707'`).get()).toEqual({ name: 'Luminor Marina', family: 'Luminor' });
  });

  it('accepts price on request and refuses a currency from another market', async () => {
    const t = seededDb();
    expect(await handleCapture(t.d1, fakeR2().bucket, { ...base, price_text: 'Price on request' })).toMatchObject({ ok: true, status: 'price_on_request', amount_minor: null });
    expect(await handleCapture(t.d1, fakeR2().bucket, { ...base, price_text: '€11,000' })).toMatchObject({ ok: false, status: 422 });
  });

  it('refuses sites other than the manual-capture brands', async () => {
    const r = await handleCapture(seededDb().d1, fakeR2().bucket, { ...base, url: 'https://www.bucherer.com/ch/en/rolex/x.html' });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe('HTTP', () => {
  const TOKEN = 'capture-token-for-tests-0123456789';
  const env = () => {
    const t = seededDb();
    return { t, env: { DB: t.d1, EVIDENCE: fakeR2().bucket, CAPTURE_TOKEN: TOKEN, RUN_TOKEN: 'run-token-for-tests-0123456789', PUBLIC_ORIGIN: 'https://prices.example.com' } };
  };
  const post = (path: string, body: unknown, token?: string) =>
    new Request(`https://prices.example.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('needs the token for capture and run', async () => {
    const app = createApp();
    const { env: e } = env();
    expect((await app.fetch(post('/api/capture', base), e)).status).toBe(401);
    expect((await app.fetch(post('/api/capture', base, 'wrong'), e)).status).toBe(401);
    expect((await app.fetch(post('/api/run', {}, TOKEN), e)).status).toBe(401);
    const ok = await app.fetch(post('/api/capture', base, TOKEN), e);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ ok: true, reference: 'rolex/126610ln' });
  });

  it('serves the validation report only with the run token', async () => {
    const app = createApp();
    const { t, env: e } = env();
    const get = (path: string, token?: string) =>
      new Request(`https://prices.example.com${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect((await app.fetch(get('/api/report'), e)).status).toBe(401);
    expect((await app.fetch(get('/api/report', TOKEN), e)).status).toBe(401); // the capture token is not the run token
    expect((await app.fetch(get('/api/report?run=abc', 'run-token-for-tests-0123456789'), e)).status).toBe(400);
    const empty = await app.fetch(get('/api/report', 'run-token-for-tests-0123456789'), e);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ runs: [], report: null, open_review_flags: [] });
    t.raw.exec(`INSERT INTO capture_runs (id, started_at, "trigger") VALUES (7, '2026-12-15T04:00:00Z', 'cron')`);
    t.raw.exec(`INSERT INTO run_reports (run_id, created_at, report) VALUES (7, '2026-12-15T04:05:00Z', '{"run_id":7,"coverage":{"share":0.9}}')`);
    const res = await app.fetch(get('/api/report', 'run-token-for-tests-0123456789'), e);
    expect(await res.json()).toMatchObject({ report: { run_id: 7, coverage: { share: 0.9 } }, runs: [{ id: 7 }] });
  });

  it('refuses everything when the secret is unset or short', () => {
    expect(tokenOk('Bearer x', undefined)).toBe(false);
    expect(tokenOk('Bearer short', 'short')).toBe(false);
    expect(tokenOk('Bearer abcdefghijklmnopq', 'abcdefghijklmnopq')).toBe(true);
  });

  it('serves the capture page with the bookmarklet, noindex', async () => {
    const res = await createApp().fetch(new Request('https://prices.example.com/capture'), env().env);
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    const html = await res.text();
    expect(html).toContain('javascript:');
    expect(html).toContain('/api/capture');
  });
});

describe('bookmarklet', () => {
  it('targets the configured origin and carries no token', () => {
    const href = bookmarkletHref('https://prices.example.com');
    const code = decodeURIComponent(href.slice('javascript:'.length));
    expect(code).toContain('"https://prices.example.com"');
    expect(code).not.toMatch(/token|authorization/i);
    expect(code).not.toMatch(/setInterval|fetch\(/); // never runs on its own, never requests pages
    expect(() => new Function(code)).not.toThrow(); // valid JavaScript
  });

  it('refuses a non-https origin', () => {
    expect(() => bookmarkletHref('http://prices.example.com')).toThrow();
    expect(capturePage('https://prices.example.com')).toContain('tick-ticker capture');
  });
});
