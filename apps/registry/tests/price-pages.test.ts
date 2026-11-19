import { beforeEach, describe, expect, it } from "vitest";
import { createRegistryApp } from "../src/app.ts";
import { createTestD1, type TestD1 } from "./d1.ts";
import { seedPrices } from "./price-seed.ts";

const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as unknown as ExecutionContext;
const get = (t: TestD1, path: string, env: Record<string, string | undefined> = {}) =>
  createRegistryApp().request(path, {}, { DB: t.db, ...env }, ctx());
const ON = { PRICES_PUBLIC: "1" };

describe("reference price page", () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
    seedPrices(t);
  });

  it("renders prices, tax labels, history, comparison and source, fully server-side", async () => {
    const res = await get(t, "/prices/omega/310-30-42-50-01-001", ON);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1");
    expect(html).toContain("Omega Speedmaster Moonwatch Professional");
    expect(html).toContain("CHF 7,210");
    expect(html).toContain("EUR 7,450");
    expect(html).toContain("including VAT");
    expect(html).toContain("USD 7,000");
    expect(html).toContain("excluding sales tax");
    expect(html).toContain("Price on request");
    expect(html).toContain("Last checked 2027-01-02");
    expect(html).toContain("omegawatches.com (brand site)");
    expect(html).toContain('href="/prices/methodology"');
    // History: first capture and the +3.0% change; unchanged 29 December check is not a row.
    expect(html).toContain("First capture");
    expect(html).toContain("+3.0%");
    expect(html).not.toContain("2026-12-29</td>");
    // Regional comparison: EUR 7,450 / 1.00 * 0.93 = CHF 6,928.50; ECB date shown.
    expect(html).toContain("Regional comparison in Swiss francs");
    expect(html).toContain("CHF 6,928.50");
    expect(html).toContain("reference rate of 2026-12-01");
    expect(html).toMatch(/exclude sales tax/);
    // Error snapshots never appear.
    expect(html).not.toMatch(/error/i);
  });

  it("chart is an enhancement: pinned Chart.js, data in JSON, figure hidden by default", async () => {
    const html = await (await get(t, "/prices/omega/310-30-42-50-01-001", ON)).text();
    expect(html).toContain("cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js");
    expect(html).toContain('id="price-chart" hidden');
    const m = /<script type="application\/json" id="price-series">(.*?)<\/script>/.exec(html)!;
    const data = JSON.parse(m[1]!);
    expect(data.datasets.map((d: { label: string }) => d.label)).toEqual([
      "Switzerland (CHF)",
      "France (EUR)",
      "United States (USD)",
    ]);
  });

  it("JSON-LD: Product with sku and no Offer, Dataset and BreadcrumbList", async () => {
    const html = await (await get(t, "/prices/omega/310-30-42-50-01-001", ON)).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
    const types = blocks.map((b) => b["@type"]);
    expect(types).toEqual(["BreadcrumbList", "Product", "Dataset"]);
    const product = blocks[1];
    expect(product.sku).toBe("310.30.42.50.01.001");
    expect(product.brand.name).toBe("Omega");
    expect(JSON.stringify(blocks)).not.toMatch(/"offers?"|"@type":"Offer"/i);
    expect(blocks[2].license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(blocks[2].temporalCoverage).toBe("2026-12-01/2027-01-02");
  });

  it("names the retailer for a retailer price, once a manual brand capture exists", async () => {
    const html = await (await get(t, "/prices/rolex/126610ln", ON)).text();
    expect(html).toContain("Bucherer (authorised retailer)");
    expect(html).toContain("CHF 10,200");
  });

  it("a retailer price without a manual brand capture is not published", async () => {
    t.raw.exec(`INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method)
      VALUES (1,'UK',600000,'GBP','ok','2027-01-04T10:00:00Z','retailer:www.watches-of-switzerland.co.uk','fetch')`);
    const html = await (await get(t, "/prices/omega/310-30-42-50-01-001", ON)).text();
    expect(html).not.toContain("GBP\u00a06,000");
    expect(html).not.toContain("Watches of Switzerland");
  });

  it("leaves out snapshots with an open review flag", async () => {
    t.raw.exec(`INSERT INTO price_review_flags (snapshot_id, kind, created_at) VALUES (3, 'change_over_15', '2027-01-02')`);
    const html = await (await get(t, "/prices/omega/310-30-42-50-01-001", ON)).text();
    expect(html).not.toContain("CHF 7,210");
    expect(html).toContain("CHF 7,000");
  });

  it("404s for a brand whose prices are not public, an unknown reference and a reference without prices", async () => {
    expect((await get(t, "/prices/tissot/t137-407", ON)).status).toBe(404);
    expect((await get(t, "/prices/omega/nope", ON)).status).toBe(404);
    expect((await get(t, "/prices/omega/no-prices", ON)).status).toBe(404);
  });

  it("redirects an upper-case slug to the lower-case one", async () => {
    const res = await get(t, "/prices/rolex/126610LN", ON);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/prices/rolex/126610ln");
  });

  it("flag off (or unset): the price route is a 404, with no price content", async () => {
    for (const env of [{}, { PRICES_PUBLIC: "0" }, { PRICES_PUBLIC: "true" }]) {
      const res = await get(t, "/prices/omega/310-30-42-50-01-001", env);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("CHF");
    }
  });
});
