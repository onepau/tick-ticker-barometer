# Price capture runbook

For Paul. The price Worker `tick-ticker-prices` (prices.tick-ticker.com) captures list prices on a fixed calendar. This page says what to check and when, and what to do when something breaks. Design and sizing: `apps/prices/README.md`.

## The calendar

The cron fires every 5 minutes but only works inside a capture period (UTC). A full run takes about 10 hours.

| Date                    | What happens                                      | What you do                                                                                  |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1 Dec 2026              | Baseline run starts at 00:00, ends the same day   | Nothing                                                                                      |
| 2 Dec                   | (the run may spill over to 2 and 3 December)      | Check the report: run finished, coverage by brand and market                                 |
| By 15 Dec               | Baseline deadline                                 | Checkpoint: decide whether coverage is good enough to publish. Fix adapters, re-run brands   |
| 29 Dec                  | Second December run                               | Check the report on 30 Dec: changes since 1 Dec                                              |
| 1 to 20 Jan 2027        | One full run a day                                | Check each morning: run finished, changes and outliers. A change dates a price increase     |
| 21 Jan onwards          | Back to monthly, on the 1st                       | Nothing                                                                                      |

Rolex and Panerai prices come only from your bookmarklet (see below). Capture them before each checkpoint, and again when the daily runs show a retailer price moving.

If a run is not finished at the end of its period, it is closed as unfinished and the next period starts a new one. The report counts the missing pages as `not_attempted`.

## Run the token command first

Every command below needs the run token. In zsh, without saving it in your history:

```bash
read -rs "RUN_TOKEN?Run token: "; echo; echo "token length: ${#RUN_TOKEN}"
```

Use the same terminal tab for the commands that follow.

## Trigger a run by hand

```bash
curl -si -X POST -H "Authorization: Bearer $RUN_TOKEN" "https://prices.tick-ticker.com/api/run?brands=cartier&markets=CH&limit=5"
```

Query parameters: `brands` (slugs, comma separated), `markets` (`CH`, `FR`, `UK`, `US`), `refs` (reference ids), `limit` (default 10, maximum 200). On the Workers Free plan a call makes at most 6 outgoing requests (robots.txt included) and works one domain, so use **one brand and one market per call**. A manual run is closed at the end of the call and gets its own report. It does not touch the scheduled run.

## Read the report

```bash
curl -s -H "Authorization: Bearer $RUN_TOKEN" https://prices.tick-ticker.com/api/report | jq .
```

Add `?run=ID` for an older run. The parts:

- **runs**: the last 10 runs. Check `finished_at` is set and `counts.remaining` is 0. `closed_unfinished` in the counts means the period ended first.
- **report.coverage**: reference × market cells with an `ok` price, as a share, overall and by brand and market. The other statuses (`price_on_request`, `unavailable`, `error`, `not_attempted`) say why the rest are empty.
- **report.changes**: cells whose price differs from the previous capture, largest first. In January, this is the list of increases.
- **report.outliers**: held back from publication until you check them. `change_over_15` (price moved more than 15%), `currency_mismatch` (the page showed another currency) and `retailer_unconfirmed`.
- **open_review_flags**: every unresolved outlier. Open the brand page, check the price, then release the snapshot (SQL in the README, "Validation report").
- **unconfirmed_retailer_prices**: Rolex and Panerai retailer prices that don't count yet because the reference has no manual capture from the brand's own site. Fix with the bookmarklet.

## Fix a broken adapter

A brand with many `error` or `unavailable` cells usually means the site changed its markup.

1. Save a current page as a fixture: `node apps/prices/scripts/save-fixture.ts apps/prices/tests/fixtures name=url` (it fetches politely, with the usual delays).
2. Update the adapter in `apps/prices/src/adapters/<brand>.ts` so the fixture parses. Add or update the test in `apps/prices/tests/adapters.test.ts`.
3. `pnpm test` and `pnpm build` must both pass.
4. Merge, then redeploy: `cd apps/prices && npx wrangler deploy`.
5. Re-run the brand (next section).

Never retry a 403 and never work around a block. If a site refuses us, the brand goes to the bookmarklet.

## Re-run a single brand

Use the manual trigger above, one market per call, once for each of CH, FR, UK and US:

```bash
for m in CH FR UK US; do curl -s -X POST -H "Authorization: Bearer $RUN_TOKEN" "https://prices.tick-ticker.com/api/run?brands=cartier&markets=$m&limit=200" | jq '{runId, attempted, remaining, counts}'; done
```

With `limit=200` each call stops after its 6 requests, so a brand with more pages than that needs repeat calls. Manual runs skip nothing already captured: they are a fresh run each time. For a full re-capture of a period, do not wait for the next period: add a capture date (below).

## Add a Rolex or Panerai price with the bookmarklet

1. Open `https://prices.tick-ticker.com/capture` (Access asks you to sign in) and drag **tick-ticker capture** to your bookmarks bar. The first time, paste the `CAPTURE_TOKEN`.
2. Open the brand's product page yourself, in the market you want.
3. Click the bookmarklet, confirm the reference and the price, choose the market if the URL has none, and **Save capture**.
4. Check the reply: reference, amount in minor units, evidence key.

Details and fallbacks (unknown reference, blocked hand-over) are in the README, "Bookmarklet".

## Add a capture date

The calendar is two lists in `apps/prices/src/calendar.ts`:

- `EXTRA_RUNS`: single extra days, for example `"2027-03-15"`.
- `DAILY_RANGES`: a stretch of daily runs, for example `["2027-07-01", "2027-07-20"]`.

Add the date (UTC), add a line to the tests in `apps/prices/tests/calendar.test.ts`, run `pnpm test` and `pnpm build`, merge, then redeploy with `cd apps/prices && npx wrangler deploy`. No migration and no cron change: the single `*/5 * * * *` trigger covers every date. A date already in the past does nothing.

## If a run does not start

- Check the date is inside a period (calendar above) and the Worker is deployed with the `*/5 * * * *` trigger (dashboard, Workers & Pages, tick-ticker-prices, Settings, Triggers).
- `npx wrangler tail tick-ticker-prices --format pretty` shows each firing's log line: run id, `resumed`, `remaining`, `requests`.
- "Exceeded CPU" on firings: lower `MAX_REQUESTS_PER_INVOCATION` from 6 to 4 in `apps/prices/wrangler.toml` and redeploy. A firing then reads 3 pages, so a run needs about 190 firings (about 16 hours), still inside a day.
