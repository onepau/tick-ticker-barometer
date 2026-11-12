import { readFileSync } from 'node:fs';
import { freshPriceDb, type TestDb } from '../../../packages/shared/tests/d1-shim.ts';
import { buildReferencesSql } from '../scripts/references-sql.ts';

export const BRANDS = ['omega', 'cartier', 'longines', 'tissot', 'breitling', 'rado', 'oris', 'grand-seiko', 'rolex', 'panerai'];

export const CSV = readFileSync(new URL('../../../docs/plans/u5-reference-candidates.csv', import.meta.url), 'utf8');

/** Migrations 0005–0008, the brands the CSV needs, and the CSV import. */
export function seededDb(): TestDb {
  const t = freshPriceDb();
  for (const [i, slug] of BRANDS.entries()) {
    t.raw.prepare(`INSERT INTO brands (id, slug, name) VALUES (?, ?, ?)`).run(i + 1, slug, slug);
  }
  t.raw.exec(buildReferencesSql(CSV).sql);
  return t;
}

/** In-memory R2 with the two calls the Worker makes. */
export function fakeR2() {
  const objects = new Map<string, { body: string; meta: Record<string, string> }>();
  const bucket = {
    async put(key: string, value: string, opts?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { body: value, meta: opts?.customMetadata ?? {} });
      return {};
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { text: async () => o.body } : null;
    },
  } as unknown as R2Bucket;
  return { bucket, objects };
}

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** A fake network serving fixtures by URL, with a clock that advances on sleep. */
export function fixtureNet(pages: Record<string, string>, robots = 'User-agent: *\nAllow: /\n') {
  let clock = 1_700_000_000_000;
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response(robots);
    const page = pages[url];
    return page ? new Response(page) : new Response('nope', { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    opts: { fetch: fetchFn, sleep: async (ms: number) => void (clock += ms), now: () => clock },
  };
}
