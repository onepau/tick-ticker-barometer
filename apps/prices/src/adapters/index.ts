import { breitling } from "./breitling.ts";
import { bucherer } from "./bucherer.ts";
import { cartier } from "./cartier.ts";
import type { Adapter } from "./types.ts";
import { watchesOfSwitzerland } from "./watches-of-switzerland.ts";

export const ADAPTERS: Adapter[] = [cartier, breitling, bucherer, watchesOfSwitzerland];

/** The adapter for a page, by explicit key or else by the URL's host. */
export function adapterFor(url: string, key?: string | null): Adapter | null {
  if (key) return ADAPTERS.find((a) => a.key === key) ?? null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return ADAPTERS.find((a) => a.hosts.includes(host)) ?? null;
}

export { fetchPrice, MARKET_CURRENCY } from "./types.ts";
export type { Adapter, AdapterReference, ParseResult, PriceResult } from "./types.ts";
