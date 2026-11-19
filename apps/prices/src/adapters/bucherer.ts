// Bucherer (www.bucherer.com), an authorised Rolex and Panerai retailer, markets
// /ch/en/, /fr/en/, /us/en/. The visible price is "Price CHF 10,150" in a
// chakra-text paragraph; the page state also carries "price":10150 with a
// pricebook named after the market ("bucherer-ch-regular-prices"). The reference
// is in the meta description ("Ref: M126610LN-0001"). The tax wording is a
// tooltip string ("Suggested retail price inclusive of V.A.T."), hidden in the US.
// robots.txt (6 Nov 2026): search and query strings disallowed; product pages allowed.
//
// A Bucherer price only counts once the reference has a manual capture from the
// brand's own site (price_snapshots_countable, migration 0008).

import { decodeEntities, firstSentence, match1, snippetAround } from "../extract.ts";
import { parsePrice } from "../parse.ts";
import { notFound, type Adapter, type ParseResult } from "./types.ts";
import { refCodeVariants } from "@baromontres/shared";

const PRICEBOOK: Record<string, string> = { CH: "bucherer-ch", FR: "bucherer-fr", US: "bucherer-us" };

export const bucherer: Adapter = {
  key: "bucherer",
  hosts: ["www.bucherer.com"],
  kind: "retailer",
  brands: ["rolex", "panerai"],
  parse(html, ref, market, currency): ParseResult {
    const desc = match1(html, /<meta[^>]*name="description" content="([^"]*)"/);
    const refSeen = desc ? (match1(decodeEntities(desc), /Ref(?:erence)?\.?\s*:?\s*([A-Z0-9][A-Z0-9.\- ]{3,})/i)?.trim() ?? null) : null;
    const visible = match1(html, /<p class="chakra-text[^"]*">(Price [^<]+)<\/p>/);
    const pricebook = match1(html, /"tieredPrices":\[\{"price":\d+(?:\.\d+)?,"pricebook":"([^"]+)"/);
    const stateNum = match1(html, /"tieredPrices":\[\{"price":(\d+(?:\.\d+)?)/);
    const tax = match1(html, /"bespoke_product_detail\.tooltip\.text":\[\{"type":0,"value":"([^"]*)"/);
    // Hidden on the US site (behaviour flag HIDE_VAT_LABEL), shown elsewhere.
    const taxLabel = market === "US" || !tax ? null : firstSentence(tax);
    const evidence = [
      desc ? `<meta name="description" content="${desc}">` : null,
      visible ? `<p>${visible}</p>` : null,
      snippetAround(html, '"tieredPrices"', 200),
    ].filter((p): p is string => !!p);
    const wanted = new Set(refCodeVariants(ref.refCode));
    if (!refSeen || !refCodeVariants(refSeen).some((v) => wanted.has(v))) {
      return notFound(currency, `page shows reference ${refSeen ?? "none"}, expected ${ref.refCode}`, evidence, { refSeen, taxLabel });
    }
    if (pricebook && !pricebook.startsWith(PRICEBOOK[market] ?? "\u0000")) {
      return notFound(currency, `pricebook ${pricebook} does not match market ${market}`, evidence, { refSeen, taxLabel });
    }
    const shown = visible ? parsePrice(visible, currency) : null;
    if (!shown) return notFound(currency, "no visible price", evidence, { refSeen, taxLabel });
    if (shown.kind === "price_on_request") {
      return { status: "price_on_request", amountMinor: null, currency, priceText: visible, taxLabel, refSeen, evidenceParts: evidence };
    }
    if (shown.currency && shown.currency !== currency) {
      return notFound(currency, `currency ${shown.currency} on page, expected ${currency}`, evidence, { refSeen, taxLabel });
    }
    if (stateNum && Math.round(Number(stateNum) * 100) !== shown.amountMinor) {
      return notFound(currency, `visible price ${visible} disagrees with page data ${stateNum}`, evidence, { refSeen, taxLabel });
    }
    return { status: "ok", amountMinor: shown.amountMinor, currency, priceText: visible, taxLabel, refSeen, evidenceParts: evidence };
  },
};
