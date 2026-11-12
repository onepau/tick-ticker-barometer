# Price Worker

Captures official list prices for the tracked references in four markets (CH, FR, UK, US), with evidence for every figure. Worker name `tick-ticker-prices`; shares the `baromontres` D1 database. Runbook: `docs/runbooks/price-capture.md`.

## How a price is captured

| Source                                                                                     | How                                                      | Stored as                                          |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| Brand site that allows it (Cartier, Breitling, Longines, Tissot, Rado, Omega CH, Oris, Grand Seiko)                            | Cron fetches the product page with plain `fetch` | `method = 'fetch'`, `source = 'brand:<domain>'`    |
| Authorised retailer (Bucherer CH, FR, US; Watches of Switzerland UK) for Rolex and Panerai | Same cron                                                | `method = 'fetch'`, `source = 'retailer:<domain>'` |
| Rolex and Panerai brand sites                                                              | Paul's bookmarklet, on a page he opened himself          | `method = 'manual'`, `source = 'brand:<domain>'`   |

A retailer price only **counts** once the same reference has an `ok` manual capture from the brand's own site: that is the check that the reference is still in the brand's catalogue. Query `price_snapshots_countable` (migration 0008) rather than `price_snapshots` for anything published. `GET /api/report` lists retailer prices still waiting for a brand capture.

Evidence goes to the R2 bucket `tick-ticker-price-evidence` under `runs/<run>/<brand>/<reference>/<market>[--<source>].html`: an HTML extract of the product data, price and tax wording for fetched pages, the whole page for bookmarklet captures. Its SHA-256 is stored in `price_snapshots.content_hash`.

## Etiquette (enforced in `src/polite-fetch.ts`, tested)

- User agent `tick-ticker-prices/1.0 (+https://tick-ticker.com)`. No personal email, no browser string, no cookies, no headless browser, no proxy.
- `robots.txt` is read once per domain per invocation and obeyed, including `Crawl-delay`; the result is recorded in `price_sources.robots_ok` and `robots_rules`.
- One request at a time per domain, at least 3 s apart (never less, whatever `MIN_DELAY_MS` says).
- 429 and 5xx: back off (honouring `Retry-After`) up to two retries, never waiting more than 2 minutes; a page still refused waits for the next invocation.
- 403: never retried; the domain is left alone for the rest of the invocation.

## Schedule

One cron trigger, `*/5 * * * *` (the Free plan allows five per account, shared with other Workers). `src/calendar.ts` turns each firing into a capture period or nothing:

| Period                  | Dates (UTC)                  | Open for                        |
| ----------------------- | ---------------------------- | ------------------------------- |
| Monthly                 | the 1st of every month       | 3 days (spare time for limits)  |
| Second December run     | 29 December 2026             | until 31 December               |
| Daily January runs      | 1 to 20 January 2027         | that day only                   |

The 1 December 2026 run is the baseline (due by 15 December). A period gets one run: each firing resumes the period's open run, skipping pages already captured, and does nothing once it has finished. A run left unfinished is closed when the next period starts. Outside every period a firing exits at once, with no D1 query. Add a date in `EXTRA_RUNS` or `DAILY_RANGES` in `src/calendar.ts` (see `docs/runbooks/price-capture.md`).

Each working firing handles one domain, rotating (`MAX_HOSTS_PER_INVOCATION`), with at most `MAX_REQUESTS_PER_INVOCATION` requests (6, robots.txt included) within `INVOCATION_BUDGET_MS` (2 minutes). 561 pages need about 115 firings (5 pages each), so a run takes about 10 hours at one firing per 5 minutes; a day has 288 firings, so a daily run has 2.5 times the firings it needs. Requests to one domain stay at least 3 s apart.

Workers Free sizing per day of a daily run: 288 firings (100,000 requests a day allowed), about 690 outgoing requests (50 per invocation allowed), about 1.2 million D1 rows read (5 million allowed) and roughly 5,000 rows written (100,000 allowed). The page-to-capture query reads the run's snapshots once (`NOT IN`), not once per URL.

Pages whose host has no adapter are left out of a run (`ADAPTER_BY_HOST` in `scripts/references-sql.ts` marks them `adapter pending` when the seed is built). All eight sources now have one; Bell & Ross and Montblanc are out (blocked), and Rolex, Tudor and other blocked brands are not fetched.

## Endpoints

