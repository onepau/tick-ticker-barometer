// Omega (www.omegawatches.com), CH only (Paul's decision: /fr-fr/, /en-gb/ and
// /en-us/ redirect to /en-ch/, which is not bypassed). Magento. JSON-LD Product with
// offers.sku "310.30.42.50.01.001" and offers.price a number; the other variants of
// the model sit in addOn and are ignored. The visible price is span.price inside
// .product-price-wrapper ("CHF 6’600", data-price-amount="6600"). Cross-checked.
// No tax wording beside the price (the cart shows subtotals including tax).
// robots.txt (6 Nov 2026): Allow: / for *; only named bots are disallowed.

import { match1 } from "../extract.ts";
import { notFound, type Adapter } from "./types.ts";
import { jsonLdOffer, parseStorefront } from "./storefront.ts";

export const omega: Adapter = {
  key: "omega",
  hosts: ["www.omegawatches.com"],
  kind: "brand",
  brands: ["omega"],
  parse(html, ref, market, currency) {
    if (market !== "CH") return notFound(currency, `Omega is tracked for CH only, not ${market}`);
    return parseStorefront(html, ref.refCode, currency, {
      offer: (h) => jsonLdOffer(h, ref.refCode),
      visible: (h) => match1(h, /(<span\s+id="product-price-\d+"[\s\S]*?<span class="price">[^<]*<\/span>)/),
    });
  },
};
