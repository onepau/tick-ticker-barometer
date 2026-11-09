# Unit 5: brand survey for the price tracker

Researched 6 November 2026. Research only: no code, nothing loaded into D1. Companion file: `u5-reference-candidates.csv` (163 rows: 118 carried over, 40 new, 5 Rolex and Panerai examples).

## Columns

`u5-reference-candidates.csv` has one row per reference. The review columns are on the left.

| Column | Meaning |
| --- | --- |
| `brand`, `family`, `ref_code` | Brand, collection and the brand's reference number |
| `verified` | `FALSE` on every row. Paul sets it to `TRUE` once he has checked the row; it imports as a checkbox in Numbers, Excel and Google Sheets |
| `name` | Model name as shown on the site |
| `price_ch`, `price_fr`, `price_uk`, `price_us` | List price as a plain number in major units, no symbol and no thousands separator. The currency is implied by the market: CHF, EUR, GBP and USD. CH, FR and UK prices are shown with tax where the site says so; US prices exclude sales tax where the site says so (Breitling is the only brand that states it on the page). Blank means no page in that market. `POR` means the page exists but shows no price (price on request, or not available online) |
| `price_seen_on` | Date the prices were read from the page (`2026-11-06`) |
| `material`, `diameter_mm` | Case material and diameter. Blank where the page does not say, or where the case is not round |
| `url_ch`, `url_fr`, `url_uk`, `url_us` | Product page in each market. Blank means not sold there, missing from the sitemap, or not reached |
| `price_source` | `official` (default), `retailer:<domain>` or `manual` |
| `notes` | Short facts separated by semicolons |

How the prices were filled: from the pages saved on 6 November 2026 (JSON-LD, microdata or the visible price text), not from new requests. Spot checks against the survey figures agreed for ten sample references. The Rolex and Panerai example prices come from retailers and carry `price_source` `retailer:`.

## Method and etiquette

- `robots.txt` fetched first for every candidate. Product and collection pages were fetched only where `User-agent: *` does not disallow them.
- One request at a time per domain, 3 seconds apart, user agent `tick-ticker-price-research/1.0 (+https://tick-ticker.com)`. No personal email anywhere.
- Where a site answered 403 (a block), the brand was dropped. No cookie replay, no user agent change, no headless browser.
- Bulk URL checking was done by Haiku subagents (one per brand, about 80 to 110 requests each). Lead checks: one spot check per brand of a sampled product URL (HTTP 200, price visible) and a re-check of the three blocked sites.
- "Price in server HTML" means the price text appears in the response to a plain `curl`, so a plain `fetch` in a Worker should work.

## Result in one line

Round 1 kept seven brands and dropped five as bot-blocked. After Paul's decisions (Hamilton removed by Paul; Oris, Montblanc, Bell & Ross and Grand Seiko added): **Omega (CH only), Cartier, Longines, Tissot, Breitling, Rado, Oris and Grand Seiko are in the CSV**. Montblanc is blocked. Bell & Ross is rate-limited and not verified. Rolex and Panerai are covered through retailers (see "Rolex and Panerai options"). Every brand in the CSV serves prices in server HTML, so no JavaScript rendering is needed.

## Survey table

