import { beforeEach, describe, expect, it } from "vitest";
import {
  findReferenceByCode,
  hasManualBrandCapture,
  insertPriceSnapshot,
  insertWatchReference,
  isSourceKey,
  listCaptureTargets,
  listUnconfirmedRetailerPrices,
  refCodeVariants,
  sourceKey,
  startCaptureRun,
  upsertPriceSource,
  upsertReferencePriceUrl,
  type NewPriceSnapshot,
} from "../src/prices.ts";
import { freshPriceDb, type TestDb } from "./d1-shim.ts";

let t: TestDb;
let rolexSub: number;
let cartierSantos: number;

beforeEach(async () => {
  t = freshPriceDb();
  t.raw.exec(
    `INSERT INTO brands (id, slug, name) VALUES (1, 'rolex', 'Rolex'), (2, 'cartier', 'Cartier');`,
  );
  rolexSub = (
    await insertWatchReference(t.d1, {
      brand_id: 1,
      slug: "rolex/126610ln",
      ref_code: "126610LN",
      name: "Submariner Date",
    })
  ).id;
  cartierSantos = (
    await insertWatchReference(t.d1, {
      brand_id: 2,
      slug: "cartier/crwssa0029",
      ref_code: "CRWSSA0029",
      name: "Santos de Cartier",
    })
  ).id;
});

const snap = (over: Partial<NewPriceSnapshot>): NewPriceSnapshot => ({
  reference_id: rolexSub,
  market_code: "CH",
  amount_minor: 1_015_000,
  currency: "CHF",
  status: "ok",
  captured_at: "2026-12-01T05:00:00Z",
  ...over,
});

describe("source keys", () => {
  it("builds brand and retailer keys from URLs or hosts", () => {
    expect(sourceKey("brand", "https://www.cartier.com/en-ch/x")).toBe(
      "brand:www.cartier.com",
    );
    expect(sourceKey("retailer", "www.bucherer.com")).toBe(
      "retailer:www.bucherer.com",
    );
    expect(isSourceKey("brand:www.rolex.com")).toBe(true);
    expect(isSourceKey("shop:www.rolex.com")).toBe(false);
    expect(isSourceKey("brand:")).toBe(false);
  });

  it("rejects a bad source at the database too", () => {
    expect(() =>
      t.raw
        .exec(`INSERT INTO price_sources (brand_id, market_code, source, method, adapter_key)
                  VALUES (1, 'CH', 'shop:x.com', 'fetch', 'x')`),
    ).toThrow(/CHECK/);
  });
});

describe("migration 0008", () => {
  it("allows the manual method without a URL or adapter", async () => {
    await upsertPriceSource(t.d1, {
      brand_id: 1,
      market_code: "CH",
      source: "brand:www.rolex.com",
      method: "manual",
    });
    const row = t.raw
      .prepare(`SELECT method, robots_ok FROM price_sources`)
      .get();
    expect(row).toEqual({ method: "manual", robots_ok: 0 });
  });

  it("still requires a URL or adapter for fetched sources", () => {
    expect(() =>
      t.raw
        .exec(`INSERT INTO price_sources (brand_id, market_code, source, method)
                  VALUES (1, 'CH', 'brand:www.cartier.com', 'fetch')`),
    ).toThrow(/CHECK/);
  });

  it("keeps price_snapshots append-only after the new columns", async () => {
    const id = await insertPriceSnapshot(
      t.d1,
      snap({ source: "retailer:www.bucherer.com", method: "fetch" }),
    );
    expect(() =>
      t.raw.exec(`UPDATE price_snapshots SET tax_label = 'x' WHERE id = ${id}`),
    ).toThrow(/append-only/);
  });

  it("upsert keeps the stored robots result when not given", async () => {
    const base = {
      brand_id: 2,
      market_code: "CH" as const,
      source: "brand:www.cartier.com" as const,
      method: "fetch" as const,
      adapter_key: "cartier",
    };
    await upsertPriceSource(t.d1, {
      ...base,
      robots_ok: true,
      robots_rules: { crawlDelay: null },
    });
    await upsertPriceSource(t.d1, { ...base, tax_label: "incl. VAT" });
    const row = t.raw
      .prepare(`SELECT robots_ok, tax_label, robots_rules FROM price_sources`)
      .get();
    expect(row).toEqual({
      robots_ok: 1,
      tax_label: "incl. VAT",
      robots_rules: '{"crawlDelay":null}',
    });
  });
});

