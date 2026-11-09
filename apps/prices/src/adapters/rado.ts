// Rado (www.rado.com): /fr_ch/, /fr_fr/, /en_gb/, /en_us/ (Magento). No JSON-LD
// Product; the price block carries microdata (meta[itemprop=price] content="2100",
// meta[itemprop=priceCurrency]) and the visible price in span.price ("2 100.00
// CHF", "$2,500.00"). The reference is read from the page title ("... Montre
// R32505313 | Rado"). Cross-checked. No tax wording on the product page.
// robots.txt (6 Nov 2026): only /catalogsearch/ disallowed. The /en_ch/ path 404s.

import { match1 } from "../extract.ts";
import { parseStorefront } from "./storefront.ts";
import type { Adapter } from "./types.ts";

export const rado: Adapter = {
  key: "rado",
  hosts: ["www.rado.com"],
  kind: "brand",
  brands: ["rado"],
  parse(html, ref, _market, currency) {
    return parseStorefront(html, ref.refCode, currency, {
      offer(h) {
        const price = match1(h, /<meta itemprop="price" content="([^"]*)"/);
        if (price === null) return null;
        return {
          sku: match1(h, /<title>[^<]*\b(R\d{7,8})\b/),
          price,
          currency: match1(h, /<meta itemprop="priceCurrency"\s+content="([^"]*)"/),
          availability: null,
          raw: `<meta itemprop="price" content="${price}">`,
        };
      },
      visible: (h) => match1(h, /(<span class="price">[^<]*<\/span>)/),
    });
  },
};