| Brand           | Prices published (CH / FR / UK / US)                                                                                                                  | `robots.txt` for product pages                                                                                                                                                      | Price in server HTML or JS                                                                                                    | Bot protection seen                                                    | Recommendation                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Omega           | CH yes (CHF). FR, UK, US not reached: `/fr-fr/`, `/en-gb/` and `/en-us/` all redirect to `/en-ch/` (geo redirect, `first_visit_auto_redirect` cookie) | `User-agent: *` then `Allow: /`. No sitemap line; `/sitemap.xml` is 404                                                                                                             | Server HTML (`span.price` "CHF 6’600" plus JSON-LD offers)                                                                    | Akamai Bot Manager cookies; no block in about 36 requests              | **Keep, CH only for now.** FR, UK and US need a decision from Paul (see open questions). Fetch for CH         |
| Cartier         | Yes in all four (CHF, EUR, GBP, USD)                                                                                                                  | Allowed. Disallowed: `/*/api`, `/*/search?q=*`, `/search/`, filter query strings (`prefn`, `cgid`, `dwvar`). Sitemap in robots                                                      | Server HTML plus JSON-LD in all four. US URLs end in `.html`                                                                  | Akamai and captcha strings in scripts; no challenge served             | **Keep. Fetch.** Pasha and Drive families show no products in the CH listing HTML, so they are not in the CSV |
| Longines        | Yes in all four                                                                                                                                       | `Allow: /`. Disallowed: `*?filter_*`, `*/reserve/*`, `*/gallery/*`, `*/watch-configurator/*`, `*/graphql?*=*`                                                                       | Server HTML plus JSON-LD offers. Do not call the GraphQL endpoint (disallowed)                                                | Akamai script loaded; no block in about 95 requests                    | **Keep. Fetch.** CH is `/fr-ch/` (no English CH path). FR sitemap is empty, so FR URLs were built from slugs  |
| Tissot          | Yes in all four                                                                                                                                       | No rule covers product pages. Disallowed: `/*cart*`, `/*search*`, `/*prefn*`, `/*start`, `view=grid`                                                                                | Server HTML plus JSON-LD offer                                                                                                | Cloudflare CDN, reCAPTCHA on forms only; no block                      | **Keep. Fetch.** CH is `/fr-ch/`. Top of range is thin (PRX Carbone at CHF 965 is the highest seen)           |
| Breitling       | Yes in all four                                                                                                                                       | Allowed on `/ch-en/`, `/fr-fr/`, `/gb-en/`, `/us-en/`. Disallowed: other country paths, `/*?interest=`, `/*/my-account/*/`. `Content-Signal: ai-train=no, search=yes, ai-input=yes` | Server HTML plus JSON-LD. Pages also embed a Saleor pricing state; no endpoint called                                         | Cloudflare passive challenge script on every page; no challenge served | **Keep. Fetch.** JSON-LD `priceValidUntil` was 2026-11-13, so do not use it as the observation date           |
| Rado (swap)     | Yes in all four. CH is `/fr_ch/` (`/en_ch/` returns 404)                                                                                              | Only `/catalogsearch/` disallowed                                                                                                                                                   | Server HTML. Read the displayed `<span class="price">`; on some GB pages `data-price-amount` differs from the displayed price | Akamai Bot Manager cookies; no block                                   | **Keep. Fetch.** Fewer references in CH and FR sitemaps                                                       |
| Oris (added) | Yes in all four. CH shows a price on 11 of 20 sampled models (the others say "not available online"), same for FR and UK; US prices all 20 | `User-agent: *` allows only locale prefixes (`/en-*`, `/de-CH`, `/fr-FR`, `/fr-CH`, `/$`, `/sitemap.xml`) then `Disallow: /`. Only `/de-CH/`, `/fr-FR/`, `/en-GB/`, `/en-US/` used | Server HTML plus `itemprop` microdata | None seen in about 114 requests | **Keep. Fetch.** Models without an online price keep their URL; expect no-price cells for about 9 of 20 outside the US |
| Grand Seiko (added) | CH, FR yes for all 20. UK and US yes for 17 of 20; three Masterpiece pieces (SBGD201, SBGD202, SBGZ003) show "Available at the Grand Seiko Boutiques" with no price | Empty rule set under `User-agent: *` (nothing disallowed) | Server HTML | None seen (Azure Front Door headers only) in about 90 requests | **Keep. Fetch.** Paths `/ch-fr`, `/fr-fr`, `/uk-en`, `/us-en` |
| Montblanc (added) | Not verified | Product pages not disallowed for `*`. Disallows `*pid=`, `*cgid=`, `*filter=`, `/*?q=`, `/api`, `*/search/*` | Not reachable | Every content request (sitemap index, homepage) was reset at the edge (HTTP/2 stream reset, curl error 92, no body). Not a 403, but effectively blocked | **Blocked, no rows.** Protocol and headers not changed. Paul to decide: retry later or drop |
| Bell & Ross (added) | FR and US homepages show card prices in server HTML (FR e.g. 4 300 €, US e.g. $4,500); CH and UK not fetched | `Allow: /`; no product-page disallow (cart, checkout, account, sorted or multi-filter collections disallowed) | Server HTML at card level; product pages not verified | Shopify behind Cloudflare. **HTTP 429** (`local_rate_limited`, `retry-after: 60`) after about 14 requests at one every 3 s | **Rate-limited (429, retry-after 60); not verified, retry in unit 6 at 1 request per minute.** No rows in the CSV. `/agents.md` is mentioned in robots.txt and was not read |
| Rolex           | Not verified: 403 on the product page and the market home page                                                                                        | Allowed for generic bots (disallows search, wishlist, dealer pages, `/content/rolex/`). `Crawl-delay: 2`                                                                            | Not reachable                                                                                                                 | 403 to a plain, honestly labelled request                              | **Drop** (blocked). Rolex is also not known for publishing list prices online                                 |
| Tudor           | Not verified: 403 on a product page and on `/en`                                                                                                      | Allowed (disallows `*?q=`, `*/search`, `*/wishlist`)                                                                                                                                | Not reachable                                                                                                                 | 403                                                                    | **Drop** (blocked)                                                                                            |
| TAG Heuer       | Not verified: 403 on `/ch/en/` and `/ch/en/watches`                                                                                                   | Crawl-delay 5. Disallows `/*pid*`, `/*cgid*`, `/*search*`, `/Product-Show/` and others                                                                                              | Not reachable                                                                                                                 | 403                                                                    | **Drop** (blocked)                                                                                            |
| IWC             | Not verified: `robots.txt` itself returns 403 (Akamai "Access Denied")                                                                                | Unknown                                                                                                                                                                             | Not reachable                                                                                                                 | Akamai block                                                           | **Drop** (blocked)                                                                                            |
| Panerai         | Not verified: `robots.txt` itself returns 403 (Akamai "Access Denied")                                                                                | Unknown                                                                                                                                                                             | Not reachable                                                                                                                 | Akamai block                                                           | **Drop** (blocked)                                                                                            |

