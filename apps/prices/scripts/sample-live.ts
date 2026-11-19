/**
 * Live sample for a spot check: two pages per new brand, fetched with the Worker's
 * own fetcher and adapters (robots.txt first, >= 3 s per domain, honest user agent).
 * Writes nothing to D1 or R2. Prints JSON.
 *
 *   node scripts/sample-live.ts
 */
import { readFileSync } from "node:fs";
import type { MarketCode } from "../../../packages/shared/src/prices.ts";
import { readCsvObjects } from "../../registry/scripts/csv.ts";
import { adapterFor, fetchPrice } from "../src/adapters/index.ts";
import { PoliteFetcher } from "../src/polite-fetch.ts";

const PICKS: [string, string, MarketCode][] = [
  ["Longines", "L2.286.4.52.6", "CH"], ["Longines", "L2.142.4.70.6", "UK"],
  ["Tissot", "T150.410.11.041.00", "CH"], ["Tissot", "T150.417.11.041.00", "US"],
  ["Rado", "R32505313", "CH"], ["Rado", "R32505313", "UK"],
  ["Omega", "310.30.42.50.01.001", "CH"], ["Omega", "324.30.38.50.01.002", "CH"],
  ["Oris", "01 733 7707 4053-07 8 20 18", "CH"], ["Oris", "01 733 7707 4064-07 8 20 18", "CH"],
  ["Grand Seiko", "SBGX363", "CH"], ["Grand Seiko", "SBGD201", "US"],
];
const rows = readCsvObjects(readFileSync(new URL("../../../docs/plans/u5-reference-candidates.csv", import.meta.url), "utf8"));
const fetcher = new PoliteFetcher();
const out = await Promise.all(
  PICKS.map(async ([brand, ref, market]) => {
    const row = rows.find((r) => r.brand === brand && r.ref_code === ref)!;
    const url = row[`url_${market.toLowerCase()}`]!;
    const adapter = adapterFor(url)!;
    const r = await fetchPrice(adapter, { refCode: ref, brandSlug: adapter.key, url }, market, fetcher);
    return { brand, ref, market, url, status: r.status, amountMinor: r.amountMinor, currency: r.currency, priceText: r.priceText, taxLabel: r.taxLabel, http: r.httpStatus, message: r.message ?? null, csv: row[`price_${market.toLowerCase()}`] };
  }),
);
console.log(JSON.stringify({ at: new Date().toISOString(), requests: fetcher.log, results: out }, null, 2));
