# Price Worker

Captures official list prices for the tracked references in four markets (CH, FR, UK, US), with evidence for every figure. Worker name `tick-ticker-prices`; shares the `baromontres` D1 database. **Not deployed.** `workers_dev = false` and no route yet.

## How a price is captured

| Source                                                                                     | How                                                      | Stored as                                          |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| Brand site that allows it (Cartier, Breitling; more in unit 7)                             | Monthly cron fetches the product page with plain `fetch` | `method = 'fetch'`, `source = 'brand:<domain>'`    |
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

Cron `*/10 4-7 1 * *`: every 10 minutes from 04:00 to 07:50 UTC on the 1st of each month. Each invocation makes at most `MAX_REQUESTS_PER_INVOCATION` requests (40) within `INVOCATION_BUDGET_MS` (10 minutes), then the next one resumes the month's open run, skipping pages already captured. Up to 24 invocations a month, about 960 requests: enough for 561 pages plus `robots.txt`. A run left unfinished is closed when the next month starts.

Pages whose brand has no adapter yet (`price_sources.notes = 'adapter pending (unit 7)'`) are left out.

## Endpoints

| Path                   | Auth                        | What                                                                                                        |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`          | none                        | Liveness                                                                                                    |
| `POST /api/run`        | `Bearer RUN_TOKEN`          | Ad hoc run. Query: `brands=cartier,breitling`, `markets=CH,US`, `refs=<ids>`, `limit` (default 10, max 200) |
| `GET /api/report`      | `Bearer RUN_TOKEN`          | Last 10 runs and retailer prices without a brand capture                                                    |
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

## Adding a brand (unit 7)

1. Save one product page per market as a trimmed fixture in `tests/fixtures/` and write `src/adapters/<brand>.ts` with a `parse` that returns `status`, `amountMinor`, `priceText`, `taxLabel`, `refSeen` and the evidence parts. Check the reference and the currency; cross-check visible price against product data where both exist.
2. Register it in `src/adapters/index.ts` and in `ADAPTER_BY_HOST` in `scripts/references-sql.ts`, re-run the import.
3. Add fixture tests to `tests/adapters.test.ts`.

## Before the first deploy (Paul)

- Create the R2 bucket `tick-ticker-price-evidence`.
- `wrangler secret put RUN_TOKEN` and `wrangler secret put CAPTURE_TOKEN` (16+ random characters each).
- Choose the hostname (`PUBLIC_ORIGIN`, now `https://prices.tick-ticker.com`), add the route, and put `/capture` and `/api/*` behind Cloudflare Access if wanted (`/api/capture` already needs the token).
- Apply migration 0008 remotely after 0005–0007 (see the registry README about `d1_migrations` history), then the registry and reference seeds.
- Plan tier (still unconfirmed): each invocation makes up to 40 outgoing page requests plus D1 and R2 calls, and waits between requests for up to 10 minutes of wall-clock time. That fits the Workers Paid limits as I understand them (1,000 subrequests; cron invocations up to 15 minutes). On the Free plan (50 subrequests) check whether D1 and R2 binding calls count towards the limit, and lower `MAX_REQUESTS_PER_INVOCATION` and `INVOCATION_BUDGET_MS` if needed.
