import { beforeEach, describe, expect, it } from "vitest";
import { createRegistryApp } from "../src/app.ts";
import { createTestD1, type TestD1 } from "./d1.ts";
import { seedPrices } from "./price-seed.ts";

const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as unknown as ExecutionContext;
const get = (t: TestD1, path: string, env: Record<string, string | undefined> = {}) =>
  createRegistryApp().request(path, {}, { DB: t.db, ...env }, ctx());
const ON = { PRICES_PUBLIC: "1" };
const text = async (t: TestD1, path: string, env: Record<string, string | undefined> = ON) => (await get(t, path, env)).text();

describe("price hub pages", () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
    seedPrices(t);
  });

  describe("flag off", () => {
    it("every price route is a 404 and the brand page shows nothing about prices", async () => {
      for (const env of [{}, { PRICES_PUBLIC: "0" }]) {
        for (const path of ["/prices", "/prices/methodology", "/prices/increases-2027", "/prices/omega/310-30-42-50-01-001"]) {
          expect((await get(t, path, env)).status, path).toBe(404);
        }
        const brand = await text(t, "/brand/omega", env);
        expect(brand).not.toMatch(/List prices|href="\/prices|>Prices</);
      }
    });
  });

  describe("brand page price section", () => {
    it("shows the latest change per market and links tracked references", async () => {
      const html = await text(t, "/brand/omega");
      expect(html).toContain('<h2>List prices</h2>');
      expect(html).toContain('href="/prices/omega/310-30-42-50-01-001"');
      expect(html).toContain("+3.0%"); // CH: 7,000 to 7,210
      expect(html).toContain("Switzerland");
      expect(html).toContain('href="/prices"'); // masthead link
      // A reference without a public price is not listed.
      expect(html).not.toContain("omega/no-prices");
    });

    it("says so when nothing has changed yet, and is absent for a brand that is not public", async () => {
      expect(await text(t, "/brand/rolex")).toContain("No list-price change has been captured");
      expect(await text(t, "/brand/tissot")).not.toContain("List prices");
    });
  });

  describe("/prices index", () => {
    it("lists public brands and tracked references, not private ones", async () => {
      const html = await text(t, "/prices");
      expect(html).toContain('href="/prices/omega/310-30-42-50-01-001"');
      expect(html).toContain('href="/prices/rolex/126610ln"');
      expect(html).not.toContain("tissot/t137-407");
      expect(html).not.toContain("omega/no-prices");
      expect(html).toContain('href="/prices/increases-2027"');
      expect(html).toContain('href="/prices/methodology"');
    });
  });

  describe("/prices/methodology", () => {
    it("covers the required topics, with the CC BY licence and the Wikidata credit", async () => {
      const html = await text(t, "/prices/methodology");
      for (const s of [
        "Sources", "Markets, currencies and tax", "How often prices are checked", "Currency conversion",
        "Price on request", "not available online", "Corrections", "Wikidata", "CC0", "CC BY 4.0",
        "1 December 2026", "29 December 2026", "1 to 20 January 2027", "European Central Bank", "retailer rule",
      ])
        expect(html.toLowerCase(), s).toContain(s.toLowerCase());
    });
  });

  describe("/prices/increases-2027", () => {
    beforeEach(() => {
      // Baseline 1 December, increases captured in January: Omega CH +3%, FR +10%; Rolex CH +5%.
      t.raw.exec(`
        INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method) VALUES
          (1,'FR',677000,'EUR','ok','2026-12-01T10:00:00Z','brand:www.omegawatches.com','fetch'),
          (2,'CH',1020000,'CHF','ok','2026-12-02T10:00:00Z','retailer:www.bucherer.com','fetch'),
          (2,'CH',1071000,'CHF','ok','2027-01-04T10:00:00Z','retailer:www.bucherer.com','fetch');
      `);
    });

    it("lists every change, biggest first by default, with the intro from D1", async () => {
      const html = await text(t, "/prices/increases-2027");
      expect(html).toContain("Watch price increases in 2027");
      expect(html).toContain("Watch brands usually raise their list prices"); // seeded intro
      const order = [...html.matchAll(/<td class="num (?:up|down)">([+-][\d.]+%)<\/td>/g)].map((m) => m[1]);
      expect(order).toEqual(["+10.0%", "+5.0%", "+3.0%"]);
      expect(html).toContain("Switzerland");
      expect(html).toContain("First seen");
      expect(html).not.toContain('content="noindex'); // default order is indexable
    });

    it("sorts by brand, market or percentage through the query string, server-side", async () => {
      // The summary tables also match, so look at the last <tbody> (the main table) only.
      const mainFirst = async (q: string) => {
        const h = await text(t, `/prices/increases-2027?${q}`);
        const body = h.slice(h.lastIndexOf("<tbody>"));
        return /<a href="\/brand\/([a-z-]+)"/.exec(body)![1];
      };
      expect(await mainFirst("sort=brand&dir=asc")).toBe("omega");
      expect(await mainFirst("sort=brand&dir=desc")).toBe("rolex");
      expect(await mainFirst("sort=pct&dir=asc")).toBe("omega"); // +3.0% smallest
      const byMarket = await text(t, "/prices/increases-2027?sort=market&dir=asc");
      const markets = [...byMarket.slice(byMarket.lastIndexOf("<tbody>")).matchAll(/<td>(Switzerland|France)<\/td>/g)].map((m) => m[1]);
      expect(markets).toEqual(["Switzerland", "Switzerland", "France"]);
      // Sorted variants are noindex with the base canonical; junk parameters fall back to the default.
      expect(byMarket).toContain('content="noindex,follow"');
      expect(byMarket).toContain('rel="canonical" href="https://prices.tick-ticker.com/prices/increases-2027"');
      const junk = await text(t, "/prices/increases-2027?sort=evil&dir=sideways");
      expect(junk).toContain("+10.0%");
    });

    it("header links are plain crawlable anchors", async () => {
      const html = await text(t, "/prices/increases-2027");
      expect(html).toContain('<a href="/prices/increases-2027?sort=brand&amp;dir=asc">Brand</a>');
      expect(html).toContain('aria-sort="descending"');
    });

    it("the intro is editable in D1 and escaped", async () => {
      t.raw.exec(`UPDATE site_text SET body = 'New <b>intro</b>.' || char(10) || char(10) || 'Second paragraph.' WHERE key = 'increases-2027-intro'`);
      const html = await text(t, "/prices/increases-2027");
      expect(html).toContain("<p>New &lt;b&gt;intro&lt;/b&gt;.</p>");
      expect(html).toContain("<p>Second paragraph.</p>");
      expect(html).not.toContain("Watch brands usually raise");
    });

    it("falls back to a default intro when the text row (or table) is missing", async () => {
      t.raw.exec(`DROP TABLE site_text`);
      const res = await get(t, "/prices/increases-2027", ON);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("every official list price that has changed since our December 2026 baseline");
    });

    it("with no changes yet: still renders, says so, and stays out of the index", async () => {
      const empty = createTestD1();
      empty.raw.exec(`
        INSERT INTO brands (id, slug, name, prices_public) VALUES (1, 'omega', 'Omega', 1);
        INSERT INTO watch_references (id, brand_id, slug, ref_code) VALUES (1, 1, 'omega/a', 'A');
        INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method)
          VALUES (1, 'CH', 100000, 'CHF', 'ok', '2026-12-01T10:00:00Z', 'brand:www.omegawatches.com', 'fetch');`);
      const html = await text(empty, "/prices/increases-2027");
      expect(html).toContain("No list-price change has been captured");
      expect(html).toContain('content="noindex,follow"');
    });

    it("unknown reports are 404", async () => {
      expect((await get(t, "/prices/increases-2099", ON)).status).toBe(404);
      expect((await get(t, "/prices/nonsense", ON)).status).toBe(404);
    });
  });
});
