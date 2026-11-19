// Capture calendar: which "capture period" a cron firing belongs to.
//
// One cron expression fires all day, every day (see wrangler.toml). A firing only
// does work while a capture period is open. A period is identified by its start
// (a UTC midnight); the cron run of a period is resumed across firings until every
// page has a snapshot, and a period gets at most one run.
//
//   - Monthly: the 1st of every month. Open for 3 days, as spare time for rate limits.
//   - Extra dates: the days in EXTRA_RUNS. Same 3 days, cut short by the next period.
//   - Daily ranges: every day in DAILY_RANGES. Open for that day only; a run left
//     unfinished is closed when the next day starts.
//
// To add a capture date, add it to EXTRA_RUNS (one day) or DAILY_RANGES (a stretch
// of days), run `pnpm test`, and redeploy the price Worker. See
// docs/runbooks/price-capture.md.

/** Extra single-day runs, UTC dates (YYYY-MM-DD). 29 December 2026 is the second December run. */
export const EXTRA_RUNS: readonly string[] = ["2026-12-29"];

/** Daily runs, inclusive UTC date ranges. 1 to 20 January 2027 dates the January price increases. */
export const DAILY_RANGES: readonly (readonly [from: string, to: string])[] = [
  ["2027-01-01", "2027-01-20"],
];

const DAY_MS = 86_400_000;
/** How long a monthly or extra period stays open for resuming (days). */
const SPAN_DAYS = 3;

const utcDay = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);

interface Candidate {
  start: number;
  days: number;
}

function candidates(now: Date): Candidate[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: Candidate[] = [{ start: Date.UTC(y, m, 1), days: SPAN_DAYS }];
  for (const d of EXTRA_RUNS) out.push({ start: utcDay(d), days: SPAN_DAYS });
  for (const [from, to] of DAILY_RANGES) {
    for (let t = utcDay(from); t <= utcDay(to); t += DAY_MS)
      out.push({ start: t, days: 1 });
  }
  return out;
}

/**
 * The start (ISO instant) of the capture period `now` falls in, or null when no
 * period is open. The latest start at or before `now` wins, so a later period
 * (the daily January runs, 29 December) closes the one before it.
 */
export function periodFor(now: Date): string | null {
  const t = now.getTime();
  let best: Candidate | null = null;
  for (const c of candidates(now)) {
    if (c.start <= t && (!best || c.start > best.start)) best = c;
  }
  if (!best || t >= best.start + best.days * DAY_MS) return null;
  return new Date(best.start).toISOString();
}
