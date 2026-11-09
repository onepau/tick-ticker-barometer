// Locale-aware price parsing. Amounts come back as integer minor units
// (centimes, cents, pence), computed from the digits as strings, never via floats.
//
// Formats seen on brand and retailer pages (fixtures in tests/parse.test.ts):
//   CHF 9’900.–   Swiss: apostrophe groups, ".–" for no cents
//   9 900 €       French: (narrow) no-break space groups, symbol after
//   8,300€        Cartier FR: comma groups, symbol after
//   £9,900  $9,900.00  USD 10,700  Price €11,000
//   POR / Price on request / Prix sur demande

import type { CurrencyCode } from "@baromontres/shared";

export type ParsedPrice =
  | {
      kind: "price";
      amountMinor: number;
      currency: CurrencyCode | null;
      text: string;
    }
  | { kind: "price_on_request"; text: string };

const POR_RE =
  /\b(?:POR|price\s+(?:up)?on\s+request|prix\s+sur\s+demande|preis\s+auf\s+anfrage|prezzo\s+su\s+richiesta|on\s+request|sur\s+demande)\b/i;

// Longest tokens first so "US$" wins over "$" and "SFr." over "Fr.".
const CURRENCY_TOKENS: [RegExp, CurrencyCode][] = [
  [/US\$/g, "USD"],
  [/\bUSD\b/g, "USD"],
  [/\bCHF\b/g, "CHF"],
  [/\bS?Fr\./g, "CHF"],
  [/\bEUR\b/g, "EUR"],
  [/€/g, "EUR"],
  [/\bGBP\b/g, "GBP"],
  [/£/g, "GBP"],
  [/\$/g, "USD"],
];

// A number: either thousands groups (1–3 digits then groups of exactly three,
// separated by space, apostrophe, dot or comma) or a plain run of digits, then an
// optional decimal part of one or two digits.
const NUMBER_RE = /(\d{1,3}(?:[ '’ʼ.,]\d{3})+|\d+)(?:([.,])(\d{1,2}))?(?!\d)/g;

/** Replaces the many space characters pages use between digit groups. */
export function normaliseSpaces(s: string): string {
  return (
    s
      .replace(/[      ]/g, " ")
      .replace(/\s+/g, " ")
      // Markup split across elements ("8 , 150" from <span>8</span>,<span>150</span>).
      .replace(/(\d) ([,.’']) (?=\d)/g, "$1$2")
      .trim()
  );
}

interface NumberToken {
  start: number;
  end: number;
  minor: number;
}

function numberTokens(s: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of s.matchAll(NUMBER_RE)) {
    const whole = m[1]!.replace(/[ '’ʼ.,]/g, "");
    const cents = (m[3] ?? "").padEnd(2, "0");
    const minor = Number(whole) * 100 + Number(cents || "0");
    if (!Number.isSafeInteger(minor)) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, minor });
  }
  return out;
}

function currencyTokens(
  s: string,
): { start: number; end: number; code: CurrencyCode }[] {
  const out: { start: number; end: number; code: CurrencyCode }[] = [];
  const taken: [number, number][] = [];
  for (const [re, code] of CURRENCY_TOKENS) {
    for (const m of s.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      out.push({ start, end, code });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Parses a displayed price. Picks the number closest to a currency token (within
 * a few characters), otherwise the first number. Returns null when there is no
 * price and no "price on request" wording.
 */
export function parsePrice(
  raw: string,
  expected?: CurrencyCode,
): ParsedPrice | null {
  const text = normaliseSpaces(raw);
  if (!text) return null;
  const nums = numberTokens(text).filter((n) => n.minor > 0);
  if (nums.length === 0) {
    return POR_RE.test(text) ? { kind: "price_on_request", text } : null;
  }
  const curs = currencyTokens(text);
  let best: { n: NumberToken; c: CurrencyCode | null; gap: number } | null =
    null;
  for (const n of nums) {
    for (const c of curs) {
      const gap =
        c.end <= n.start
          ? n.start - c.end
          : c.start >= n.end
            ? c.start - n.end
            : 0;
      if (gap <= 3 && (!best || gap < best.gap)) best = { n, c: c.code, gap };
    }
  }
  const chosen = best ?? {
    n: nums[0]!,
    c: curs.length === 1 ? curs[0]!.code : null,
    gap: 0,
  };
  return {
    kind: "price",
    amountMinor: chosen.n.minor,
    currency: chosen.c ?? (curs.length === 0 ? (expected ?? null) : null),
    text,
  };
}

/** A machine-readable price from JSON (9100, "8400.00", "CHF 7,000") in minor units. */
export function amountMinorFromJson(
  v: unknown,
  currency?: CurrencyCode,
): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    const minor = Math.round(v * 100);
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof v === "string") {
    // Plain decimal strings from schema.org ("8400.00") use a dot decimal mark.
    const plain = v.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (plain)
      return (
        Number(plain[1]) * 100 + Number((plain[2] ?? "").padEnd(2, "0") || "0")
      );
    const p = parsePrice(v, currency);
    return p?.kind === "price" ? p.amountMinor : null;
  }
  return null;
}

/** Formats minor units for logs and reports: 990000, CHF → "CHF 9,900". */
export function formatMinor(amountMinor: number, currency: string): string {
  const whole = Math.floor(amountMinor / 100).toLocaleString("en-GB");
  const cents = amountMinor % 100;
  return `${currency} ${whole}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}
