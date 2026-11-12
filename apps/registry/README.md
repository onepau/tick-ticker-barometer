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

## Wikidata review CSV (unit 2)

```bash
cd apps/registry
node scripts/wikidata-seed.ts            # one SPARQL query, cached in seed/wikidata-raw.json
node scripts/wikidata-seed.ts --refresh  # re-query Wikidata
```

Writes `docs/plans/u2-registry-review.csv`, one row per brand: every registry brand
(enriched when a Wikidata item matches) plus Wikidata-only brands. `match_confidence` is
`exact` (label slug equals a registry slug), `alias` (only an alias spelling matches),
`ambiguous` (several candidates, or two items claim one brand; the row is the Wikidata
item and `source` names the candidates), `new` or `none` (registry brand with no item).
`status_suggested` is `dead` when Wikidata has a dissolution date, otherwise `active`; it
is left blank for brands with no Wikidata item, since nothing is known. Paul fills
`corrections` and `status`. The script never writes to D1; loading the reviewed CSV is a
separate step. Companies are selected by industry (P452) horology or watchmaking, or
instance of "watch manufacturing company", so clockmakers may appear and need rejecting.

### Loading the reviewed CSV

Once Paul has filled `corrections` and `status`, do **not** re-run `wikidata-seed.ts`: it
regenerates the CSV and wipes the review. Instead:

```bash
cd apps/registry
node scripts/review-to-sql.ts --summary   # writes seed/registry_review.sql, prints counts
pnpm --filter @baromontres/registry db:migrate:local
pnpm --filter @baromontres/registry db:seed:local
pnpm --filter @baromontres/registry db:review:local   # local D1 only
```

Rules: `status` `reject` skips the row (Wikidata-only rows are not inserted, registry brands
are never deleted); otherwise `status`, else `status_suggested`, sets `brands.status`.
Wikidata facts only fill blanks; `corrections` (`field=value; field=`) overwrite, and an
empty value clears. Fields: `name`, `group`, `founded_year`, `dissolved_year`, `hq_city`,
`hq_country` (name or alpha-2), `website`, `wikidata_id`, `status`, `founders` (names
separated by `|`). `group=X` matches a group by name or slug and creates it if absent.
Existing ids and slugs never change, and the SQL is idempotent. Unknown fields, statuses
or malformed rows abort with the CSV line number.

Remote load is a separate, deliberate step. Note a Time Travel bookmark first
(`npx wrangler d1 time-travel info baromontres`), then:

```bash
npx wrangler d1 execute baromontres --remote --yes --file apps/registry/seed/registry_review.sql
```

Run `registry_seed.sql` and migrations 0005 and 0006 remotely before it (see the Seed note).

### Dead brands blog draft (placeholder)

Paul will supply `blog_post_dead_brands_draft.md`. Once it is in `apps/registry/seed/`:
extract the brand names, slugify them with `slugifyBrand`, check them against the CSV,
and append rows with `source` = `blog-dead-brands`, `status_suggested` = `dormant` or
`dead` (as the post says) and `match_confidence` = `new` or the matched slug's value.
Not implemented yet.

## Data credit

Brand facts (founding and dissolution dates, parent organisations, founders,
headquarters, websites) are partly taken from [Wikidata](https://www.wikidata.org), whose
structured data is available under the CC0 public domain dedication. Credit it on the
methodology page.