| Path                   | Auth                        | What                                                                                                        |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`          | none                        | Liveness                                                                                                    |
| `POST /api/run`        | `Bearer RUN_TOKEN`          | Ad hoc run. Query: `brands=cartier,breitling`, `markets=CH,US`, `refs=<ids>`, `limit` (default 10, max 200) |
| `GET /api/report`      | `Bearer RUN_TOKEN`          | Last 10 runs, the validation report of a run (`?run=ID`, default the latest), snapshots held for review, retailer prices without a brand capture |
| `GET /capture`         | none (put it behind Access) | Capture page with the bookmarklet                                                                           |
| `GET /bookmarklet.txt` | none                        | The bookmarklet as text                                                                                     |
| `POST /api/capture`    | `Bearer CAPTURE_TOKEN`      | Store a manual capture                                                                                      |

Both tokens are Worker secrets of at least 16 characters; if one is unset, its endpoints refuse every request. All responses carry `X-Robots-Tag: noindex, nofollow`.

## Bookmarklet

### Install

1. Open `https://<prices host>/capture` (the host is still to be chosen; see below).
2. Drag the **tick-ticker capture** link to the bookmarks bar.
3. The first time you save a capture, paste the `CAPTURE_TOKEN` into the token field. The capture page keeps it in that browser's local storage; the bookmarklet itself contains no secret.

### Use

