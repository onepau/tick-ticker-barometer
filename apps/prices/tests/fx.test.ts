import { describe, expect, it } from 'vitest';
import { getFxRate } from '@baromontres/shared';
import { ECB_DAILY_URL, fxMarkerKey, inFetchWindow, parseEcbDaily, runFxFetch } from '../src/fx.ts';
import { fakeR2, seededDb } from './helpers.ts';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-12-01'>
      <Cube currency='USD' rate='1.0602'/>
      <Cube currency='JPY' rate='161.5'/>
      <Cube currency='GBP' rate='0.8312'/>
      <Cube currency='CHF' rate='0.9321'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const okFetch = (calls: string[], xml = XML) =>
  (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(xml);
  }) as typeof fetch;

describe('parseEcbDaily', () => {
  it('reads the date and the three stored currencies, ignoring the rest', () => {
    expect(parseEcbDaily(XML)).toEqual({ date: '2026-12-01', rates: { USD: 1.0602, GBP: 0.8312, CHF: 0.9321 } });
  });
  it('returns null when a currency or the date is missing', () => {
    expect(parseEcbDaily(XML.replace(/<Cube currency='CHF'[^>]*>/, ''))).toBeNull();
    expect(parseEcbDaily('<html>maintenance</html>')).toBeNull();
  });
});

describe('inFetchWindow', () => {
  it('opens at 15:30 UTC on weekdays and closes at 20:00', () => {
    expect(inFetchWindow(new Date('2026-12-01T15:29:59Z'))).toBe(false); // Tuesday
    expect(inFetchWindow(new Date('2026-12-01T15:30:00Z'))).toBe(true);
    expect(inFetchWindow(new Date('2026-12-01T19:59:59Z'))).toBe(true);
    expect(inFetchWindow(new Date('2026-12-01T20:00:00Z'))).toBe(false);
  });
  it('is closed at weekends', () => {
    expect(inFetchWindow(new Date('2026-12-05T16:00:00Z'))).toBe(false); // Saturday
    expect(inFetchWindow(new Date('2026-12-06T16:00:00Z'))).toBe(false); // Sunday
  });
});

describe('runFxFetch: once a day', () => {
  const at = (iso: string) => () => new Date(iso);

  it('makes no request outside the window', async () => {
    const t = seededDb();
    const calls: string[] = [];
    const out = await runFxFetch(t.d1, fakeR2().bucket, { now: at('2026-12-01T10:00:00Z'), fetch: okFetch(calls) });
    expect(out).toEqual({ status: 'skipped', reason: 'outside_window' });
    expect(calls).toEqual([]);
  });

  it('fetches once, stores CHF GBP and USD, then skips for the rest of the day', async () => {
    const t = seededDb();
    const r2 = fakeR2();
    const calls: string[] = [];
    const first = await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-01T15:35:00Z'), fetch: okFetch(calls) });
    expect(first).toEqual({ status: 'stored', date: '2026-12-01', stale: false });
    expect(calls).toEqual([ECB_DAILY_URL]);
    expect((await getFxRate(t.d1, 'CHF', '2026-12-01'))?.rate).toBe(0.9321);
    expect((await getFxRate(t.d1, 'USD', '2026-12-01'))?.rate).toBe(1.0602);
    expect(r2.objects.has(fxMarkerKey('2026-12-01'))).toBe(true);

    const second = await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-01T15:40:00Z'), fetch: okFetch(calls) });
    expect(second).toEqual({ status: 'skipped', reason: 'marker' });
    expect(calls).toHaveLength(1);
  });

  it('skips when D1 already has the day, even without a marker', async () => {
    const t = seededDb();
    t.raw.exec(`INSERT INTO fx_rates (date, base, currency, rate) VALUES ('2026-12-01','EUR','CHF',0.93)`);
    const calls: string[] = [];
    const out = await runFxFetch(t.d1, fakeR2().bucket, { now: at('2026-12-01T16:00:00Z'), fetch: okFetch(calls) });
    expect(out).toEqual({ status: 'skipped', reason: 'have_today' });
    expect(calls).toEqual([]);
  });

  it('a TARGET holiday: stores the earlier date once and does not ask again', async () => {
    const t = seededDb();
    const r2 = fakeR2();
    const calls: string[] = [];
    const out = await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-02T16:00:00Z'), fetch: okFetch(calls) });
    expect(out).toEqual({ status: 'stored', date: '2026-12-01', stale: true });
    await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-02T16:05:00Z'), fetch: okFetch(calls) });
    expect(calls).toHaveLength(1);
  });

  it('a failed request leaves no marker, so the next firing retries', async () => {
    const t = seededDb();
    const r2 = fakeR2();
    const failing = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const out = await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-01T16:00:00Z'), fetch: failing });
    expect(out).toEqual({ status: 'failed', reason: 'http 503' });
    expect(r2.objects.size).toBe(0);
    const calls: string[] = [];
    const retry = await runFxFetch(t.d1, r2.bucket, { now: at('2026-12-01T16:05:00Z'), fetch: okFetch(calls) });
    expect(retry.status).toBe('stored');
  });
});
