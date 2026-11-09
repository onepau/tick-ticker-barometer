// Cartier (www.cartier.com). Two storefronts:
// - CH, FR, UK (AEM): JSON-LD Product.offers.price is the displayed string
//   ("CHF 7,000", "8,300€", "£7,250"); the tax wording is in the page's
//   data-d-vat-i18 attribute ("incl. VAT", "TVA incluse").
// - US (Salesforce): JSON-LD price is "8400.00"; the visible price sits in
//   span[itemprop=price]; the tax span is empty (US prices exclude sales tax).
// robots.txt (6 Nov 2026): product paths allowed; /*/api and search disallowed.

import { productOffers, match1, snippetAround, textOf } from "../extract.ts";
import { amountMinorFromJson, parsePrice } from "../parse.ts";
import { notFound, sameRef, type Adapter, type ParseResult } from "./types.ts";

const POR_RE = /price (?:up)?on request|prix sur demande/i;

export const cartier: Adapter = {
  key: "cartier",
  hosts: ["www.cartier.com"],
  kind: "brand",
  brands: ["cartier"],
  parse(html, ref, _market, currency): ParseResult {
    const offers = productOffers(html);
    // SKU is "WSSA0029" on AEM pages and "CRWSSA0029" on the US store.
    const offer = offers.find(
      (o) =>
        sameRef(o.sku, ref.refCode) ||
        sameRef(o.mpn, ref.refCode) ||
        (o.sku !== null && sameRef(`CR${o.sku}`, ref.refCode)),
    );
    const vatAttr = match1(html, /data-d-vat-i18="([^"]*)"/);
    const usTax = match1(html, /<span class="pdp-main__price-tax[^"]*">([\s\S]*?)<\/span>/);
    const taxLabel = (vatAttr ?? (usTax !== null ? textOf(usTax) : "")) || null;
    const priceSnippet =
      snippetAround(html, /<div class="(?:car-pdp__price|pdp-main__price)\b/, 900) ?? null;
    const evidence = [offer?.block.raw ?? null, priceSnippet, vatAttr ? `<!-- data-d-vat-i18 --> ${vatAttr}` : null]
      .filter((p): p is string => !!p);
    if (!offer) {
      return notFound(currency, `reference ${ref.refCode} not found in the page's product data`, evidence, {
        refSeen: offers[0]?.sku ?? null,
        taxLabel,
      });
    }
    const refSeen = offer.mpn ?? offer.sku;
    if (offer.priceCurrency && offer.priceCurrency !== currency) {
      return notFound(currency, `currency ${offer.priceCurrency} on page, expected ${currency}`, evidence, {
        refSeen,
        taxLabel,
      });
    }
    const amountMinor = amountMinorFromJson(offer.price, currency);
    const visible = match1(html, /<span class="value" itemprop="price"[^>]*>([\s\S]*?)<\/span>/);
    const priceText = visible !== null ? textOf(visible) : typeof offer.price === "string" ? offer.price : null;
    if (amountMinor === null) {
      if (POR_RE.test(priceSnippet ?? "")) {
        return { status: "price_on_request", amountMinor: null, currency, priceText: "price on request", taxLabel, refSeen, evidenceParts: evidence };
      }
      return notFound(currency, "no price in the product data", evidence, { refSeen, taxLabel });
    }
    if (visible !== null) {
      const shown = parsePrice(textOf(visible), currency);
      if (shown?.kind === "price" && shown.amountMinor !== amountMinor) {
        return notFound(currency, `visible price ${textOf(visible)} disagrees with product data`, evidence, { refSeen, taxLabel });
      }
    }
    return { status: "ok", amountMinor, currency, priceText, taxLabel, refSeen, evidenceParts: evidence };
  },
};
