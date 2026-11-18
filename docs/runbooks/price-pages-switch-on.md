# Switching the public price pages on

Everything public about prices (reference pages, the brand price section, `/prices`, the
increases report, methodology, `references.json`, the CSV, sitemap entries, `price_url` in
the brand feed and the price section of `llms.txt`) sits behind two switches:

1. the Worker variable `PRICES_PUBLIC` in `apps/registry/wrangler.toml` (default `"0"`);
2. the per-brand column `brands.prices_public` (default NULL = off).

With either off a brand shows nothing about prices. With `PRICES_PUBLIC` off every price
route is a 404.

## Before the first deploy (December)

```bash
# Migration 0010 (editable intro text). Needs the owner's go-ahead.
cd apps/registry && npx wrangler d1 migrations apply baromontres --remote
# Deploy with the flag still "0", then check these return 404:
#   /prices  /prices/methodology  /prices/increases-2027  /prices/dataset.csv
#   /api/registry/v1/references.json  and that /sitemap.xml has no "/prices" URLs
```

Edit the report intro (no deploy):

```bash
wrangler d1 execute baromontres --remote --command \
  "UPDATE site_text SET body = 'First paragraph.' || char(10) || char(10) || 'Second paragraph.', updated_at = datetime('now') WHERE key = 'increases-2027-intro'"
```

## Switch-on (early January, after the first increases are captured)

1. Check the validation report of the daily run; resolve any open `price_review_flags`
   you have confirmed (flagged increases stay out of every public page until resolved).
2. Choose the brands: `wrangler d1 execute baromontres --remote --command "UPDATE brands SET prices_public = 1 WHERE slug IN ('omega','cartier',…)"`.
3. Set `PRICES_PUBLIC = "1"` in `apps/registry/wrangler.toml` and redeploy the registry Worker.
4. Check: a reference page, `/prices`, `/prices/increases-2027`, `/prices/methodology`,
   `/prices/dataset.csv`, `/llms.txt`, `/sitemap.xml` (price URLs, `lastmod`).
5. Pages and feeds are cached for 5 minutes (feeds 1 hour); expect that delay.
6. Submit the sitemap again in Search Console.

## Switching off

Set `PRICES_PUBLIC = "0"` and redeploy. Price URLs return 404 and disappear from the
sitemap, feed and `llms.txt` (once the caches expire).
