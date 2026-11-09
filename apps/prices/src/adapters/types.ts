// The per-source adapter interface. Each brand or retailer keeps its quirks in one
// file: `parse` reads a saved page (pure, tested against fixtures) and the shared
// `fetchPrice` wraps it with the polite fetcher.

import type {
  CurrencyCode,
  MarketCode,
  PriceStatus,
  SourceKey,
} from "@baromontres/shared";
import type { FetchOutcome, PoliteFetcher } from "../polite-fetch.ts";

export interface AdapterReference {
  refCode: string;
  brandSlug: string;
  url: string;
}

export interface ParseResult {
  status: PriceStatus;
  amountMinor: number | null;
  currency: CurrencyCode;
  /** The price as written on the page, for the evidence and for spot checks. */
  priceText: string | null;
  /** Tax wording shown next to the price, e.g. "incl. VAT", "Excl. Sales Tax". */
  taxLabel: string | null;
  /** The reference code found on the page, if any. */
  refSeen: string | null;
  /** HTML parts the figure was read from (stored in R2). */
  evidenceParts: string[];
  /** Why a non-ok status was given. */
  message?: string;
}

export interface PriceResult extends ParseResult {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  fetchStatus: FetchOutcome["status"];
}

export interface Adapter {
  key: string;
  /** Hosts this adapter reads; also used to build the source key. */
  hosts: string[];
  kind: "brand" | "retailer";
  /** Brands this adapter may be used for (retailers), or the brand itself. */
  brands: string[];
  parse(
    html: string,
    ref: AdapterReference,
    market: MarketCode,
    currency: CurrencyCode,
  ): ParseResult;
}

export const MARKET_CURRENCY: Record<MarketCode, CurrencyCode> = {
  CH: "CHF",
  FR: "EUR",
  UK: "GBP",
  US: "USD",
};

/** Fetches one reference page and parses it. Never throws. */
export async function fetchPrice(
  adapter: Adapter,
  ref: AdapterReference,
  market: MarketCode,
  fetcher: PoliteFetcher,
): Promise<PriceResult> {
  const currency = MARKET_CURRENCY[market];
  const base = {
    url: ref.url,
    currency,
    priceText: null,
    taxLabel: null,
    refSeen: null,
    evidenceParts: [],
  };
  const out = await fetcher.get(ref.url);
  if (out.status === "ok") {
    let parsed: ParseResult;
    try {
      parsed = adapter.parse(out.html, ref, market, currency);
    } catch (e) {
      parsed = {
        ...base,
        status: "error",
        amountMinor: null,
        message: `parse failed: ${(e as Error).message}`,
      };
    }
    return {
      ...parsed,
      url: ref.url,
      finalUrl: out.finalUrl,
      httpStatus: out.httpStatus,
      fetchStatus: "ok",
    };
  }
  const status: PriceStatus =
    out.status === "not_found" ? "unavailable" : "error";
  return {
    ...base,
    status,
    amountMinor: null,
    message: "message" in out ? out.message : `HTTP ${out.httpStatus}`,
    finalUrl: "finalUrl" in out ? out.finalUrl : null,
    httpStatus: "httpStatus" in out ? (out.httpStatus ?? null) : null,
    fetchStatus: out.status,
  };
}

/** Compares reference codes ignoring case, spaces and punctuation. */
export function sameRef(a: string | null, b: string): boolean {
  if (!a) return false;
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n(a) === n(b);
}

/** A result for a page whose price could not be read. */
export function notFound(
  currency: CurrencyCode,
  message: string,
  evidenceParts: string[] = [],
  extra: Partial<ParseResult> = {},
): ParseResult {
  return {
    status: "error",
    amountMinor: null,
    currency,
    priceText: null,
    taxLabel: null,
    refSeen: null,
    evidenceParts,
    message,
    ...extra,
  };
}

export type { SourceKey };
