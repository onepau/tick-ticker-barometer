# Registry Worker

Public brand registry (working hostname `registry.tick-ticker.com`, not confirmed). Binds
the same D1 database as `baromontres` but, unlike it, is public. Not deployed yet.

## Feed

| Path                           | Contents                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `/api/registry/v1/brands.json` | `id`, `slug`, `name`, `group`, `status`, canonical `url`, `price_url`     |
| `/api/registry/v1/groups.json` | `id`, `slug`, `name`, `wikidata_id`, `website`, canonical `url`, `brand_count` |

Both are wrapped as `{ version, generated_at, count, items }` and sent with
`Cache-Control: public, max-age=3600`, through the Cache API on the custom domain.
Consumers should use the precomputed `slug` and `url` rather than slugifying names.

## Slugs

`slugifyBrand` (`packages/shared/src/slug.ts`) reproduces the live GPHG slug for all
725 GPHG brands, so `/brand/<slug>` URLs line up. Reference slugs are
`<brand-slug>/<normalised-ref-code>`, for example `omega/310-30-42-50-01-001`.

## Seed

```bash
pnpm seed:registry                                    # rebuild seed/registry_seed.sql
pnpm --filter @baromontres/registry db:migrate:local  # fresh local D1
pnpm --filter @baromontres/registry db:seed:local
```

The script reads `~/tick-ticker-gphg` and `~/tick-ticker-onlywatch` (override with
`GPHG_DIR` and `ONLYWATCH_DIR`) and writes Only Watch brands with no registry match to
`docs/plans/u1-unmatched-brands.csv`. Put `new` or an existing registry slug in its
`resolution` column and re-run. The seed is idempotent and never renumbers brands.

Remote: `migrations 0001`–`0004` were applied with `d1 execute --file`, so the remote
database may have no `d1_migrations` history. Check before using `migrations apply
--remote`; `execute --file` on 0005 and 0006 is the safe route.