Zenith and Hublot return 403 on `robots.txt` and were not pursued. Bell & Ross and Montblanc are covered in the table above. Hamilton (round 1 swap) was surveyed, passed all checks, and was then removed by Paul.

## Tax and currency

Paul's brief: CH, FR and UK prices include tax, US prices exclude it.

| Brand                            | What the pages say                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Breitling                        | Confirmed on page: CH "VAT Incl.", FR "TVA incluse", UK "VAT Incl.", US "Excl. Sales Tax"                                        |
| Rado                             | Price keys are incl. tax on UK, FR and CH; US script uses excl.-tax keys (inferred from Magento config, not checked at checkout) |
| Cartier, Omega, Longines, Tissot, Oris, Grand Seiko | Not stated on product pages. Cart strings suggest tax included outside the US. Needs a manual check                              |

All US list prices at these brands are very likely pre-sales-tax, as expected, but only Breitling states it on the page.

## Rolex and Panerai options

The official sites (rolex.com, panerai.com) block plain requests: 403 on Rolex product and home pages, 403 on Panerai `robots.txt` (Akamai). We do not work around that (no user-agent spoofing, no headless browser, no cookie replay). Options that stay within the rules, researched 6 November 2026:

**(a) Retailers publishing the brand's price.**

| Retailer | Markets | robots.txt | Price in server HTML | Verdict |
| --- | --- | --- | --- | --- |
| `www.watches-of-switzerland.co.uk` | UK | `User-agent: *` `Allow: /`; disallows `/cart`, `/search`, `/checkout`, `/my-account`, `/login`, `*q=` | Yes (`productPrice` span and JSON). Rolex pages say "Suggested retail price inclusive of V.A.T."; Panerai pages carry no RRP label | **Best source for UK, both brands.** About 212 Rolex URLs in its product sitemap |
| `www.bucherer.com` | CH, FR, US (`/ch/en`, `/fr/en`, `/us/en`) | Disallows `*/search*`, `/*?prefn=`, `/*?pid=`, `/*?cgid=`, `/*?context=`; product pages allowed | Yes for Rolex and Panerai, not "price on request". Does not call the price an RRP (assumption) | **Best source for CH, FR and US.** `/fr/` and `/us/` URLs are not in the sitemap but resolve; one product ID (Luminor Due 1316-095-1) showed different prices across locales that did not match the CH watch, so verify the reference on every locale page |
| `www.watchesofswitzerland.com` (US) | US | Same rules as UK | Not tested: HTTP 429 twice | Not usable without clearance |
| `pisa1940.com` | EU | Shopify defaults | Not tested: HTTP 429 | Not used |
| `www.wempe.com` | CH, FR, UK | `robots.txt` 403 (Akamai) | n/a | Blocked, not used |
| `www.jurawatches.co.uk`, Mappin and Webb | UK | Jura: Shopify defaults, product URL 404; Mappin and Webb: `robots.txt` redirects, not followed | n/a | Not used |

