# Unit 3 cutover: sharing prices.tick-ticker.com

Paul's decision: the registry Worker is the default on `prices.tick-ticker.com`; the price
Worker keeps only its own paths, through zone routes (routes take precedence over a custom
domain on the same hostname).

| Worker | Config | Serves |
| --- | --- | --- |
| `tick-ticker-registry` (`apps/registry`) | custom domain `prices.tick-ticker.com`, `PUBLIC_ORIGIN` | everything else: `/brand/*`, `/group/*`, `/brands*`, `/sitemap.xml`, `/robots.txt`, `/api/registry/v1/*` |
| `tick-ticker-prices` (`apps/prices`) | zone routes (`zone_name = "tick-ticker.com"`) | `/capture*`, `/bookmarklet.txt`, `/health`, `/api/capture*`, `/api/run*`, `/api/report*` |

The registry Worker serves none of the price Worker's paths.

## Constraints

- **Do not run during a capture period** (1st–3rd of a month, 29–31 December, 1–20 January):
  step 1 takes the capture paths down briefly.
- **Order matters.** The price Worker currently owns the custom domain.
- The price Worker must be redeployed from main **before 1 December** for unit 8 with its
  *current* custom domain. The `apps/prices/wrangler.toml` routing change is kept in its own
  commit in the unit 3 PR; merge that PR (or cherry-pick the registry commit alone) only after
  the 1 December redeploy.

## Steps

1. Deploy the price Worker with its routes. This removes its custom domain and DNS record.

   ```bash
   cd apps/prices && wrangler deploy
   ```

2. Deploy the registry Worker, which creates the custom domain and DNS record. The price
   routes then take precedence for their paths.

   ```bash
   pnpm build
   cd apps/registry && wrangler deploy
   ```

3. Do not seed or migrate remote D1 as part of this; load data as agreed separately.

## Checks (browser signed in through Access, or an Access service token)

| URL | Expect |
| --- | --- |
| `https://prices.tick-ticker.com/health` | price Worker JSON |
| `https://prices.tick-ticker.com/capture` | 302 to the Access login |
| `https://prices.tick-ticker.com/brands` | registry page, HTTP 200 |
| `https://prices.tick-ticker.com/api/registry/v1/brands.json` | JSON, `url` fields on `prices.tick-ticker.com` |
| `https://prices.tick-ticker.com/sitemap.xml` | XML listing brand URLs |

Rollback: redeploy the price Worker with its previous `routes = [{ pattern = "prices.tick-ticker.com", custom_domain = true }]`
after deleting the registry Worker's custom domain in the dashboard.
