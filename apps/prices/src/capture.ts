// Manual capture from Paul's bookmarklet (POST /api/capture). Paul opens a brand
// page himself (rolex.com, panerai.com: sites that block automated requests), clicks
// the bookmarklet, checks the reference and price it read, and sends them with a
// copy of the page HTML. Nothing here fetches a brand page.
//
// Stored as method 'manual', source 'brand:<domain>'. A reference must already be
// in watch_references unless the request says create=1 with a brand and a name.

import {
  finishCaptureRun,
  findReferenceByCode,
  insertPriceSnapshot,
  insertWatchReference,
  normaliseRefCode,
  slugifyReference,
  sourceKey,
  startCaptureRun,
  upsertPriceSource,
  type MarketCode,
  type PriceStatus,
} from "@baromontres/shared";
import { MARKET_CURRENCY } from "./adapters/types.ts";
import { evidenceKey, putEvidence } from "./evidence.ts";
import { parsePrice } from "./parse.ts";

/** Brand sites the bookmarklet may be used on, mapped to registry brand slugs. */
export const MANUAL_HOSTS: Record<string, string> = {
  "www.rolex.com": "rolex",
  "www.panerai.com": "panerai",
};

export const MAX_HTML_BYTES = 8 * 1024 * 1024;

export interface CapturePayload {
  url: string;
  html: string;
  ref: string;
  price_text: string;
  tax_text?: string | null;
  market?: string | null;
  title?: string | null;
  /** "1" or true: add the reference if it is not in watch_references yet. */
  create?: string | number | boolean | null;
  brand?: string | null;
  name?: string | null;
  family?: string | null;
}

export type CaptureResult =
  | {
      ok: true;
      status: PriceStatus;
      reference: string;
      created: boolean;
      market: MarketCode;
      amount_minor: number | null;
      currency: string;
      evidence_key: string;
      run_id: number;
    }
  | { ok: false; status: number; error: string };

const COUNTRY_TO_MARKET: Record<string, MarketCode> = { ch: "CH", fr: "FR", gb: "UK", uk: "UK", us: "US" };

/**
 * Market from a brand URL's locale: /en-ch/… or /fr-fr/… (Rolex), /ch/en/… (Panerai).
 */
export function marketFromUrl(url: string): MarketCode | null {
  let segs: string[];
  try {
    segs = new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return null;
  }
  const [a, b] = segs;
  const lc = a?.match(/^[a-z]{2}-([a-z]{2})$/);
  if (lc) return COUNTRY_TO_MARKET[lc[1]!] ?? null;
  if (a && b && /^[a-z]{2}$/.test(a) && /^[a-z]{2}$/.test(b)) return COUNTRY_TO_MARKET[a] ?? null;
  return null;
}

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

export async function handleCapture(
  db: D1Database,
  bucket: R2Bucket,
  p: Partial<CapturePayload>,
  now: Date = new Date(),
): Promise<CaptureResult> {
  const fail = (status: number, error: string): CaptureResult => ({ ok: false, status, error });
  if (!p || typeof p.url !== "string" || typeof p.html !== "string") return fail(400, "url and html are required");
  if (typeof p.ref !== "string" || !p.ref.trim()) return fail(400, "ref (the reference code) is required");
  if (typeof p.price_text !== "string" || !p.price_text.trim()) return fail(400, "price_text is required");
  if (new TextEncoder().encode(p.html).byteLength > MAX_HTML_BYTES) return fail(413, "page copy too large");

  let host: string;
  try {
    const u = new URL(p.url);
    if (u.protocol !== "https:") return fail(400, "only https pages");
    host = u.hostname;
  } catch {
    return fail(400, "invalid url");
  }
  const brandSlug = MANUAL_HOSTS[host];
  if (!brandSlug) return fail(400, `manual capture is set up for ${Object.keys(MANUAL_HOSTS).join(", ")} only`);
  if (p.brand && p.brand !== brandSlug) return fail(400, `page is on ${host}, which is ${brandSlug}, not ${p.brand}`);

  const market = (p.market ? (p.market.toUpperCase() as MarketCode) : null) ?? marketFromUrl(p.url);
  if (!market || !(market in MARKET_CURRENCY)) return fail(400, "market not recognised; pass market=CH, FR, UK or US");
  const currency = MARKET_CURRENCY[market];

  const brand = await db
    .prepare(`SELECT id, slug FROM brands WHERE slug = ?`)
    .bind(brandSlug)
    .first<{ id: number; slug: string }>();
  if (!brand) return fail(422, `brand ${brandSlug} is not in the registry`);

  const refCode = p.ref.trim();
  let ref = await findReferenceByCode(db, brand.id, refCode);
  let created = false;
  if (!ref) {
    if (!truthy(p.create)) {
      return fail(404, `reference ${refCode} is not in watch_references for ${brandSlug}; send create=1 with brand and name to add it`);
    }
    if (!p.brand || !p.name?.trim()) return fail(400, "create=1 needs brand and name");
    try {
      normaliseRefCode(refCode);
    } catch {
      return fail(400, `unusable reference code ${refCode}`);
    }
    ref = await insertWatchReference(db, {
      brand_id: brand.id,
      slug: slugifyReference(brand.slug, refCode),
      ref_code: refCode,
      name: p.name.trim(),
      family: p.family?.trim() || null,
      notes: `added by manual capture on ${now.toISOString().slice(0, 10)} from ${p.url}`,
    });
    created = true;
  }

  const parsed = parsePrice(p.price_text, currency);
  if (!parsed) return fail(422, `no price found in "${p.price_text}"`);
  if (parsed.kind === "price" && parsed.currency && parsed.currency !== currency) {
    return fail(422, `price is in ${parsed.currency} but the ${market} market uses ${currency}`);
  }
  const status: PriceStatus = parsed.kind === "price" ? "ok" : "price_on_request";
  const amountMinor = parsed.kind === "price" ? parsed.amountMinor : null;

  const source = sourceKey("brand", host);
  const runId = await startCaptureRun(db, "manual", now.toISOString());
  const header = [
    `manual capture (bookmarklet) ${now.toISOString()}`,
    `url: ${p.url}`,
    `title: ${p.title ?? ""}`,
    `reference: ${ref.slug} (seen as ${refCode})`,
    `market: ${market}`,
    `price_text: ${p.price_text}`,
    `tax_text: ${p.tax_text ?? ""}`,
  ]
    .join("\n")
    .replace(/--/g, "- -");
  const ev = await putEvidence(
    bucket,
    evidenceKey({ runId, brandSlug: brand.slug, refCode: ref.ref_code, market, source }),
    `<!--\n${header}\n-->\n${p.html}`,
    { run: String(runId), url: p.url, source, method: "manual" },
  );
  await upsertPriceSource(db, {
    brand_id: brand.id,
    market_code: market,
    source,
    method: "manual",
    tax_label: p.tax_text?.trim() || null,
    notes: "captured by hand with the bookmarklet",
  });
  await insertPriceSnapshot(db, {
    reference_id: ref.id,
    market_code: market,
    amount_minor: amountMinor,
    currency,
    status,
    captured_at: now.toISOString(),
    source_url: p.url,
    evidence_key: ev.key,
    content_hash: ev.hash,
    run_id: runId,
    source,
    method: "manual",
    tax_label: p.tax_text?.trim() || null,
  });
  await finishCaptureRun(db, runId, { [status]: 1, manual: 1 }, [], now.toISOString());
  return {
    ok: true,
    status,
    reference: ref.slug,
    created,
    market,
    amount_minor: amountMinor,
    currency,
    evidence_key: ev.key,
    run_id: runId,
  };
}
