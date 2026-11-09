// Shared reading of a brand storefront page: one structured offer (JSON-LD or
// microdata) cross-checked against the price shown on the page. Longines, Tissot,
// Rado and Omega (Swatch Group sites, written as one unit) differ in markup, but
// every one of them needs the same steps:
//   1. find the offer for this reference and check the reference matches;
//   2. check the currency is the market's;
//   3. read the amount from the structured data;
//   4. read the price shown on the page and refuse a page where the two disagree;
//   5. keep the parts of the page the figure came from as evidence.
// Each brand file supplies only the anchors (a StorefrontConfig).

import { match1, productOffers, textOf } from "../extract.ts";
import { amountMinorFromJson, parsePrice } from "../parse.ts";
import { notFound, sameRef, type ParseResult } from "./types.ts";
import type { CurrencyCode } from "@baromontres/shared";

export interface StructuredOffer {
  sku: string | null;
  price: unknown;
  currency: string | null;
  availability: string | null;
  /** The markup the offer was read from (evidence). */
  raw: string;
}

export interface StorefrontConfig {
  /** The page's main offer, or null when the page has none. */
  offer(html: string): StructuredOffer | null;
  /** The HTML of the element showing the price to a shopper, if any. */
  visible(html: string): string | null;
  /** Tax wording shown next to the price, if the page has any. */
  tax?(html: string): string | null;
  /** Extra evidence snippets, beyond the offer markup. */
  evidence?(html: string): (string | null)[];
}

/** The first JSON-LD Product whose own sku or offer sku is `ref` (main offer only). */
export function jsonLdOffer(html: string, refCode: string): StructuredOffer | null {
  const found = productOffers(html);
  const hit = found.find((o) => sameRef(o.sku, refCode) || sameRef(o.mpn, refCode));
  if (hit) {
    return { sku: hit.sku ?? hit.mpn, price: hit.price, currency: hit.priceCurrency, availability: hit.availability, raw: hit.block.raw };
  }
  // Omega puts the sku on the offer, not on the product.
  for (const block of found) {
    const data = block.block.data as { offers?: Record<string, unknown> } | null;
    const o = data && !Array.isArray(data) && typeof data.offers === "object" ? data.offers : null;
    if (o && !Array.isArray(o) && typeof o.sku === "string" && sameRef(o.sku, refCode)) {
      return {
        sku: o.sku,
        price: o.price ?? null,
        currency: typeof o.priceCurrency === "string" ? o.priceCurrency : null,
        availability: typeof o.availability === "string" ? o.availability : null,
        raw: block.block.raw,
      };
    }
  }
  const first = found[0];
  return first ? { sku: first.sku ?? first.mpn, price: first.price, currency: first.priceCurrency, availability: first.availability, raw: first.block.raw } : null;
}

export function parseStorefront(
  html: string,
  refCode: string,
  currency: CurrencyCode,
  cfg: StorefrontConfig,
): ParseResult {
  const offer = cfg.offer(html);
  const visibleHtml = cfg.visible(html);
  const visibleText = visibleHtml !== null ? textOf(visibleHtml) : null;
  const taxLabel = cfg.tax?.(html) || null;
  const evidence = [offer?.raw ?? null, visibleHtml, ...(cfg.evidence?.(html) ?? [])].filter((p): p is string => !!p);
  const refSeen = offer?.sku ?? null;
  const extra = { refSeen, taxLabel };
  const shown = visibleText ? parsePrice(visibleText, currency) : null;

  if (!offer) {
    if (shown?.kind === "price_on_request") {
      return { status: "price_on_request", amountMinor: null, currency, priceText: visibleText, taxLabel, refSeen, evidenceParts: evidence };
    }
    return notFound(currency, "no product data on the page", evidence, extra);
  }
  if (!sameRef(offer.sku, refCode)) {
    return notFound(currency, `reference ${refCode} not found in the page's product data (page has ${offer.sku ?? "none"})`, evidence, extra);
  }
  if (offer.currency && offer.currency !== currency) {
    return notFound(currency, `currency ${offer.currency} on page, expected ${currency}`, evidence, extra);
  }
  const amountMinor = amountMinorFromJson(offer.price, currency);
  if (amountMinor === null) {
    if (shown?.kind === "price_on_request") {
      return { status: "price_on_request", amountMinor: null, currency, priceText: visibleText, taxLabel, refSeen, evidenceParts: evidence };
    }
    return notFound(currency, "no price in the product data", evidence, extra);
  }
  if (shown?.kind === "price") {
    if (shown.currency && shown.currency !== currency) {
      return notFound(currency, `visible price ${visibleText} is not in ${currency}`, evidence, extra);
    }
    if (shown.amountMinor !== amountMinor) {
      return notFound(currency, `visible price ${visibleText} disagrees with product data`, evidence, extra);
    }
  }
  return { status: "ok", amountMinor, currency, priceText: visibleText, taxLabel, refSeen, evidenceParts: evidence };
}

export { match1 };
