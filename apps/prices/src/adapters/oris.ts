// Oris (www.oris.ch), locale paths /de-CH/, /fr-FR/, /en-GB/, /en-US/ (robots.txt
// allows product pages only under these prefixes; paths such as /fr-CH/ are not
// used). Nuxt front end. The product's own price is in div.stage-price as
// microdata: meta[itemprop=priceCurrency], meta[itemprop=price] content="2450.00",
// then the shown text ("CHF 2'450.00", "USD2,400.00"). The page also carries the
// prices of strap options in a carousel; those are ignored (only the stage block
// is read). The reference is read from the page title ("Divers Sixty-Five - 01 733
// 7707 4053-07 8 20 18 | Oris").
// Price on request: models "not available online" have an empty stage-price and a
// p.stage-button-info message ("Dieses Modell ist online nicht verfügbar...", in
// the market's language); they are recorded as price_on_request, as in the CSV.
// No tax wording on the product page.
// robots.txt (6 Nov 2026): Allow only the locale prefixes above, then Disallow: /.

import { match1, textOf } from "../extract.ts";
import { parseStorefront } from "./storefront.ts";
import { notFound, sameRef, type Adapter } from "./types.ts";

const STAGE = /(<div class="stage-price[^"]*"[^>]*>[\s\S]*?<\/div>)/;

export const oris: Adapter = {
  key: "oris",
  hosts: ["www.oris.ch"],
  kind: "brand",
  brands: ["oris"],
  parse(html, ref, _market, currency) {
    const title = textOf(match1(html, /<title>([^<]*)<\/title>/) ?? "");
    const refSeen = title.match(/-\s*([\d][\d -]*\d)\s*\|/)?.[1]?.trim() ?? null;
    const stage = match1(html, STAGE);
    if (stage === null) return notFound(currency, "no price block on the page", [], { refSeen });
    if (!sameRef(refSeen, ref.refCode)) {
      return notFound(currency, `reference ${ref.refCode} not found on the page (page has ${refSeen ?? "none"})`, [stage], { refSeen });
    }
    const info = match1(html, /(<p class="stage-button-info[^"]*"[^>]*>[\s\S]*?<\/p>)/);
    if (!/itemprop="price"/.test(stage)) {
      if (info !== null) {
        return { status: "price_on_request", amountMinor: null, currency, priceText: textOf(info), taxLabel: null, refSeen, evidenceParts: [stage, info] };
      }
      return notFound(currency, "no price and no 'not available online' message", [stage], { refSeen });
    }
    return parseStorefront(html, ref.refCode, currency, {
      offer: () => ({
        sku: refSeen,
        price: match1(stage, /<meta itemprop="price" content="([^"]*)"/),
        currency: match1(stage, /<meta itemprop="priceCurrency" content="([^"]*)"/),
        availability: null,
        raw: stage,
      }),
      // The block minus its meta tags is the text a shopper sees.
      visible: () => stage,
    });
  },
};
