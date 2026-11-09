/**
 * Live pilot: fetches a handful of Cartier and Breitling pages with the Worker's
 * own fetcher and adapters (robots.txt first, ≥3 s per domain, honest user agent)
 * and prints the parsed prices. Writes nothing to D1 or R2.
 *
 *   node scripts/pilot-live.ts
 */
import { readFileSync } from "node:fs";
import type { MarketCode } from "../../../packages/shared/src/prices.ts";
import { readCsvObjects } from "../../registry/scripts/csv.ts";
import { adapterFor, fetchPrice } from "../src/adapters/index.ts";
import { PoliteFetcher } from "../src/polite-fetch.ts";

const PICKS: [string, MarketCode][] = [
  ["CRWSSA0029", "CH"],
  ["CRWSSA0029", "US"],
  ["AB0138211B1A1", "CH"],
  ["AB0138211B1A1", "US"],
];
const rows = readCsvObjects(readFileSync(new URL("../../../docs/plans/u5-reference-candidates.csv", import.meta.url), "utf8"));
const fetcher = new PoliteFetcher();
const out = await Promise.all(
  PICKS.map(async ([ref, market]) => {
    const row = rows.find((r) => r.ref_code === ref)!;
    const url = row[`url_${market.toLowerCase()}`]!;
    const adapter = adapterFor(url)!;
    const r = await fetchPrice(adapter, { refCode: ref, brandSlug: adapter.key, url }, market, fetcher);
    return { ref, market, url, status: r.status, amountMinor: r.amountMinor, currency: r.currency, priceText: r.priceText, taxLabel: r.taxLabel, http: r.httpStatus, message: r.message ?? null, csv: row[`price_${market.toLowerCase()}`] };
  }),
);
console.log(JSON.stringify({ at: new Date().toISOString(), requests: fetcher.log, results: out }, null, 2));
