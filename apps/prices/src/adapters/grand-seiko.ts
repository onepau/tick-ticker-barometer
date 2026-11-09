// Grand Seiko (www.grand-seiko.com): /ch-fr/, /fr-fr/, /uk-en/, /us-en/ product
// pages at /collections/<ref lower case>j|g. Server-rendered, no structured data:
// h1._title holds the reference ("SBGX363"), p._collection the collection and
// p._price the price ("CHF 3,700.00", "USD 3,600.00"). With only one figure on the
// page, the checks are the reference in the title and the currency in the text.
// Price on request: boutique-only models (UK and US for the Masterpiece pieces)
// have the title and collection but no p._price; they are recorded as
// price_on_request. A page without a title or collection is an error, not a POR.
// Some pages show "Release date" (a model not yet on sale) with the price.
// No tax wording on the product page.
// robots.txt is read and obeyed by the fetcher before every run (fetched 9 Nov 2026).

import { match1, textOf } from "../extract.ts";
import { parsePrice } from "../parse.ts";
import { notFound, sameRef, type Adapter } from "./types.ts";

export const grandSeiko: Adapter = {
  key: "grand-seiko",
  hosts: ["www.grand-seiko.com"],
  kind: "brand",
  brands: ["grand-seiko"],
  parse(html, ref, _market, currency) {
    const body = match1(html, /(<div class="_body">\s*<h1 class="_title">[\s\S]*?<\/div>)/);
    const title = match1(html, /<h1 class="_title">([^<]*)<\/h1>/);
    const refSeen = title ? textOf(title) : null;
    const collection = match1(html, /<p class="_collection">([\s\S]*?)<\/p>/);
    if (body === null || refSeen === null || collection === null) {
      return notFound(currency, "no product header on the page", body ? [body] : [], { refSeen });
    }
    if (!sameRef(refSeen, ref.refCode)) {
      return notFound(currency, `reference ${ref.refCode} not found on the page (page has ${refSeen})`, [body], { refSeen });
    }
    const priceHtml = match1(html, /(<p class="_price">[\s\S]*?<\/p>)/);
    if (priceHtml === null) {
      return { status: "price_on_request", amountMinor: null, currency, priceText: null, taxLabel: null, refSeen, evidenceParts: [body], message: "no price shown (boutique only)" };
    }
    const priceText = textOf(priceHtml);
    const parsed = parsePrice(priceText, currency);
    if (parsed?.kind === "price_on_request") {
      return { status: "price_on_request", amountMinor: null, currency, priceText, taxLabel: null, refSeen, evidenceParts: [body] };
    }
    if (parsed?.kind !== "price") return notFound(currency, `could not read the price "${priceText}"`, [body], { refSeen, priceText });
    if (parsed.currency && parsed.currency !== currency) {
      return notFound(currency, `currency ${parsed.currency} on page, expected ${currency}`, [body], { refSeen, priceText });
    }
    return { status: "ok", amountMinor: parsed.amountMinor, currency, priceText, taxLabel: null, refSeen, evidenceParts: [body] };
  },
};