**(b) Manual capture.** Paul opens rolex.com or panerai.com for the market, notes the displayed price, takes a screenshot showing date and URL, and enters price, currency, tax basis and reference. About 1 minute per reference per market; for 3 references over 4 markets, about 24 captures. Workable quarterly and after January increases. Use it as the US cross-check and for anything the retailers do not list.

**(c) Press office or price list.** No public press or price-list contact found for either brand (Panerai lists customer-service routes only). Normally via accreditation or a PR agency per market. Nobody was contacted.

**Recommendation.**

| Brand | CH | FR | UK | US |
| --- | --- | --- | --- | --- |
| Rolex | retailer:www.bucherer.com | retailer:www.bucherer.com | retailer:www.watches-of-switzerland.co.uk | retailer:www.bucherer.com, with manual cross-check |
| Panerai | retailer:www.bucherer.com | retailer:www.bucherer.com | retailer:www.watches-of-switzerland.co.uk | retailer:www.bucherer.com, with manual cross-check |

Before relying on retailer prices as "official list prices", Paul should check 4 or 5 references on rolex.com and panerai.com in his own browser (for example UK Submariner Date against GBP 9,500) to confirm that the retailers match the brand's price. Retailer prices are retailer-published, not brand-published, and unit 6 should record that in `price_sources`.

**CSV.** Five example rows (Rolex Submariner Date 126610LN, Oyster Perpetual 36 126000, Datejust 36 126234; Panerai PAM01312, PAM00753) are marked "Example, Paul to confirm" with retailer URLs and the prices seen. Paul adds the rest. The new `price_source` column holds `official` (default), `retailer:<domain>` or `manual`.

## Pilot recommendation for unit 6

None of the kept brands needs JavaScript for prices, so there is no genuine JS-rendered pilot. Suggested pilots:

1. **Static: Cartier.** Four markets with consistent JSON-LD, 20 references, 18 with a US URL, no block seen. Good test of locale parsing (`CHF 7,000`, `8,300€`, `£7,250`, `$7,800`).
2. **Second pilot: Breitling** (four markets, VAT labelled on the page, JSON-LD) if Paul wants to stay on plain `fetch`. Omega would exercise the market-redirect problem (FR, UK and US redirect to CH) but edges towards working around a redirect, so Paul should decide that first.

## Open questions for Paul

1. **Montblanc.** Retry later (one slow request) or drop?
2. **Bell & Ross.** Retry in unit 6 at 1 request per minute, or drop?
3. **Omega FR, UK and US.** CH only, as decided.
4. **Rolex and Panerai.** Accept retailer prices (Bucherer, Watches of Switzerland UK) as the source, after Paul's check against the brand sites?
5. **Oris and Grand Seiko gaps.** Rows with no online price are kept, as instructed; expect empty price cells in unit 6.
6. Out-of-stock references (several Longines pages) are kept, as instructed.

## Caveats on the CSV

- URLs were fetched with HTTP 200 and matched on reference code by the subagents. I re-checked one URL per brand for the first seven brands (all 200, price visible); Oris, Grand Seiko and the Rolex and Panerai example URLs were checked by the subagents only.
- Blank URL cells mean the model is not sold in that market, was missing from the sitemap, or returned 404. Rows with gaps are kept.
- `diameter_mm` is blank for rectangular or square cases; dimensions are in `notes`. `material` is blank where the page does not state it.
- Oris references were picked from the sitemap by judgement, not from a bestseller list. Grand Seiko names are descriptive, taken from product copy.
- Prices are in the `price_*` columns, read from pages saved on 6 November 2026. They are list prices as displayed that day and have not been checked against a second source.
