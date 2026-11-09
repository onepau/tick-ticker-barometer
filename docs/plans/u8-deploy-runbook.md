# Price Worker: first deploy runbook

For Paul. Written 9 November 2026, after PRs #20 and #21 were merged (main at `342f2af`). Run the steps in order from the repo root unless a step says otherwise. Allow about 30–45 minutes.

## What I checked before writing this

- **Remote database (`baromontres`, read-only check).** It has the barometer tables (`article`, `sentiment`, `keyword`, `image_analysis`, `source`, `subscription_price`) and **no `d1_migrations` table**. That's because migrations 0001–0004 were applied with `execute --file`. So **do not use `wrangler d1 migrations apply --remote`**: it would try to re-run 0001. Apply 0005–0009 one file at a time, as below.
- **New tables only.** None of the tables in 0005–0009 exists remotely yet, and none clashes with a barometer table. The registry uses `brands` and the prices use `price_sources`, so neither touches the barometer's `source` table.
- **Migrations to run only once.** 0005, 0006, 0007 and 0009 use `IF NOT EXISTS`. 0008 rebuilds `price_sources` (it drops the table and renames a copy into its place), so **run 0008 exactly once**.
- **Seeds.** Both seeds are idempotent (upserts), so re-running them is safe.

## 1. Start from a clean main

```bash
git checkout main && git pull --ff-only
```

```bash
pnpm install && pnpm test && pnpm build
```

All four test suites must pass (221 tests) and the build must be clean.

## 2. Confirm the plan tier

Open Cloudflare dashboard → **Workers & Pages → Plans**.

- **Workers Paid:** nothing to change. Each run makes at most 40 page requests and lasts at most 10 minutes, which is within the Paid limits.
- **Free:** stop here and tell me. The price Worker needs `MAX_REQUESTS_PER_INVOCATION` and `INVOCATION_BUDGET_MS` lowered first (that's a code change).

## 3. Back up the remote database

```bash
mkdir -p ~/backups && npx wrangler d1 export baromontres --remote --output ~/backups/baromontres-before-prices.sql
```

D1 Time Travel can also restore the database to any minute in the last 30 days (`npx wrangler d1 time-travel restore baromontres --timestamp=<ISO time>`). The export is an extra copy that you keep.

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

This Worker has no static assets, so the web-worker rebuild rule in CLAUDE.md doesn't apply. Step 1 already ran the build.

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

## 11. Health checks

First make the run token available to the commands below, without saving it in your shell history: `read -s RUN_TOKEN`, then paste the token and press Enter.

```bash
curl -sf https://prices.tick-ticker.com/health
```

Expect `{"ok":true,"worker":"tick-ticker-prices"}`.

```bash
curl -sf -H "Authorization: Bearer $RUN_TOKEN" https://prices.tick-ticker.com/api/report
```

Expect 200 with JSON. On a fresh deploy the run list is empty.

Small live run (2 pages, Cartier CH):

```bash
curl -sf -X POST -H "Authorization: Bearer $RUN_TOKEN" "https://prices.tick-ticker.com/api/run?brands=cartier&markets=CH&limit=2"
```

Then repeat the `/api/report` call. Expect a run with 2 snapshots with status `ok`, each with an evidence key under `runs/…`. Compare the two prices with the CSV.

Bookmarklet: open `https://prices.tick-ticker.com/capture` (Access will ask you to sign in), install the bookmarklet, then capture one Rolex page as a test.

The barometer and cron Workers aren't redeployed, so their CLAUDE.md checks aren't needed. If you want to confirm the database changes didn't affect them, open `https://app.tick-ticker.com/api/barometer?limit=1` in your signed-in browser.

## 12. What happens next

- The cron fires every 10 minutes from 04:00 to 07:50 UTC on the 1st of each month. The first scheduled run is **1 December 2026**, which captures the 15 December baseline with two weeks to spare. Unit 8 will add the January runbook and the baseline review.
- If you'd like a full run sooner, call `/api/run` in batches (`limit` up to 200) and read `/api/report` after each.

## Rollback

- **Worker:** `cd apps/prices && npx wrangler rollback`, or `npx wrangler delete tick-ticker-prices` to remove it completely. Neither touches the database.
- **Database:** the new tables don't affect the barometer, so normally nothing needs undoing. If something did go wrong, restore with D1 Time Travel to a time before step 5, or from the export made in step 3.
