// Watches of Switzerland UK (www.watches-of-switzerland.co.uk), an authorised Rolex
// and Panerai retailer, UK market only. Rolex pages show the reference in
// span.mpn ("M126610LN-0001"), the price in span.pceDisplay ("£9,500") and
// "Suggested retail price inclusive of V.A.T."; the page state also carries
// "price":{"currencyIso":"GBP",...,"value":9500}. Panerai pages use another
// template without the tax wording, so the state price is the fallback.
// robots.txt (6 Nov 2026): Allow: /; cart, search, checkout, account disallowed.
// (The US site, watchesofswitzerland.com, rate-limited on 6 Nov and is not used.)
//
// A WoS price only counts once the reference has a manual capture from the
// brand's own site (price_snapshots_countable, migration 0008).

import { firstSentence, match1, snippetAround, textOf } from "../extract.ts";
import { amountMinorFromJson, parsePrice } from "../parse.ts";
import { notFound, type Adapter, type ParseResult } from "./types.ts";
import { refCodeVariants } from "@baromontres/shared";

export const watchesOfSwitzerland: Adapter = {
  key: "watches-of-switzerland-uk",
  hosts: ["www.watches-of-switzerland.co.uk"],
  kind: "retailer",
  brands: ["rolex", "panerai"],
  parse(html, ref, market, currency): ParseResult {
    if (market !== "UK") return notFound(currency, `Watches of Switzerland UK serves the UK market only, not ${market}`);
    const refSeen =
      match1(html, /class="[^"]*\bmpn\b[^"]*">([^<]+)</)?.trim() ??
      match1(html, /"manufacturerPartNumber"\s*:\s*"([^"]+)"/) ??
      null;
    const visibleRaw = match1(html, /class="[^"]*\bpceDisplay\b[^"]*">([^<]+)</);
    const visible = visibleRaw ? textOf(visibleRaw) : null;
    // The page state holds prices for other products too (recommendations), so the
    // visible price must be one of them; without a visible price, all must agree.
    const states = [...html.matchAll(/"price":\{"currencyIso":"([A-Z]{3})","formattedValue":"([^"]*)"[^}]*?"value":(\d+(?:\.\d+)?)/g)];
    const state = states[0] ?? null;
    const taxText = match1(html, /class="[^"]*rolexPriceInfoTextInner[^"]*">([^<]+)</);
    const taxLabel = taxText ? firstSentence(textOf(taxText)) : null;
    const evidence = [
      snippetAround(html, /class="[^"]*\bmpn\b/, 300),
      snippetAround(html, /class="[^"]*\bpceDisplay\b/, 500),
      state ? state[0] : null,
    ].filter((p): p is string => !!p);
    const wanted = new Set(refCodeVariants(ref.refCode));
    if (!refSeen || !refCodeVariants(refSeen).some((v) => wanted.has(v))) {
      return notFound(currency, `page shows reference ${refSeen ?? "none"}, expected ${ref.refCode}`, evidence, { refSeen, taxLabel });
    }
    if (states.some((m) => m[1] !== currency)) {
      return notFound(currency, `currency ${states.find((m) => m[1] !== currency)![1]} on page, expected ${currency}`, evidence, { refSeen, taxLabel });
    }
    const stateValues = new Set(states.map((m) => amountMinorFromJson(Number(m[3]), currency)));
    const stateMinor = stateValues.size === 1 ? [...stateValues][0]! : null;
    const shown = visible ? parsePrice(visible, currency) : null;
    if (shown?.kind === "price_on_request") {
      return { status: "price_on_request", amountMinor: null, currency, priceText: visible, taxLabel, refSeen, evidenceParts: evidence };
    }
    const amountMinor = shown?.kind === "price" ? shown.amountMinor : stateMinor;
    if (amountMinor === null) return notFound(currency, "no price on page", evidence, { refSeen, taxLabel });
    if (states.length > 0 && !stateValues.has(amountMinor)) {
      return notFound(currency, `visible price ${visible} not found in the page data`, evidence, { refSeen, taxLabel });
    }
    return { status: "ok", amountMinor, currency, priceText: visible ?? state?.[2] ?? null, taxLabel, refSeen, evidenceParts: evidence };
  },
};
