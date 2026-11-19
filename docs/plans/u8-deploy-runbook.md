# Price Worker: first deploy runbook

For Paul. Written 9 November 2026, after PRs #20 and #21 were merged, and adapted the same day for the **Workers Free** plan. Run the steps in order from the repo root unless a step says otherwise. Allow about 30–45 minutes.

## What I checked before writing this

- **Remote database (`baromontres`, read-only check).** It has the barometer tables (`article`, `sentiment`, `keyword`, `image_analysis`, `source`, `subscription_price`) and **no `d1_migrations` table**. That's because migrations 0001–0004 were applied with `execute --file`. So **do not use `wrangler d1 migrations apply --remote`**: it would try to re-run 0001. Apply 0005–0009 one file at a time, as below.
- **New tables only.** None of the tables in 0005–0009 exists remotely yet, and none clashes with a barometer table. The registry uses `brands` and the prices use `price_sources`, so neither touches the barometer's `source` table.
- **Migrations to run only once.** 0005, 0006, 0007 and 0009 use `IF NOT EXISTS`. 0008 rebuilds `price_sources` (it drops the table and renames a copy into its place), so **run 0008 exactly once**.
- **Seeds.** Both seeds are idempotent (upserts), so re-running them is safe.
- **Workers Free limits that matter here** (Cloudflare docs, checked 9 November): 10 ms CPU and 50 outgoing requests per invocation; 15 minutes wall time for a cron firing; 5 cron triggers per account; 100,000 Worker requests a day; D1 5 million rows read and 100,000 rows written a day (enforced since 1 September 2026); D1 Time Travel 7 days. The price Worker is now sized for these (see step 2).
- **CPU.** I timed every adapter on its fixture padded to about 580 KB: parsing takes 0.1–0.3 ms per page. With up to 5 pages per firing, the 10 ms CPU limit should hold, but it can only be confirmed on Cloudflare (step 11).

## 1. Start from a clean main

```bash
git checkout main && git pull --ff-only
```

```bash
pnpm install && pnpm test && pnpm build
```

All four test suites must pass (223 tests) and the build must be clean.

## 2. Workers Free: what changed and one check

Your plan is Free, so `apps/prices/wrangler.toml` is now sized for it:

- **One domain per firing, at most 6 requests** (robots.txt plus up to 5 pages), within 2 minutes. On Paid it was every domain at once, 40 requests and 10 minutes.
- **Cron every 10 minutes on the 1st to the 3rd** of each month (`*/10 * 1-3 * *`), instead of 04:00–07:50 on the 1st. The 561 pages need about 115 firings, so the run normally ends on the 1st (around 23:00 UTC); the 2nd and 3rd are margin for rate limits. Once the month's run is finished, a firing makes one database query and stops.
- **D1 load** stays far below the free daily limits: about 600 rows written for a full run, and a few hundred thousand rows read a day while it runs.

**Check before deploying:** Workers Free allows **5 cron triggers per account**. In the dashboard, open **Workers & Pages**, and for each Worker look at **Settings → Triggers → Cron Triggers**. I know of two (`baromontres-cron` and `gymtastic-worker`); gphg, onlywatch, citesite and the others may have more. If the count is already 5, step 8 fails with a cron limit error: tell me and we'll decide which to merge or drop.

## 3. Back up the remote database

```bash
mkdir -p ~/backups && npx wrangler d1 export baromontres --remote --output ~/backups/baromontres-before-prices.sql
```

D1 Time Travel can also restore the database to any minute in the last 7 days (Free plan) (`npx wrangler d1 time-travel restore baromontres --timestamp=<ISO time>`). The export is an extra copy that you keep.

## 4. Create the evidence bucket

```bash
npx wrangler r2 bucket create tick-ticker-price-evidence
```

## 5. Apply migrations 0005–0009 (once each, in order)

```bash
for f in 0005_registry_entities 0006_watch_references 0007_price_schema 0008_price_sources_manual 0009_run_reports; do npx wrangler d1 execute baromontres --remote --yes --file "migrations/$f.sql" || break; done
```

If one fails, the loop stops: send me the error and don't re-run 0008.

Check:

```bash
npx wrangler d1 execute baromontres --remote --command "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"
```

Expect the barometer tables plus: `brand_aliases`, `brand_people`, `brands`, `capture_runs`, `fx_rates`, `groups`, `price_markets`, `price_review_flags`, `price_snapshots`, `price_snapshots_countable` (view), `price_sources`, `reference_price_urls`, `run_reports`, `watch_references`.

## 6. Load the seeds (registry first, then references)

```bash
npx wrangler d1 execute baromontres --remote --yes --file apps/registry/seed/registry_seed.sql
```

```bash
npx wrangler d1 execute baromontres --remote --yes --file apps/prices/seed/references_seed.sql
```

Check the counts:

