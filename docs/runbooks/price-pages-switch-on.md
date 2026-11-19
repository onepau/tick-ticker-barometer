# Switching the public price pages on

Everything public about prices (reference pages, the brand price section, `/prices`, the
increases report, methodology, `references.json`, sitemap entries, `price_url` in
the brand feed and the price section of `llms.txt`) sits behind two switches:

1. the Worker variable `PRICES_PUBLIC` in `apps/registry/wrangler.toml` (default `"0"`);
2. the per-brand column `brands.prices_public` (default NULL = off).

With either off a brand shows nothing about prices. With `PRICES_PUBLIC` off every price
route is a 404.

## Before the first deploy (December)

```bash
# Migration 0010 (editable intro text). Needs the owner's go-ahead.
# The remote database has no d1_migrations table (0001-0004 were applied with
# execute --file), so never use `migrations apply --remote`: it would re-run 0001.
npx wrangler d1 execute baromontres --remote --yes --file migrations/0010_site_text.sql
# Deploy with the flag still "0", then check these return 404:
#   /prices  /prices/methodology  /prices/increases-2027
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
   `/llms.txt`, `/sitemap.xml` (price URLs, `lastmod`).
5. Pages and feeds are cached for 5 minutes (feeds 1 hour); expect that delay.
6. Submit the sitemap again in Search Console.

## Switching off

Set `PRICES_PUBLIC = "0"` and redeploy. Price URLs return 404 and disappear from the
sitemap, feed and `llms.txt` (once the caches expire).

## Contact form and messages

`/contact` (also linked from the footer, the methodology and each reference page) stores
messages in `contact_messages`. It is not behind `PRICES_PUBLIC`. Apply the migration
remotely with `execute --file`, never `migrations apply --remote`:

```bash
npx wrangler d1 execute baromontres --remote --yes --file migrations/0011_contact_messages.sql
```

Until it is applied the form answers "Contact form unavailable" (503), not an error page.

Read, close and clean up (messages are deleted once dealt with, as the form promises):

```bash
npx wrangler d1 execute baromontres --remote --command "SELECT id, created_at, name, email, page, message FROM contact_messages WHERE status='new' ORDER BY id"
npx wrangler d1 execute baromontres --remote --command "UPDATE contact_messages SET status='done' WHERE id = 12"
npx wrangler d1 execute baromontres --remote --command "DELETE FROM contact_messages WHERE status='done' AND created_at < datetime('now', '-30 days')"
```

Optional: set your own salt for the signed form timestamp and the IP hash with a
`CONTACT_SALT` variable (or secret); a built-in default is used if it is unset.
Spam defences: hidden field, 4-second minimum fill time, five messages an hour per
hashed IP. No external service.
