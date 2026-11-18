// ECB euro foreign exchange reference rates, once a day.
//
// The ECB publishes its reference rates on TARGET working days at about 16:00 CET and
// serves them as a small XML file. The public price pages convert regional prices to CHF
// with them (never to overwrite a captured price). One request a day is all this makes:
//
//   - not at weekends (the ECB does not publish);
//   - not before 15:30 UTC (16:30 CET, a margin after the ECB's 16:00 CET) and not after
//     20:00 UTC, so a day the ECB is late or closed costs a bounded number of attempts;
//   - not again once a marker for the day exists in R2 (written after any answer from the
//     ECB, including "no new rates today": a TARGET holiday still shows the previous
//     date) or once D1 already holds a rate for the day.
//
// A failed request (network error, non-200) leaves no marker, so the next firing of the
// 5-minute cron tries again, up to the 20:00 UTC cut-off.

import { upsertFxRate } from "@baromontres/shared";
import { USER_AGENT } from "./polite-fetch.ts";

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
/** Currencies stored against EUR: the other three market currencies. */
export const FX_CURRENCIES = ["CHF", "GBP", "USD"] as const;

/** First UTC minute of the day at which a fetch is allowed (16:30 CET = 15:30 UTC). */
export const FETCH_FROM_UTC_MINUTES = 15 * 60 + 30;
/** Last UTC minute (exclusive) at which a fetch is still attempted. */
export const FETCH_UNTIL_UTC_MINUTES = 20 * 60;

export interface EcbRates {
  /** ECB reference date, YYYY-MM-DD. */
  date: string;
  rates: Record<string, number>;
}

/**
 * Parses eurofxref-daily.xml: `<Cube time="2026-12-01"><Cube currency="USD" rate="1.0602"/>…`.
 * Returns only the currencies we store; null when the date or a required rate is missing.
 */
export function parseEcbDaily(xml: string): EcbRates | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const cur = m[1]!;
    if ((FX_CURRENCIES as readonly string[]).includes(cur)) {
      const rate = Number(m[2]);
      if (Number.isFinite(rate) && rate > 0) rates[cur] = rate;
    }
  }
  if (!FX_CURRENCIES.every((c) => rates[c] !== undefined)) return null;
  return { date, rates };
}

/** Pure part of the once-a-day guard: is `now` inside the daily fetch window? */
export function inFetchWindow(now: Date): boolean {
  const dow = now.getUTCDay(); // 0 Sunday, 6 Saturday
  if (dow === 0 || dow === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= FETCH_FROM_UTC_MINUTES && minutes < FETCH_UNTIL_UTC_MINUTES;
}

export const fxMarkerKey = (day: string): string => `fx/${day}.json`;

export type FxOutcome =
  | { status: "skipped"; reason: "outside_window" | "marker" | "have_today" }
  | { status: "stored"; date: string; stale: boolean }
  | { status: "failed"; reason: string };

export interface FxOptions {
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * One scheduled attempt. Cheap when there is nothing to do: outside the window it makes
 * no subrequest at all; inside it, one R2 read (and one D1 read) until the day is done.
 */
export async function runFxFetch(
  db: D1Database,
  bucket: R2Bucket,
  opts: FxOptions = {},
): Promise<FxOutcome> {
  const now = (opts.now ?? (() => new Date()))();
  if (!inFetchWindow(now)) return { status: "skipped", reason: "outside_window" };
  const day = now.toISOString().slice(0, 10);

  if (await bucket.get(fxMarkerKey(day))) return { status: "skipped", reason: "marker" };
  const have = await db
    .prepare(`SELECT 1 AS ok FROM fx_rates WHERE base = 'EUR' AND date = ? LIMIT 1`)
    .bind(day)
    .first<{ ok: number }>();
  if (have) return { status: "skipped", reason: "have_today" };

  let xml: string;
  try {
    const res = await (opts.fetch ?? fetch)(ECB_DAILY_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/xml, application/xml" },
    });
    if (!res.ok) return { status: "failed", reason: `http ${res.status}` };
    xml = await res.text();
  } catch (e) {
    return { status: "failed", reason: `fetch: ${(e as Error).message}` };
  }
  const parsed = parseEcbDaily(xml);
  if (!parsed) return { status: "failed", reason: "unparseable" };

  for (const currency of FX_CURRENCIES) {
    await upsertFxRate(db, { date: parsed.date, currency, rate: parsed.rates[currency]! });
  }
  // `stale`: the ECB still shows an earlier date (TARGET holiday, or not yet updated).
  // The marker stops further requests today either way.
  const stale = parsed.date < day;
  await bucket.put(fxMarkerKey(day), JSON.stringify({ fetched_at: now.toISOString(), ecb_date: parsed.date }));
  return { status: "stored", date: parsed.date, stale };
}
