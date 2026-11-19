import { describe, expect, it } from 'vitest';
import { PoliteFetcher, USER_AGENT } from '../src/polite-fetch.ts';

/** A fake network and clock: records requests and advances time on sleep. */
function harness(routes: Record<string, (n: number) => Response>) {
  let clock = 0;
  const calls: { url: string; at: number; ua: string | null }[] = [];
  const counts = new Map<string, number>();
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const n = (counts.get(url) ?? 0) + 1;
    counts.set(url, n);
    calls.push({ url, at: clock, ua: new Headers(init?.headers).get('user-agent') });
    const route = routes[url];
    return route ? route(n) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  const sleep = async (ms: number) => {
    clock += ms;
  };
  return { fetchFn, sleep, now: () => clock, calls };
}

const ok = (body = '<html>ok</html>') => () => new Response(body, { status: 200 });

describe('PoliteFetcher', () => {
  it('sends the honest user agent, reads robots.txt first and spaces requests ≥3 s', async () => {
    const h = harness({
      'https://a.example/robots.txt': () => new Response('User-agent: *\nDisallow: /private\n'),
      'https://a.example/p1': ok(),
      'https://a.example/p2': ok(),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    const [r1, r2] = await Promise.all([f.get('https://a.example/p1'), f.get('https://a.example/p2')]);
    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    expect(h.calls.map((c) => c.url)).toEqual([
      'https://a.example/robots.txt',
      'https://a.example/p1',
      'https://a.example/p2',
    ]);
    expect(h.calls.every((c) => c.ua === USER_AGENT)).toBe(true);
    expect(USER_AGENT).toMatch(/tick-ticker\.com/);
    expect(USER_AGENT).not.toMatch(/@|Mozilla|Chrome/);
    const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3000);
  });

  it('never goes below 3 s even if asked to', async () => {
    const h = harness({ 'https://a.example/robots.txt': ok(''), 'https://a.example/p': ok() });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now, minDelayMs: 100 });
    await f.get('https://a.example/p');
    expect(h.calls[1]!.at - h.calls[0]!.at).toBe(3000);
  });

  it('respects Crawl-delay when it is longer', async () => {
    const h = harness({
      'https://a.example/robots.txt': () => new Response('User-agent: *\nCrawl-delay: 5\n'),
      'https://a.example/p': ok(),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    await f.get('https://a.example/p');
    expect(h.calls[1]!.at - h.calls[0]!.at).toBe(5000);
  });

  it('does not request paths robots.txt disallows', async () => {
    const h = harness({ 'https://a.example/robots.txt': () => new Response('User-agent: *\nDisallow: /private\n') });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    expect((await f.get('https://a.example/private/x')).status).toBe('disallowed');
    expect(h.calls).toHaveLength(1);
  });

  it('never retries a 403 and stops using that domain', async () => {
    const h = harness({
      'https://a.example/robots.txt': ok(''),
      'https://a.example/p1': () => new Response('denied', { status: 403 }),
      'https://a.example/p2': ok(),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    expect((await f.get('https://a.example/p1')).status).toBe('blocked');
    expect((await f.get('https://a.example/p2')).status).toBe('blocked');
    expect(h.calls.map((c) => c.url)).toEqual(['https://a.example/robots.txt', 'https://a.example/p1']);
  });

  it('treats a 403 on robots.txt as a block', async () => {
    const h = harness({ 'https://a.example/robots.txt': () => new Response('', { status: 403 }) });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    expect((await f.get('https://a.example/p')).status).toBe('blocked');
    expect(h.calls).toHaveLength(1);
  });

  it('backs off on 429 using Retry-After, then succeeds', async () => {
    const h = harness({
      'https://a.example/robots.txt': ok(''),
      'https://a.example/p': (n) =>
        n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '60' } }) : new Response('ok'),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    expect((await f.get('https://a.example/p')).status).toBe('ok');
    expect(h.calls[2]!.at - h.calls[1]!.at).toBeGreaterThanOrEqual(60_000);
  });

  it('gives up after the retries on repeated 429 or 5xx', async () => {
    const h = harness({
      'https://a.example/robots.txt': ok(''),
      'https://a.example/p': () => new Response('', { status: 429 }),
      'https://a.example/q': () => new Response('', { status: 503 }),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now, maxRetries: 2 });
    expect(await f.get('https://a.example/p')).toMatchObject({ status: 'rate_limited', httpStatus: 429 });
    expect(await f.get('https://a.example/q')).toMatchObject({ status: 'error', httpStatus: 503 });
    expect(h.calls.filter((c) => c.url.endsWith('/p'))).toHaveLength(3);
  });

  it('does not wait longer than maxBackoffMs', async () => {
    const h = harness({
      'https://a.example/robots.txt': ok(''),
      'https://a.example/p': () => new Response('', { status: 429, headers: { 'retry-after': '3600' } }),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now, maxBackoffMs: 120_000 });
    expect((await f.get('https://a.example/p')).status).toBe('rate_limited');
    expect(h.calls.filter((c) => c.url.endsWith('/p'))).toHaveLength(1);
  });

  it('stops at the request budget', async () => {
    const h = harness({ 'https://a.example/robots.txt': ok(''), 'https://a.example/p': ok(), 'https://a.example/q': ok() });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now, maxRequests: 2 });
    expect((await f.get('https://a.example/p')).status).toBe('ok');
    expect((await f.get('https://a.example/q')).status).toBe('budget');
    expect(f.requestsMade).toBe(2);
  });

  it('runs different domains independently', async () => {
    const h = harness({
      'https://a.example/robots.txt': ok(''),
      'https://b.example/robots.txt': ok(''),
      'https://a.example/p': ok(),
      'https://b.example/p': ok(),
    });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    await Promise.all([f.get('https://a.example/p'), f.get('https://b.example/p')]);
    expect(h.calls).toHaveLength(4);
  });

  it('maps 404 to not_found and refuses plain http', async () => {
    const h = harness({ 'https://a.example/robots.txt': ok('') });
    const f = new PoliteFetcher({ fetch: h.fetchFn, sleep: h.sleep, now: h.now });
    expect((await f.get('https://a.example/gone')).status).toBe('not_found');
    expect((await f.get('http://a.example/p')).status).toBe('error');
  });
});