1. Open a Rolex or Panerai product page yourself, in the market you want (for example `https://www.rolex.com/en-ch/watches/submariner/m126610ln-0001`).
2. Click **tick-ticker capture**. It reads the reference (from the URL or the page's product data) and the displayed price and asks you to confirm or correct both. For Rolex, `m126610ln-0001` becomes `126610LN`; if the price differs by dial, type the full code instead.
3. A capture window opens with the URL, reference, price, the tax wording it found and the size of the page copy. Check them; choose the market if the URL has no locale.
4. **Save capture.** The reply shows the reference, the amount in minor units and the evidence key.

If the reference is not in the list yet, tick **Add this reference** and give the brand slug (`rolex` or `panerai`) and the model name; the endpoint refuses unknown references otherwise.

If a site stops the hand-over (the window opens empty), the bookmarklet copies the data to the clipboard instead: paste it into the box on the capture page and save.

It never opens brand pages, never runs on its own and never requests anything from the brand site. Manual capture is limited to `www.rolex.com` and `www.panerai.com` (`MANUAL_HOSTS` in `src/capture.ts`).

## Local development

```bash
pnpm --filter @baromontres/prices test
pnpm --filter @baromontres/prices build              # typecheck
node apps/prices/scripts/import-references.ts       # CSV -> seed/references_seed.sql
pnpm --filter @baromontres/prices db:migrate:local
pnpm --filter @baromontres/registry db:seed:local   # brands first (same local state dir needed)
pnpm --filter @baromontres/prices db:seed:local
pnpm --filter @baromontres/prices dev                # wrangler dev --test-scheduled
node apps/prices/scripts/pilot-live.ts               # 4 live pages + 2 robots.txt; writes nothing
```

The import reads `docs/plans/u5-reference-candidates.csv` (161 references, 561 product URLs, 33 sources) and upserts, so it can be re-run. Local only: do not run the seed against the remote database before Paul says so.

## Adapters

One file per source in `src/adapters/`; each keeps the quirks of its site in its header comment (markup, robots.txt rules, tax wording).

| Source      | Adapter file          | Markets         | Where the price comes from                                                              | Price on request                                      |
| ----------- | --------------------- | --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Cartier     | `cartier.ts`          | CH FR UK US     | JSON-LD offer, visible price, tax attribute                                             | "price on request" text                               |
| Breitling   | `breitling.ts`        | CH FR UK US     | JSON-LD offer, visible price, tax label                                                 | visible text                                          |
| Longines    | `longines.ts`         | CH FR UK US     | JSON-LD offer, `span[data-qa-id=product-price]`                                         | none seen                                             |
| Tissot      | `tissot.ts`           | CH FR UK US     | JSON-LD offer, `span.ti-price-sales`                                                    | none seen                                             |
| Rado        | `rado.ts`             | CH FR UK US     | microdata `meta[itemprop=price]`, `span.price` (no JSON-LD)                              | none seen                                             |
| Omega       | `omega.ts`            | **CH only**     | JSON-LD main offer (other variants in `addOn` ignored), `span.price`                    | none seen                                             |
| Oris        | `oris.ts`             | CH FR UK US     | microdata in `div.stage-price` (strap options in the carousel are ignored)              | "not available online" message, no price block        |
| Grand Seiko | `grand-seiko.ts`      | CH FR UK US     | `p._price` (no structured data; reference and currency checked)                         | header and collection but no `p._price`               |
| Bucherer, Watches of Switzerland UK | `bucherer.ts`, `watches-of-switzerland.ts` | retailers for Rolex and Panerai | see the file headers | n/a |

Longines, Tissot, Rado and Omega share `adapters/storefront.ts`: it finds the offer for the reference, checks the reference and the currency, reads the amount from the structured data, refuses a page whose visible price disagrees, and keeps the evidence. A brand file only names its anchors. Oris uses it too, and Grand Seiko, which has nothing structured to cross-check, has its own reader.

Omega is tracked for CH only (Paul's decision): its FR, UK and US paths redirect to the Swiss site, which is not bypassed, and the adapter refuses any other market.

Tax wording: Cartier, Breitling and the retailers print it; Longines, Tissot, Rado, Omega, Oris and Grand Seiko print none beside the price on the product page, so `tax_label` stays empty and the market convention (`price_markets.tax_included`) applies. See `docs/plans/u5-price-search-log.md`, section 9.

## Validation report

When a run finishes (a manual run at once, a cron run when nothing is left), the Worker builds a report, stores it in `run_reports` and serves it on `GET /api/report` (`Bearer RUN_TOKEN`; `?run=ID` for an older run).

- **Coverage**: reference × market cells of the run's scope with an `ok` snapshot, as a share, overall and by brand and market, with the other statuses counted (`price_on_request`, `unavailable`, `error`, `not_attempted`).
- **Changes**: each cell whose `ok` price differs from its previous `ok` price (same cell, same source), with the percentage change, largest first.
- **Outliers**, held for manual review and not published meanwhile:
  - `change_over_15`: the price moved by more than 15% either way (the exact ratio is compared, not the rounded figure);
  - `currency_mismatch`: the page showed another currency than the market's (the adapter refused it), the snapshot is not in the market's currency, or the cell switched currency;
  - `retailer_unconfirmed`: a retailer price for a reference with no `ok` manual capture from the brand's own site.

Each outlier gets a row in `price_review_flags`. Snapshots stay append-only; the view `price_snapshots_countable` (the one to read for anything published) skips a snapshot while its flag is unresolved. To release a snapshot after checking it, set the flag's `resolved_at` and `resolution`:

```bash
wrangler d1 execute baromontres --remote --command "UPDATE price_review_flags SET resolved_at = datetime('now'), resolution = 'checked on the brand site' WHERE id = 12"
```

## Adding a brand

1. Save one product page per market as a trimmed fixture in `tests/fixtures/` (`scripts/save-fixture.ts <dir> name=url ...` fetches through the polite fetcher) and write `src/adapters/<brand>.ts` with a `parse` that returns `status`, `amountMinor`, `priceText`, `taxLabel`, `refSeen` and the evidence parts. Check the reference and the currency; cross-check visible price against product data where both exist; handle price on request.
2. Register it in `src/adapters/index.ts` and in `ADAPTER_BY_HOST` in `scripts/references-sql.ts`, then `pnpm seed:build`.
3. Add fixture tests to `tests/adapters.test.ts`.
4. `node scripts/sample-live.ts` fetches a few pages live (nothing is written) for a spot check against the site.

## Before the first deploy (Paul)

- Create the R2 bucket `tick-ticker-price-evidence`.
- `wrangler secret put RUN_TOKEN` and `wrangler secret put CAPTURE_TOKEN` (16+ random characters each).
- Hostname: `prices.tick-ticker.com` (route set in `wrangler.toml`). Put `/capture` and `/api/*` behind Cloudflare Access if wanted (`/api/capture` already needs the token).
- Apply migration 0008 remotely after 0005–0007 (see the registry README about `d1_migrations` history), then the registry and reference seeds.
- Plan tier: **Workers Free** (Paul, 9 November 2026). `wrangler.toml` is sized for it: 10 ms CPU and 50 outgoing requests per invocation, so each cron firing works one domain (`MAX_HOSTS_PER_INVOCATION = "1"`) with at most 6 requests, robots.txt included, every 5 minutes inside a capture period (see Schedule). Parsing a 580 KB page takes about 0.3 ms, so CPU should fit; if Workers Observability shows "Exceeded CPU" on firings, lower `MAX_REQUESTS_PER_INVOCATION` to 4. Manual `/api/run` calls use the same caps: filter to one brand and market. On Workers Paid, set 40 requests, remove `MAX_HOSTS_PER_INVOCATION`, and a shorter schedule is enough.