```bash
npx wrangler d1 execute baromontres --remote --command "SELECT (SELECT COUNT(*) FROM brands) brands, (SELECT COUNT(*) FROM watch_references) refs, (SELECT COUNT(*) FROM reference_price_urls) urls, (SELECT COUNT(*) FROM price_sources) sources"
```

Expect about 737 brands, 161 references, 561 URLs and 33 sources. If the numbers differ, send them to me before deploying.

## 7. Hostname

`prices.tick-ticker.com`, chosen 9 November. The route is already in `apps/prices/wrangler.toml` (PR "Price Worker: prices.tick-ticker.com route"), so merge that PR before deploying. Wrangler creates the DNS record and certificate on the first deploy, as long as the `tick-ticker.com` zone is on this Cloudflare account.

## 8. Deploy

```bash
cd apps/prices && npx wrangler deploy && cd ../..
```

This Worker has no static assets, so the web-worker rebuild rule in CLAUDE.md doesn't apply. Step 1 already ran the build. If the deploy fails with a cron trigger limit error, see step 2.

## 9. Set the two secrets

Each command prompts for the value. Generate each value with `openssl rand -hex 24` and keep both in your password manager.

```bash
cd apps/prices && npx wrangler secret put RUN_TOKEN && npx wrangler secret put CAPTURE_TOKEN && cd ../..
```

Until both are set, `/api/run`, `/api/report` and `/api/capture` refuse every request, so the Worker is safe in the gap between steps 8 and 9.

## 10. Put the capture page behind Access

Go to Zero Trust → **Access → Applications → Add → Self-hosted**:

- **Domain:** `prices.tick-ticker.com`, path `capture`
- **Policy:** Allow, with your email only

Leave `/health` open. The `/api/*` endpoints are already protected by the tokens. If you put them behind Access as well, curl calls will need a service token.

**Save the policy and the application**, then check:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://prices.tick-ticker.com/capture
```

Expect `302` with a redirect to `…cloudflareaccess.com/…/login/prices.tick-ticker.com…`. A `200` means Access isn't applied yet.

## 11. Health checks

First make the run token available to the commands below, without saving it in your shell history (zsh syntax; macOS's default shell). Paste the token at the prompt and press Enter; it should report length 48:

```bash
read -rs "RUN_TOKEN?Run token: "; echo; echo "token length: ${#RUN_TOKEN}"
```

Run everything below in the **same terminal tab**: the token only exists in that shell.

```bash
curl -sf https://prices.tick-ticker.com/health
```

Expect `{"ok":true,"worker":"tick-ticker-prices"}`.

```bash
curl -si -H "Authorization: Bearer $RUN_TOKEN" https://prices.tick-ticker.com/api/report | head -20
```

Expect `HTTP/2 200` and JSON. On a fresh deploy the run list is empty. `HTTP/2 401` means the token doesn't match the `RUN_TOKEN` secret from step 9: set it again.

Small live run (2 pages, Cartier CH):

```bash
curl -si -X POST -H "Authorization: Bearer $RUN_TOKEN" "https://prices.tick-ticker.com/api/run?brands=cartier&markets=CH&limit=2"
```

Then repeat the `/api/report` call. Expect a run with 2 snapshots with status `ok`, each with an evidence key under `runs/…`. Compare the two prices with the CSV.

CPU check (Free plan): in the dashboard, open **Workers & Pages → tick-ticker-prices → Observability** (or run `cd apps/prices && npx wrangler tail` during the test run). The test request must show outcome `ok`, not "Exceeded CPU". If it shows exceeded CPU, tell me: the fix is to lower `MAX_REQUESTS_PER_INVOCATION` from 6 to 4.

Manual runs on Free make at most 6 requests each, so always filter them to one brand and one market, as above.

Bookmarklet: open `https://prices.tick-ticker.com/capture` (Access will ask you to sign in), install the bookmarklet, then capture one Rolex page as a test.

The barometer and cron Workers aren't redeployed, so their CLAUDE.md checks aren't needed. If you want to confirm the database changes didn't affect them, open `https://app.tick-ticker.com/api/barometer?limit=1` in your signed-in browser.

## 12. What happens next

- The cron fires every 5 minutes, but only works inside a capture period: the 1st of each month (and the two days after, as spare time), 29 December 2026, and every day from 1 to 20 January 2027. The first scheduled run starts at 00:00 UTC on **1 December 2026** and should finish that day (about 10 hours), two weeks before the 15 December baseline deadline. On 2 December, check `/api/report`: the run should be finished, with coverage by brand and market. Then follow `docs/runbooks/price-capture.md` for the baseline checkpoint, the 29 December run and the January daily checks.
- On Free, a full run by hand isn't practical (5 pages per call, about 115 calls). Use manual runs only for spot checks.

## Rollback

- **Worker:** `cd apps/prices && npx wrangler rollback`, or `npx wrangler delete tick-ticker-prices` to remove it completely. Neither touches the database.
- **Database:** the new tables don't affect the barometer, so normally nothing needs undoing. If something did go wrong, restore with D1 Time Travel to a time before step 5, or from the export made in step 3.
