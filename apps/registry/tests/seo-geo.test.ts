import { beforeEach, describe, expect, it } from "vitest";
import { createRegistryApp } from "../src/app.ts";
import { createTestD1, type TestD1 } from "./d1.ts";
import { seedPrices } from "./price-seed.ts";

const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as unknown as ExecutionContext;
const get = (t: TestD1, path: string, env: Record<string, string | undefined> = {}) =>
  createRegistryApp().request(path, {}, { DB: t.db, ...env }, ctx());
const ON = { PRICES_PUBLIC: "1" };
const json = (r: Response): Promise<any> => r.json() as Promise<any>;

describe("sitemap", () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
    seedPrices(t);
  });

  it("flag off: no price URLs at all", async () => {
    const xml = await (await get(t, "/sitemap.xml")).text();
    expect(xml).not.toContain("tick-ticker.com/prices");
  });

  it("flag on: price pages with lastmod from the latest snapshot, only public references", async () => {
    const xml = await (await get(t, "/sitemap.xml", ON)).text();
    expect(xml).toContain("<loc>https://prices.tick-ticker.com/prices</loc><lastmod>2027-01-02</lastmod>"); // the 3 January error snapshot is not a publishable check
    expect(xml).toContain("<loc>https://prices.tick-ticker.com/prices/methodology</loc>");
    expect(xml).toContain("<loc>https://prices.tick-ticker.com/prices/omega/310-30-42-50-01-001</loc><lastmod>2027-01-02</lastmod>");
    expect(xml).toContain("<loc>https://prices.tick-ticker.com/prices/rolex/126610ln</loc><lastmod>2026-12-01</lastmod>");
    expect(xml).not.toContain("tissot/t137-407");
    expect(xml).not.toContain("omega/no-prices");
  });

  it("the increases report is listed only once it has changes", async () => {
    // Omega CH moved 7,000 to 7,210 in the seed.
    expect(await (await get(t, "/sitemap.xml", ON)).text()).toContain("/prices/increases-2027</loc>");
    const empty = createTestD1();
    empty.raw.exec(`
      INSERT INTO brands (id, slug, name, prices_public) VALUES (1, 'omega', 'Omega', 1);
      INSERT INTO watch_references (id, brand_id, slug, ref_code) VALUES (1, 1, 'omega/a', 'A');
      INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method)
        VALUES (1, 'CH', 100000, 'CHF', 'ok', '2026-12-01T10:00:00Z', 'brand:www.omegawatches.com', 'fetch');`);
    const xml = await (await get(empty, "/sitemap.xml", ON)).text();
    expect(xml).toContain("/prices/omega/a</loc>");
    expect(xml).not.toContain("increases-2027");
  });
});

describe("registry feed", () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
    seedPrices(t);
  });

  it("flag off: price_url is null for every brand and references.json is a 404", async () => {
    const body = await json(await get(t, "/api/registry/v1/brands.json"));
    expect(body.items.every((b: { price_url: unknown }) => b.price_url === null)).toBe(true);
    expect((await get(t, "/api/registry/v1/references.json")).status).toBe(404);
    expect((await json(await get(t, "/api/registry/v1"))).endpoints).not.toContain("/api/registry/v1/references.json");
  });

  it("flag on: price_url for brands with public prices only", async () => {
    const body = await json(await get(t, "/api/registry/v1/brands.json", ON));
    const by = Object.fromEntries(body.items.map((b: { slug: string; price_url: string | null }) => [b.slug, b.price_url]));
    expect(by.omega).toBe("https://prices.tick-ticker.com/brand/omega#prices");
    expect(by.rolex).toBe("https://prices.tick-ticker.com/brand/rolex#prices");
    expect(by.tissot).toBeNull();
  });

  it("flag on: references.json carries the reference price page URLs", async () => {
    const res = await get(t, "/api/registry/v1/references.json", ON);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.count).toBe(2);
    expect(body.items.find((r: { ref_code: string }) => r.ref_code === "310.30.42.50.01.001")).toMatchObject({
      slug: "omega/310-30-42-50-01-001",
      brand: { slug: "omega", name: "Omega" },
      markets: ["CH", "FR", "US"], // markets with a listed price (UK is price on request)
      url: "https://prices.tick-ticker.com/prices/omega/310-30-42-50-01-001",
    });
    expect((await json(await get(t, "/api/registry/v1", ON))).endpoints).toContain("/api/registry/v1/references.json");
  });
});

describe("llms.txt", () => {
  it("always describes the registry; the price section appears only with the flag on", async () => {
    const t = createTestD1();
    const off = await (await get(t, "/llms.txt")).text();
    expect(off).toMatch(/^# tick-ticker/);
    expect(off).toContain("/api/registry/v1/brands.json");
    expect(off).toContain("/brands");
    expect(off).not.toMatch(/prices\/|List prices|dataset\.csv/);
    const on = await (await get(t, "/llms.txt", ON)).text();
    for (const s of ["## List prices", "/prices/methodology", "/prices/increases-2027", "/api/registry/v1/references.json"])
      expect(on).toContain(s);
    expect((await get(t, "/llms.txt")).headers.get("content-type")).toMatch(/text\/plain/);
  });
});

describe("dataset CSV", () => {
  it("is not served: the route is gone, flag on or off", async () => {
    const t = createTestD1();
    seedPrices(t);
    expect((await get(t, "/prices/dataset.csv", ON)).status).toBe(404);
    expect((await get(t, "/prices/dataset.csv")).status).toBe(404);
  });
});

describe("every price page renders fully server-side", () => {
  it("content is in the HTML with all scripts removed; only JSON-LD, the chart data and Chart.js are scripts", async () => {
    const t = createTestD1();
    seedPrices(t);
    t.raw.exec(`INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method)
      VALUES (2,'CH',1071000,'CHF','ok','2027-01-04T10:00:00Z','retailer:www.bucherer.com','fetch')`);
    const pages: [string, string][] = [
      ["/brand/omega", "List prices"],
      ["/prices", "Watch list prices by brand and reference"],
      ["/prices/methodology", "How the list prices are collected"],
      ["/prices/increases-2027", "Watch price increases in 2027"],
      ["/prices/omega/310-30-42-50-01-001", "Current list price by market"],
      ["/prices/rolex/126610ln", "Price history"],
    ];
    for (const [path, heading] of pages) {
      const html = await (await get(t, path, ON)).text();
      const stripped = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
      expect(stripped, path).toContain(heading);
      expect(stripped, path).toMatch(/<h1\b/);
      // No inline event handlers, and any script is one of the known kinds.
      expect(html, path).not.toMatch(/\son[a-z]+=/i);
      for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
        expect(m[1], path).toMatch(/application\/ld\+json|application\/json|chart\.umd\.min\.js|^$/);
      }
    }
    // The reference page's numbers survive without the script.
    const ref = (await (await get(t, "/prices/omega/310-30-42-50-01-001", ON)).text()).replace(/<script\b[\s\S]*?<\/script>/g, "");
    for (const s of ["CHF 7,210", "EUR 7,450", "Regional comparison in Swiss francs", "+3.0%"]) expect(ref).toContain(s);
    // The increases table is in the HTML in default and sorted orders alike.
    const inc = (await (await get(t, "/prices/increases-2027?sort=market&dir=asc", ON)).text()).replace(/<script\b[\s\S]*?<\/script>/g, "");
    expect(inc).toContain("<tbody>");
    expect(inc).toContain("Omega");
  });
});
