# Registry Worker

Public brand registry (working hostname `prices.tick-ticker.com`, not confirmed). Binds
the same D1 database as `baromontres` but, unlike it, is public. Not deployed yet.

## Feed

| Path                           | Contents                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `/api/registry/v1/brands.json` | `id`, `slug`, `name`, `group`, `status`, canonical `url`, `price_url`     |
| `/api/registry/v1/groups.json` | `id`, `slug`, `name`, `wikidata_id`, `website`, canonical `url`, `brand_count` |

Both are wrapped as `{ version, generated_at, count, items }` and sent with
`Cache-Control: public, max-age=3600`, through the Cache API on the custom domain.
Consumers should use the precomputed `slug` and `url` rather than slugifying names.

## Pages

Server-rendered HTML, English only, no client script, no `hreflang`. Code in `src/render/`
(layout and CSS adapted from the GPHG Index); routes in `src/app.ts`.

| Path | Contents |
| ---- | -------- |
| `/brand/<slug>` | Facts panel (group, founded, dissolved, status, headquarters, key people, site, Wikidata), links to the brand's GPHG and Only Watch pages (from `brand_aliases`), `Organization` + `BreadcrumbList` JSON-LD. Empty facts are left out; a name-only brand gets a short note. Price section is a stub (`priceSectionHtml`) for unit 10. |
| `/group/<slug>` | A group and its brands. `/group/independent` lists brands with no group. |
| `/brands` | A–Z index. Filters `?status=` (active, dormant, defunct, revived, unknown; `dead` redirects to `defunct`) and `?group=` (a group slug or `independent`). Filtered views are `noindex` and canonical to `/brands`. |
| `/brands/dormant-and-defunct` | Brands with status dormant, defunct or revived (`/brands/dormant-and-dead` 301s here), linking to the journal posts `gphg-dead-brands` and `gphg-comeback-brands`. |
| `/sitemap.xml`, `/robots.txt` | Every brand and group URL, plus the three list pages. |

Status naming: the database keeps `dead` (schema CHECK); the site, the filter and the feed say `defunct`. The feed's `status` is `active`, `dormant`, `defunct`, `revived` or null (v1 not yet deployed, so no break).

Brands with only a name (no group, years, status, headquarters, website, Wikidata id or people; `isNameOnly` in `packages/shared/src/registry.ts`) are `noindex,follow` and left out of the sitemap, but stay listed and linked. They become indexable as soon as they have any fact.

Unknown slugs get an HTML 404 (`/api/*` keeps JSON). Upper-case slugs 301 to lower case,
as on GPHG. Pages go through the Cache API for five minutes, keyed on path plus the two
filter parameters. Canonical URLs use `PUBLIC_ORIGIN` (a var) or, by default,
`REGISTRY_ORIGIN` in `packages/shared/src/registry.ts`; both are the working hostname
until Paul confirms it.

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
