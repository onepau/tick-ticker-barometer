// Breitling (www.breitling.com), markets /ch-en/, /fr-fr/, /gb-en/, /us-en/.
// JSON-LD Product.offers.price is a number (9100) with priceCurrency; the visible
// price is in [data-test-id=ProductDetailPricing] and the tax wording in
// [data-test-id=ProductDetailTaxLabel] ("VAT Incl.", "TVA incluse",
// "Excl. Sales Tax"). The two prices are cross-checked.
// robots.txt (6 Nov 2026): these four locale paths allowed, other country paths
// disallowed; Content-Signal: ai-train=no, search=yes, ai-input=yes.

import { match1, productOffers, textOf } from "../extract.ts";
import { amountMinorFromJson, parsePrice } from "../parse.ts";
import { notFound, sameRef, type Adapter, type ParseResult } from "./types.ts";

export const breitling: Adapter = {
  key: "breitling",
  hosts: ["www.breitling.com"],
  kind: "brand",
  brands: ["breitling"],
  parse(html, ref, _market, currency): ParseResult {
    const offer = productOffers(html).find((o) => sameRef(o.sku, ref.refCode) || sameRef(o.mpn, ref.refCode));
    const skuShown = match1(html, /data-test-id="ProductDetailSku"[^>]*>([^<]*)</);
    const pricing = match1(
      html,
      /(<div data-test-id="ProductDetailPricing"[\s\S]*?data-test-id="ProductDetailTaxLabel"[^>]*>[^<]*<\/span>)/,
    );
    const taxLabel = match1(html, /data-test-id="ProductDetailTaxLabel"[^>]*>([^<]*)</);
    const evidence = [offer?.block.raw ?? null, pricing].filter((p): p is string => !!p);
    const refSeen = offer?.sku ?? skuShown;
    if (!offer) {
      return notFound(currency, `reference ${ref.refCode} not found in the page's product data`, evidence, { refSeen, taxLabel });
    }
    if (offer.priceCurrency && offer.priceCurrency !== currency) {
      return notFound(currency, `currency ${offer.priceCurrency} on page, expected ${currency}`, evidence, { refSeen, taxLabel });
    }
    const amountMinor = amountMinorFromJson(offer.price, currency);
    // Visible text: drop the tax label so only the amount and currency remain.
    const shownText = pricing ? textOf(pricing).replace(taxLabel ?? "\u0000", "").trim() || null : null;
    const shown = shownText ? parsePrice(shownText, currency) : null;
    if (amountMinor === null) {
      if (shown?.kind === "price_on_request") {
        return { status: "price_on_request", amountMinor: null, currency, priceText: shownText, taxLabel, refSeen, evidenceParts: evidence };
      }
      return notFound(currency, "no price in the product data", evidence, { refSeen, taxLabel });
    }
    if (shown?.kind === "price" && shown.amountMinor !== amountMinor) {
      return notFound(currency, `visible price ${shownText} disagrees with product data`, evidence, { refSeen, taxLabel });
    }
    return { status: "ok", amountMinor, currency, priceText: shownText, taxLabel, refSeen, evidenceParts: evidence };
  },
};
