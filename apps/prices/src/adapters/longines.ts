// Longines (www.longines.com): /fr-ch/, /fr/, /en-gb/, /en-us/. JSON-LD Product with
// sku "L2.286.4.52.6" and offers.price as a number; the visible price is
// span[data-qa-id=product-price] ("CHF 950.00", "$1,100.00"). The two are
// cross-checked. No tax wording beside the price (only in the cart: "(TVA incluse)",
// "(VAT included)"); the market convention applies. Some pages are OutOfStock but
// still show the list price, which is kept.
// robots.txt (6 Nov 2026): Allow: /; filter_, reserve, gallery, watch-configurator
// and graphql paths disallowed.

import { match1 } from "../extract.ts";
import { jsonLdOffer, parseStorefront } from "./storefront.ts";
import type { Adapter } from "./types.ts";

export const longines: Adapter = {
  key: "longines",
  hosts: ["www.longines.com"],
  kind: "brand",
  brands: ["longines"],
  parse(html, ref, _market, currency) {
    return parseStorefront(html, ref.refCode, currency, {
      offer: (h) => jsonLdOffer(h, ref.refCode),
      visible: (h) => match1(h, /(<span data-qa-id="product-price"[^>]*>[\s\S]*?<\/span>)/),
    });
  },
};