describe("capture targets", () => {
  beforeEach(async () => {
    await upsertPriceSource(t.d1, {
      brand_id: 2,
      market_code: "CH",
      source: "brand:www.cartier.com",
      method: "fetch",
      adapter_key: "cartier",
    });
    await upsertReferencePriceUrl(t.d1, {
      reference_id: cartierSantos,
      market_code: "CH",
      source: "brand:www.cartier.com",
      url: "https://www.cartier.com/en-ch/a",
    });
    await upsertReferencePriceUrl(t.d1, {
      reference_id: cartierSantos,
      market_code: "US",
      source: "brand:www.cartier.com",
      url: "https://www.cartier.com/en-us/a.html",
    });
    await upsertReferencePriceUrl(t.d1, {
      reference_id: rolexSub,
      market_code: "CH",
      source: "retailer:www.bucherer.com",
      url: "https://www.bucherer.com/ch/en/x.html",
    });
  });

  it("lists targets with brand, currency and adapter", async () => {
    const all = await listCaptureTargets(t.d1);
    expect(all).toHaveLength(3);
    expect(
      all.find((x) => x.market_code === "CH" && x.brand_slug === "cartier"),
    ).toMatchObject({
      currency: "CHF",
      adapter_key: "cartier",
      ref_code: "CRWSSA0029",
    });
    expect(
      await listCaptureTargets(t.d1, {
        brandSlugs: ["cartier"],
        markets: ["US"],
      }),
    ).toHaveLength(1);
  });

  it("skips targets already captured in the run being resumed", async () => {
    const run = await startCaptureRun(t.d1, "cron");
    await insertPriceSnapshot(
      t.d1,
      snap({
        reference_id: cartierSantos,
        run_id: run,
        source: "brand:www.cartier.com",
        amount_minor: 700_000,
      }),
    );
    const left = await listCaptureTargets(t.d1, { excludeRunId: run });
    expect(left.map((x) => `${x.brand_slug}-${x.market_code}`).sort()).toEqual([
      "cartier-US",
      "rolex-CH",
    ]);
  });
});

describe("catalogue check for retailer prices", () => {
  it("flags retailer prices until the brand page has been captured by hand", async () => {
    await insertPriceSnapshot(
      t.d1,
      snap({ source: "retailer:www.bucherer.com", method: "fetch" }),
    );
    expect(await hasManualBrandCapture(t.d1, rolexSub)).toBe(false);
    expect(await listUnconfirmedRetailerPrices(t.d1)).toEqual([
      {
        reference_id: rolexSub,
        reference_slug: "rolex/126610ln",
        source: "retailer:www.bucherer.com",
        market_code: "CH",
        snapshots: 1,
      },
    ]);
    const countable = () =>
      t.raw
        .prepare(`SELECT COUNT(*) AS n FROM price_snapshots_countable`)
        .get();
    expect(countable()).toEqual({ n: 0 });

    await insertPriceSnapshot(
      t.d1,
      snap({
        source: "brand:www.rolex.com",
        method: "manual",
        captured_at: "2026-12-02T09:00:00Z",
      }),
    );
    expect(await hasManualBrandCapture(t.d1, rolexSub)).toBe(true);
    expect(await listUnconfirmedRetailerPrices(t.d1)).toEqual([]);
    expect(countable()).toEqual({ n: 2 });
  });

  it("does not accept a manual capture that failed", async () => {
    await insertPriceSnapshot(
      t.d1,
      snap({
        source: "brand:www.rolex.com",
        method: "manual",
        status: "error",
        amount_minor: null,
      }),
    );
    expect(await hasManualBrandCapture(t.d1, rolexSub)).toBe(false);
  });
});

describe("reference matching", () => {
  it("knows the forms a code takes on brand pages", () => {
    expect(refCodeVariants("M126610LN-0001")).toContain("126610ln");
    expect(refCodeVariants("m126610ln-0001")).toContain("126610ln");
    expect(refCodeVariants("310.30.42.50.01.001")).toContain(
      "310-30-42-50-01-001",
    );
  });

  it("finds Rolex 126610LN from the rolex.com code M126610LN-0001", async () => {
    expect(await findReferenceByCode(t.d1, 1, "M126610LN-0001")).toMatchObject({
      id: rolexSub,
    });
    expect(await findReferenceByCode(t.d1, 1, "126000")).toBeNull();
    expect(await findReferenceByCode(t.d1, 2, "M126610LN-0001")).toBeNull();
  });

  it("insertWatchReference is idempotent on brand and code", async () => {
    const again = await insertWatchReference(t.d1, {
      brand_id: 1,
      slug: "rolex/126610ln",
      ref_code: "126610LN",
      name: "x",
    });
    expect(again.id).toBe(rolexSub);
  });
});
