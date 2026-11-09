// Tissot (www.tissotwatches.com): /fr-ch/, /fr-fr/, /en-gb/, /en-us/ (Salesforce
// Commerce Cloud). JSON-LD Product with sku and mpn "T1504101104100", offers.price a
// string ("285.00"); the visible price sits in span.ti-price-sales ("285,00 CHF",
// "$350.00"). Cross-checked. No tax wording on the product page.
// robots.txt (6 Nov 2026): product pages allowed; cart, search, checkout, price
// filters disallowed. The /en-ch/ path 404s; the Swiss path is /fr-ch/.

import { match1 } from "../extract.ts";
import { jsonLdOffer, parseStorefront } from "./storefront.ts";
import type { Adapter } from "./types.ts";

export const tissot: Adapter = {
  key: "tissot",
  hosts: ["www.tissotwatches.com"],
  kind: "brand",
  brands: ["tissot"],
  parse(html, ref, _market, currency) {
    return parseStorefront(html, ref.refCode, currency, {
      offer: (h) => jsonLdOffer(h, ref.refCode),
      visible: (h) => match1(h, /(<span class="ti-price-sales">[\s\S]*?<\/span>\s*<\/span>)/),
    });
  },
};
