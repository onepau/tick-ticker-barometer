# Unit 5: log of the price searches

Factual history of every attempt to find official list prices for watches, 6 November 2026, written from the session transcript and the subagents' written reports. No new request to any brand or retailer site was made to write this file.

## How to read this log

- **Verified by me** means the lead session ran the command itself and saw the output. **Reported by subagent** means a subagent wrote it in its report or survey file and I did not check it. Where a detail was not kept, it says **not recorded**.
- Times come from file modification times on the machine, which show Central European Time (CET, UTC+1). UTC is one hour earlier. Request-level timestamps were not kept, so times are given as ranges.
- "Price visible without a browser" means the price text was in the response to a plain `curl` request.

## 1. Method

**Tools.** Every request was a plain `curl` call run from the Bash tool on Paul's Mac (Darwin). Subagents used the same tool on the same machine. There was no browser, headless browser or browser automation at any point: no real browser was used to load any brand or retailer page. The only non-curl lookup was a web search by the Rolex and Panerai research agent to read search-result snippets (these are noted where used).

**Network.** Requests left from Paul's own computer and connection. The IP type (home or office, fixed or mobile) is **not recorded**. Two responses hint at a Swiss location (an inference, not a fact): Tissot's Cloudflare response carried the ray ID suffix `ZRH`, and Omega redirected FR, UK and US paths to its Swiss site.

**User agent.** One string for every request: `tick-ticker-price-research/1.0 (+https://tick-ticker.com)`. No browser user agent and no personal email address was used. The lead session's first robots.txt batch and all probes used this string (verified by me). The subagents' briefing required the same string and their reports state it (reported by subagent).

**Pacing.** One request at a time per domain. The lead used `sleep 2` between robots.txt requests and `sleep 3` between page requests (verified by me). Subagents were told `sleep 3` between requests and report keeping to it. One later Bell & Ross retry was told `sleep 10`.

**Agents.** Round 1: seven Haiku subagents, one per brand (Omega, Cartier, Longines, Tissot, Breitling, Hamilton, Rado), each with a budget of about 150 requests. Round 2: three Haiku agents (Oris, Montblanc, Grand Seiko), two Bell & Ross agents (one Haiku, one slower retry) and one Sonnet agent for the Rolex and Panerai retailer research. The first Omega agent started before its brief existed, did nothing and was relaunched.

**Timeline (CET).**

| Time           | What happened                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:34 to 15:37 | Lead fetched `robots.txt` for the ten candidate brands (15:34:49 to 15:35:09), probed one product or home page for eight of them (15:35:49 to 15:36:13), then fetched `robots.txt` for eight swap candidates (15:36:30 to 15:36:43) |
| 15:37 to 15:49 | Round 1 subagents ran; survey files written 15:43 to 15:49                                                                                                                                                                          |
| about 16:00    | Lead spot-checked one URL per brand and re-tested Rolex, Tudor and TAG Heuer (exact time **not recorded**)                                                                                                                          |
| 16:08 to 16:24 | Round 2 subagents ran; survey files written 16:14 to 16:24                                                                                                                                                                          |
| after 16:24    | Bell & Ross slow retry, stopped on instruction after about 11 tool calls                                                                                                                                                            |

**Deliberately not tried, and why.**

- No browser or headless browser: the brief said not to beat bot protection, and a headless browser would be an attempt to do so.
- No user-agent spoofing: every block was met with the same honest string, never a browser string.
- No cookie replay: Omega's geo redirect sets a `first_visit_auto_redirect` cookie; the agent did not send it back to reach FR, UK or US.
- No proxy, VPN or in-market IP: markets were not reached from other countries.
- No retries past a block: a 403 ended work on that domain. 429 responses were retried once or twice after a wait, then stopped.
- Omega's redirect was not bypassed.
- Disallowed paths were not requested (for example Longines `graphql` and `watch-configurator`, Montblanc `pid=` and `cgid=` URLs, Cartier `/api` and search).
- Contacting press offices, retailers or brands was not done.

## 2. Brand by brand, in the order attempted

Order is the order of the lead's first attempts, followed by the later brands and retailers. "robots" means the `robots.txt` request.

### Rolex (`www.rolex.com`)

- **robots** (verified by me, 15:34:49): `https://www.rolex.com/robots.txt` returned HTTP 200, 1,094 bytes. Under `User-agent: *`: `Crawl-delay: 2`; `Disallow: /search?`, `/wishlist`, `/content/rolex/`, `/corners/`, several dealer pages (for example `/*/rolex-dealers/*/buy-a-rolex-watch$`). Product pages are not disallowed.
- **Product page** (verified by me, about 15:35:49): `/en-ch/watches/submariner/m126610ln-0001` returned HTTP 403, 424 bytes: an "Access Denied" page naming `errors.edgesuite.net`, which is Akamai's error host.
- **Market home** (verified by me, about 16:00): `https://www.rolex.com/en-ch` returned HTTP 403 again.
- **Price seen:** none. No price was visible.
- **Protection:** Akamai "Access Denied" page. Cookie and header names not recorded.
- **Requests:** 3 (robots plus 2 pages). **Outcome:** blocked, dropped from direct fetching. Later handled through retailers (see below).

### Tudor (`www.tudorwatch.com`)

- **robots** (verified by me, 15:34:51): HTTP 200, 603 bytes. `User-agent: *` disallows `*?lat`, `*?q=`, `*?thematic=`, `*/search`, `*/wishlist`, `*/2024-products-training`. Product pages are not disallowed.
- **Product page** (verified by me, about 15:35:52): `/en/watches/black-bay-58/m79030n-0001` returned HTTP 403, 428 bytes, same Akamai "Access Denied" page.
- **Market home** (verified by me, about 16:00): `https://www.tudorwatch.com/en` returned HTTP 403.
- **Price seen:** none. **Requests:** 3. **Outcome:** blocked, dropped.

### Omega (`www.omegawatches.com`)

- **robots** (verified by me, 15:34:53): HTTP 200, 5,604 bytes. `User-agent: *` then `Allow: /`. `Disallow: /` lines apply only to named bots (for example `deepcrawl`, `meta-externalagent/1.1`, `heritrix`). No `Sitemap:` line.
- **Product page, my guess** (verified by me, about 15:35:55): a guessed `/en-ch/watch-omega-seamaster-diver-300m-...-21030422001001` URL returned HTTP 404 with a 393 KB page.
- **Lead spot check** (verified by me, about 16:00): a subagent-found CH product URL returned HTTP 200. The page response held the price but my grep pattern did not match its format, so I did not confirm the price text myself; the subagent's text was `CHF 6’600` (reported by subagent).
- **Geo redirect** (verified by me, about 16:00): `https://www.omegawatches.com/fr-fr/` ended at `https://www.omegawatches.com/en-ch/` with HTTP 200. The subagent captured the header: `location: https://www.omegawatches.com/en-ch/` and `x-redirect: auto-ecom`, with a `first_visit_auto_redirect` cookie. `/en-gb/` and `/en-us/` also ended at `/en-ch/` (reported by subagent).
- **Price seen:** CH yes in server HTML (`<span class="price">`) and JSON-LD `offers` on 20 of 20 pages (reported by subagent). FR, UK, US: not reached.
- **Protection:** Akamai Bot Manager cookies `_abck` and `bm_sz`; no 403, captcha or challenge in about 36 subagent requests (reported by subagent).
- **Requests:** about 36 by the agent plus 3 by me. **Outcome:** kept for CH only (Paul's decision); FR, UK and US not reached because of the redirect, which was not bypassed.

### Cartier (`www.cartier.com`)

- **robots** (verified by me, 15:34:56): HTTP 200, 5,874 bytes. Under `User-agent: *`: `Disallow: /*/api`, `/*/search?q=*`, `/*/search/*`, `/*/checkout`, `/*/account`, filter query strings. Product paths not disallowed.
- **Collection page** (verified by me, about 15:35:59): `/en-ch/watches/collections/tank/` returned HTTP 200, 874 KB, and the text `CHF 3,150` appeared in the HTML.
- **Product pages** (reported by subagent): CH, FR and UK all HTTP 200 for 20 of 20 references; US 18 of 20 (two returned 404). Sitemaps fetched: index, `en-ch`, `fr-fr`, `en-gb`; no `en-us` sitemap listed, `en-us.sitemap.xml` gave no response (code 000).
- **Lead spot check** (verified by me): a US product page returned HTTP 200 with `$7,800` visible.
- **Price seen:** server HTML plus JSON-LD in all four markets (reported by subagent). Example: CRWSSA0029 CHF 7,000, 8,300€, £7,250, $8,400.
- **Protection:** strings `akamai` and `captcha` in scripts; no 403 or challenge (reported by subagent).
- **Requests:** about 110 by the agent. **Outcome:** kept.

### IWC (`www.iwc.com`)

- **robots** (verified by me, 15:34:58): `https://www.iwc.com/robots.txt` returned HTTP 403, 375 bytes, an Akamai "Access Denied" page.
- **Price seen:** none; no page was fetched. **Requests:** 1. **Outcome:** blocked, dropped. Rules unknown.

### TAG Heuer (`www.tagheuer.com`)

- **robots** (verified by me, 15:35:00): HTTP 200, 15,800 bytes. Under `User-agent: *`: `Crawl-delay: 5`; `Disallow: /*pid*`, `/*cgid*`, `/*q=*`, `/*search*`, `/Product-Show/`, `/Cart-AddProduct/`, `/checkout/`, `/account/` and others.
- **Market home** (verified by me, about 15:36:02): `/ch/en/` returned HTTP 403, 382 bytes, Akamai "Access Denied". Re-test at about 16:00: `/ch/en/watches` also HTTP 403.
- **Price seen:** none. **Requests:** 3. **Outcome:** blocked, dropped.

### Longines (`www.longines.com`)

- **robots** (verified by me, 15:35:02): HTTP 200, 231 bytes. `User-agent: *`, `Allow: /`, `Disallow: *?filter_*`, `*/reserve/*`, `*/gallery/*`, `*/watch-configurator/*`, `*/graphql?*=*`.
- **Probe** (verified by me, about 15:36:06): a guessed `/ch-en/watches/` returned HTTP 404 (50 KB). There is no `/ch-en/`; Swiss paths are `/fr-ch/`, `/de-ch/`, `/it-ch/`.
- **Product pages** (reported by subagent): 200 in all four markets (`/fr-ch/`, `/fr/`, `/en-gb/`, `/en-us/`). The FR product sitemap is empty, so FR URLs were built from en-us slugs; one FR URL returned the French homepage. Several pages show OutOfStock.
- **Lead spot check** (verified by me): CH Spirit Chronograph page returned HTTP 200 with `CHF 3’500.00` visible.
- **Price seen:** server HTML and JSON-LD in all four markets (reported by subagent). **Protection:** Akamai script loaded, no block in about 95 requests (reported by subagent). **Outcome:** kept.

### Tissot (`www.tissotwatches.com`)

- **robots** (verified by me, 15:35:04): HTTP 200, 506 bytes. `Disallow: /*cart*`, `/*search*`, `/*prefn*`, `/*pmin`, `/*pmax`, `/*start`, `view=grid`, `view=list`, `/*checkout*` and others. Product pages not disallowed.
- **Probe** (verified by me, about 15:36:09): `/en-ch/` returned HTTP 404 (397 KB page) but the text contained prices (for example `775.00EUR`). The Swiss path is `/fr-ch/`.
- **Product pages** (reported by subagent): 200 in all four markets; one US page (Everytime) returned 404. Sitemap index lists only `fr-ch` sitemaps.
- **Lead spot check** (verified by me): a US product page returned HTTP 200 with `$450.00` visible.
- **Price seen:** server HTML and JSON-LD in all four markets (reported by subagent). **Protection:** Cloudflare CDN (`server: cloudflare`, ray ID `ZRH`), Salesforce Commerce Cloud cookies, reCAPTCHA script for forms; no challenge (reported by subagent). **Requests:** 84 by the agent. **Outcome:** kept.

### Breitling (`www.breitling.com`)

- **robots** (verified by me, 15:35:06): HTTP 200, 4,004 bytes. `User-agent: *` disallows many country paths (for example `/fr-en/`, `/gb-zh/`, `/ch-zh/`, `/us-es/`), `/*?interest=`, `/*/my-account/*/`. It carries `Content-Signal: ai-train=no, search=yes, ai-input=yes` (reported by subagent). The paths used (`/ch-en/`, `/fr-fr/`, `/gb-en/`, `/us-en/`) are allowed.
- **Probe** (verified by me, about 15:36:13): `/ch-en/watches/navitimer/` redirected to `/ch-en/collections/navitimer/`, HTTP 200, 1.2 MB. The strings `EUR 5,000` in it were loan-calculator copy, not a watch price (reported by subagent).
- **Product pages** (reported by subagent): all 78 requests HTTP 200. Coverage CH 20, UK 19, FR 18, US 15; missing models are absent from market sitemaps.
- **Lead spot check** (verified by me): a FR product page returned HTTP 200 with `250 €` visible in the match (a different amount in the page); the subagent's sample was `9 850 EUR` for AB0138211B1A1.
- **Price seen:** server HTML and JSON-LD in all four markets; tax labelled on page (CH and UK "VAT Incl.", FR "TVA incluse", US "Excl. Sales Tax") (reported by subagent). **Protection:** Cloudflare passive script `/cdn-cgi/challenge-platform/`; no challenge page (reported by subagent). **Outcome:** kept.

### Panerai (`www.panerai.com`)

- **robots** (verified by me, 15:35:09): `https://www.panerai.com/robots.txt` returned HTTP 403, 381 bytes, Akamai "Access Denied".
- **Price seen:** none from the brand site. **Requests:** 1. **Outcome:** blocked, dropped from direct fetching. Later handled through retailers.

### Hamilton (`www.hamiltonwatch.com`)

- **robots** (verified by me, about 15:36:32): HTTP 200, 2,338 bytes, 58 disallow lines. Relevant for `*`: `Disallow: */catalog/product/view/` and `Disallow: /*?` (any query string). Product URLs of the form `/<market>/h<code>-<slug>.html` are not caught (reported by subagent).
- **Product pages** (reported by subagent): all 80 product fetches HTTP 200; prices in server HTML (`itemprop` price) in all four markets. Strings `captcha` and `akamai` in scripts, no block. About 87 requests.
- **Outcome:** passed all checks, then removed from the list by Paul.

### Rado (`www.rado.com`)

- **robots** (verified by me, about 15:36:34): HTTP 200, 1,978 bytes. Only `Disallow: /catalogsearch/` for `*` (reported by subagent from the saved file).
- **Pages** (reported by subagent): US `/en_us/`, UK `/en_gb/`, FR `/fr_fr/` served prices in server HTML. `/en_ch/` is listed in a sitemap but its home and 5 product pages returned 404; `/fr_ch/` works. About 82 requests.
- **Lead spot check** (verified by me): a `/fr_ch/` product page returned HTTP 200 (my grep returned `0022CHF`, not a clean price; the subagent's sample was `2 050.00 CHF`).
- **Protection:** Akamai Bot Manager cookies `_abck` and `bm_sz` set; pages served normally (reported by subagent). **Outcome:** kept.

### Zenith (`www.zenith-watches.com`)

- **robots** (verified by me, 15:36:36): HTTP 403, 392 bytes, Akamai "Access Denied". No page fetched. **Outcome:** blocked, not pursued.

### Hublot (`www.hublot.com`)

- **robots** (verified by me, 15:36:41): HTTP 403, 380 bytes, Akamai "Access Denied". No page fetched. **Outcome:** blocked, not pursued.

### Oris (`www.oris.ch`)

- **robots** (verified by me, 15:36:30): HTTP 200, 2,433 bytes. Under `User-agent: *`: `Allow: /en-*`, `/de-CH`, `/fr-FR`, `/fr-CH`, `/$`, `/sitemap.xml`, followed by `Disallow: /`; so product pages are allowed only under those locale prefixes. `Crawl-delay: 10` applies only to named bots (reported by subagent).
- **Pages** (reported by subagent): about 114 requests (sitemap index of 33 pages, 80 product pages), all within allowed prefixes. Prices in server HTML plus `itemprop` microdata. CH, FR and UK show a price on 11 of 20 sampled models; the other 9 say the model is not available online. US shows a price on all 20.
- **Protection:** none observed; a reCAPTCHA key in the page config. **Outcome:** kept.

### Montblanc (`www.montblanc.com`)

- **robots** (verified by me, 15:36:43): HTTP 200, 2,420 bytes. For `*`: disallows `*pid=`, `*cgid=`, `*filter=`, `/*?q=`, `/api`, `*/search/*`, `/yTos/` (with `Allow: /yTos/Plugins/ItemPlugin/RenderItemPrice`). Sitemaps listed for en-hk, en-gb, en-us, en-ae, ar-sa, kr only.
- **Pages** (reported by subagent): `robots.txt` re-fetched fine. Then `/en-gb/sitemap_index.xml`, `/en-gb/` (twice, 3 s apart) and `/en-us/sitemap_index.xml` each failed with `curl: (92) HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`, code 000, 0 bytes. Not a 403 and not a captcha. Vendor not confirmed. 5 requests in total.
- **Outcome:** blocked at the edge, no retry with other protocols or headers, no rows in the CSV.

### Bell & Ross (`www.bellross.com`)

- **robots** (verified by me, 15:36:45): HTTP 200, 3,678 bytes. Under `*`: `Allow: /`; disallows `/cart/`, `/checkout`, `/account`, `/cart.js`, `/recommendations/products`, `/collections/*sort_by*`, multi-filter collections. The file points agents to `https://bellross.com/agents.md` and an `https://bellross.com/api/ucp/mcp` endpoint; neither was fetched.
- **Pages** (reported by subagent): Shopify store behind Cloudflare (`server: cloudflare`). FR homepage (`/`) and US homepage (`/en-us`) returned prices at card level in server HTML (for example `4 300€`; `$4,500.00`). After about 14 requests at one every 3 s, collection pages returned `HTTP/2 429`, body `local_rate_limited`, header `retry-after: 60`, repeatedly over about 6 minutes.
- **Slow retry** (reported by subagent): one request to the FR homepage returned 200; the next FR product page returned 429; after 120 s one retry returned 429 again. Stopped. About 11 tool calls.
- **Product pages:** none fetched, so no product URL is verified. CH and UK paths (`/en-ch`, `/en-uk`) were not fetched. A card price pairing looked wrong (BR 03 Rafale at 89 000 EUR) and was not checked.
- **Outcome:** rate-limited, not verified; retry in unit 6 at one request per minute.

### Grand Seiko (`www.grand-seiko.com`)

- **robots** (verified by me, about 15:36:39): HTTP 200, 13 bytes: `User-agent: *` with no rules.
- **Pages** (reported by subagent): about 90 requests, product pages HTTP 200 in all four markets (`/ch-fr`, `/fr-fr`, `/uk-en`, `/us-en`). Prices in server HTML (`<p class="_price">`). In the UK and US three Masterpiece pieces show no price ("Available at the Grand Seiko Boutiques and Grand Seiko Salons"). The all-collections page loads its list with JavaScript, so family pages were used.
- **Protection:** none observed; Azure Front Door headers only. **Outcome:** kept.

## 3. Retailers (all reported by the Rolex and Panerai research agent, Sonnet, about 75 requests, 6 November, round 2)

| Retailer                                                       | robots.txt                                                                                      | Pages                                                                                                                                                                                                                                                                                                                 | Outcome                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Bucherer (`www.bucherer.com`)                                  | `Disallow: */search*`, `/*?prefn=`, `/*?pid=`, `/*?cgid=`, `/*?context=`; product pages allowed | Rolex and Panerai pages HTTP 200 on `/ch/en/`, `/fr/en/` and `/us/en/`, prices in server HTML (some FR figures only in JSON). `/fr/` and `/us/` URLs are not in the sitemap; the agent built them by swapping the locale segment. One product ID (Luminor Due 1316-095-1) gave prices that did not match the CH watch | Usable for CH, FR, US     |
| Watches of Switzerland UK (`www.watches-of-switzerland.co.uk`) | `Allow: /`; disallows `/cart`, `/search`, `/checkout`, `/my-account`, `/login`, `*q=`           | Rolex and Panerai pages HTTP 200, price in server HTML and JSON; Rolex pages say "Suggested retail price inclusive of V.A.T."; Panerai pages have no such label                                                                                                                                                       | Usable for UK             |
| Watches of Switzerland US (`www.watchesofswitzerland.com`)     | same rules, HTTP 200                                                                            | Product page returned HTTP 429 `local_rate_limited` on the first call and again on a retry 10 s later. Search snippets showed Panerai prices; the agent did not fetch them                                                                                                                                            | Rate-limited, stopped     |
| Wempe (`www.wempe.com`)                                        | `robots.txt` returned HTTP 403 (Akamai "Access Denied")                                         | None                                                                                                                                                                                                                                                                                                                  | Blocked, stopped          |
| Pisa 1940 (`pisa1940.com`)                                     | HTTP 200, Shopify defaults, product paths allowed                                               | Product page returned HTTP 429; a search snippet showed a Panerai price                                                                                                                                                                                                                                               | Rate-limited, stopped     |
| Jura (`www.jurawatches.co.uk`)                                 | HTTP 200, Shopify defaults                                                                      | Product URL taken from a search result returned 404                                                                                                                                                                                                                                                                   | Not usable for that model |
| Mappin and Webb (`mappinandwebb.com`)                          | `robots.txt` returned a 301 redirect; not followed                                              | None                                                                                                                                                                                                                                                                                                                  | Not used                  |

Goldsmiths, Mayors, Hodinkee shop and Jura CH were not fetched (request budget). Official-site price display for Rolex and Panerai was taken from search results and public knowledge, not from the brand sites; the agent could not confirm current per-market display.

## 4. Summary table

Price visible without a browser: CH / FR / UK / US. "Yes" means in server HTML. "No page" means no product page was reached.

| Brand                     | robots.txt outcome                         | Page outcome                      | Protection seen                | Price visible without a browser                                    | Final status                        |
| ------------------------- | ------------------------------------------ | --------------------------------- | ------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| Rolex                     | 200, product pages allowed                 | 403                               | Akamai                         | no / no / no / no (no page)                                        | blocked, dropped; retailers instead |
| Tudor                     | 200, product pages allowed                 | 403                               | Akamai                         | no page in all four                                                | blocked, dropped                    |
| Omega                     | 200, `Allow: /`                            | CH 200; FR, UK, US redirect to CH | Akamai cookies                 | yes / no page / no page / no page                                  | kept, CH only                       |
| Cartier                   | 200, `/api` and search disallowed          | 200                               | Akamai strings, no challenge   | yes / yes / yes / yes                                              | kept                                |
| IWC                       | 403                                        | not attempted                     | Akamai                         | no page in all four                                                | blocked, dropped                    |
| TAG Heuer                 | 200, `pid` and search disallowed           | 403                               | Akamai                         | no page in all four                                                | blocked, dropped                    |
| Longines                  | 200, `graphql` and configurator disallowed | 200                               | Akamai script, no block        | yes / yes / yes / yes                                              | kept                                |
| Tissot                    | 200, cart and search disallowed            | 200                               | Cloudflare, reCAPTCHA on forms | yes / yes / yes / yes                                              | kept                                |
| Breitling                 | 200, other country paths disallowed        | 200                               | Cloudflare passive script      | yes / yes / yes / yes                                              | kept                                |
| Panerai                   | 403                                        | not attempted                     | Akamai                         | no page in all four                                                | blocked, dropped; retailers instead |
| Hamilton                  | 200, `/*?` disallowed                      | 200                               | none blocking                  | yes / yes / yes / yes                                              | removed by Paul                     |
| Rado                      | 200, `/catalogsearch/` disallowed          | 200 (CH only via `/fr_ch/`)       | Akamai cookies, no block       | yes / yes / yes / yes                                              | kept                                |
| Zenith                    | 403                                        | not attempted                     | Akamai                         | no page                                                            | blocked, not pursued                |
| Hublot                    | 403                                        | not attempted                     | Akamai                         | no page                                                            | blocked, not pursued                |
| Oris                      | 200, locale prefixes only                  | 200                               | none                           | partial / partial / partial / yes (9 of 20 unpriced in CH, FR, UK) | kept                                |
| Montblanc                 | 200, `pid=` and others disallowed          | connection reset (curl 92)        | edge reset, vendor unknown     | no page in all four                                                | blocked, no rows                    |
| Bell & Ross               | 200, `Allow: /`                            | 429, retry-after 60               | Cloudflare rate limit          | card level only: no page / yes (FR) / no page / yes (US)           | rate-limited, not verified          |
| Grand Seiko               | 200, empty                                 | 200                               | none (Azure Front Door)        | yes / yes / partial / partial (3 of 20 unpriced)                   | kept                                |
| Bucherer                  | 200, search and query strings disallowed   | 200                               | none seen                      | yes (Rolex and Panerai) in CH, FR, US                              | usable, retailer                    |
| Watches of Switzerland UK | 200, `Allow: /`                            | 200                               | none seen                      | yes in UK                                                          | usable, retailer                    |
| Watches of Switzerland US | 200                                        | 429                               | rate limit                     | no                                                                 | rate-limited                        |
| Wempe                     | 403                                        | not attempted                     | Akamai                         | no                                                                 | blocked                             |
| Pisa 1940                 | 200                                        | 429                               | rate limit                     | no                                                                 | rate-limited                        |
| Jura                      | 200                                        | 404                               | not recorded                   | no                                                                 | not used                            |
| Mappin and Webb           | 301                                        | not attempted                     | not recorded                   | no                                                                 | not used                            |

## 5. How to cross-check

Open these in your own browser. Expect the page to load with a price near the example, from the market you choose (your location may redirect you). A real browser may see things a plain request did not, which is itself the point of the comparison.

| Brand                     | Open                                                                                                                                                                                                                                                                                            | What to expect                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Rolex                     | `https://www.rolex.com/en-ch/watches/submariner/m126610ln-0001` and `https://www.rolex.com/robots.txt`                                                                                                                                                                                          | Our `curl` got a 403 "Access Denied". Check whether a price shows in your browser and in which markets     |
| Tudor                     | `https://www.tudorwatch.com/en/watches/black-bay-58/m79030n-0001`                                                                                                                                                                                                                               | `curl` got a 403                                                                                           |
| Omega                     | `https://www.omegawatches.com/en-ch/watch-omega-speedmaster-moonwatch-professional-co-axial-master-chronometer-chronograph-42-mm-31030425001001` and `https://www.omegawatches.com/fr-fr/`                                                                                                      | CH price `CHF 6’600` (reported). In a browser, see whether `/fr-fr/` stays on FR                           |
| Cartier                   | `https://www.cartier.com/en-ch/watches/collections/santos-de-cartier/santos-de-cartier-watch-CRWSSA0029`, same with `fr-fr` (`montre-santos-de-cartier-CRWSSA0029`), `en-gb`, and `https://www.cartier.com/en-us/watches/collections/santos-de-cartier/santos-de-cartier-watch-CRWSSA0029.html` | CHF 7,000; 8,300€; £7,250; $8,400 (reported)                                                               |
| IWC                       | `https://www.iwc.com/robots.txt`                                                                                                                                                                                                                                                                | `curl` got a 403                                                                                           |
| TAG Heuer                 | `https://www.tagheuer.com/ch/en/`                                                                                                                                                                                                                                                               | `curl` got a 403                                                                                           |
| Longines                  | `https://www.longines.com/fr-ch/p/watch-longines-spirit-l3-810-4-93-6` (and `/fr/`, `/en-gb/`, `/en-us/`)                                                                                                                                                                                       | CHF 2’100.00 for the L3.810.4.93.6 sample (reported); the Chronograph page showed CHF 3’500.00 in my check |
| Tissot                    | `https://www.tissotwatches.com/fr-ch/T1504101104100.html` (and `fr-fr`, `en-gb`, `en-us`)                                                                                                                                                                                                       | 285,00 CHF; 295,00 €; £285.00 (reported)                                                                   |
| Breitling                 | `https://www.breitling.com/ch-en/watches/navitimer/navitimer-b01-chronograph-43-my22/AB0138211B1A1/` (and `fr-fr`, `gb-en`, `us-en`)                                                                                                                                                            | 9 100 CHF; 9 850 EUR; GBP 8,150; USD 10,700, US excludes sales tax (reported)                              |
| Panerai                   | `https://www.panerai.com/robots.txt`                                                                                                                                                                                                                                                            | `curl` got a 403                                                                                           |
| Hamilton                  | `https://www.hamiltonwatch.com/en-gb/h11221114-american-classic-ardmore-quartz.html`                                                                                                                                                                                                            | GBP 515.00 (reported)                                                                                      |
| Rado                      | `https://www.rado.com/fr_ch/true-square-automatic-r27078172.html` (and `fr_fr`, `en_gb`, `en_us`)                                                                                                                                                                                               | 2 050.00 CHF; 2 400,00 €; £2,050.00; $2,450.00 (reported)                                                  |
| Zenith, Hublot            | `https://www.zenith-watches.com/robots.txt`, `https://www.hublot.com/robots.txt`                                                                                                                                                                                                                | `curl` got a 403                                                                                           |
| Oris                      | `https://www.oris.ch/de-CH/product/watch/divers/divers-sixty-five/01-733-7707-4053-07-8-20-18` (and `fr-FR`, `en-GB`, `en-US`)                                                                                                                                                                  | CHF 2'450.00 (CH), 2 450,00 EUR, GBP2,100.00, USD2,900.00 (reported)                                       |
| Montblanc                 | `https://www.montblanc.com/en-gb/`                                                                                                                                                                                                                                                              | `curl` got a stream reset, no body                                                                         |
| Bell & Ross               | `https://bellross.com/products/br-03-skeleton-steel` (FR) and `https://bellross.com/en-us/products/br-03-skeleton-steel`                                                                                                                                                                        | Card prices only, product pages unchecked; our requests hit a 429                                          |
| Grand Seiko               | `https://www.grand-seiko.com/ch-fr/collections/sbgx363g` (and `fr-fr`, `uk-en`, `us-en`)                                                                                                                                                                                                        | CHF 3,700.00; 3 700,00 EUR; GBP 3,200.00; USD 3,600.00 (reported)                                          |
| Bucherer                  | `https://www.bucherer.com/ch/en/rolex/watches/submariner/1335-897-7.html` (and `/fr/en/`, `/us/en/`)                                                                                                                                                                                            | CHF 10,150; €11,000; $11,350 for Submariner Date 126610LN (reported)                                       |
| Watches of Switzerland UK | `https://www.watches-of-switzerland.co.uk/Rolex/Submariner-Date-M126610LN+0001/p/17304447`                                                                                                                                                                                                      | £9,500.00 with "Suggested retail price inclusive of V.A.T." (reported)                                     |
| Others                    | `https://www.wempe.com/robots.txt` (403 reported); the WoS US and Pisa 1940 product pages (429 reported)                                                                                                                                                                                        | As reported                                                                                                |

## 6. Doubts and items not recorded

- Request-level times, exact request counts per brand and the IP type are **not recorded**. Counts are the agents' own approximations.
- The first Omega agent and all subagent figures are self-reported. Only the 18 robots.txt requests, 8 first probes, 11 spot checks, the 403 body files and the Bell & Ross header files (HTTP 429 with `server: cloudflare`) were seen by me directly.
- Hamilton and Rado "no block" statements cover the subagents' requests only; I did not test them beyond robots.txt and one page each.
- My Omega, Rado and Breitling spot-check price greps did not return clean price text, so those three prices rest on the subagents' reports.
- Cartier's US sample price is `$7,800` in my check and `$8,400` in the subagent's summary for a different reference; they are not a contradiction but should be matched by reference when cross-checking.
- Rolex and Panerai official-site price display is from search results and trade reports, not from the brand sites.

## 7. Round 3 (9 November 2026): filling the price columns

- **Requests made to any brand or retailer site: none.** Paul asked for separate price columns and a `verified` column. Every price was read from the HTML pages already saved on 6 November 2026 (rounds 1 and 2), using JSON-LD offers, `itemprop` microdata or the visible price text (reported by me; the extraction script ran locally).
- **Cross-check:** ten sample references (Cartier, Longines, Rado, Breitling, Omega, Grand Seiko, Tissot) agreed with the prices the subagents had reported on 6 November.
- **Corrections found while extracting:** a first pass over Omega JSON-LD returned prices for other items, and a first pass over Oris microdata returned strap prices on pages with no watch price. Both were fixed by reading the main visible price span (Omega) and by treating pages marked "no price shown" as `POR` (Oris).
- **Blocks:** none new. Every CSV row with a URL now has either a price or `POR`, so no gap needed a fetch.
- **Dates:** `price_seen_on` is `2026-11-06` for every row that has a price.

## 8. Paul's manual check (9 November 2026)

Paul checked the Rolex and Panerai rows by hand in his own browser, as a person, not through any tool.

- **Rolex:** prices on rolex.com match the retailer prices in the CSV for all three references (126610LN, 126000, 126234). rolex.com shows prices to a person in a browser (for example the Oyster Perpetual 36 page on the `fr-ch` locale), even though it returned 403 to the automated requests in round 1. The three Rolex rows are now `verified = TRUE`.
- **Panerai:** the two references found at retailers (PAM01312 Luminor Marina 44mm, PAM00753 Radiomir 45mm) are **not listed on panerai.com**, which does show prices for the watches it lists (Paul's example: the PAM01707 Luminor Marina page, https://www.panerai.com/ch/en/collections/watch-collection/luminor/pam01707-luminor-marina.html). Both rows were removed from the CSV; Panerai now has no rows until Paul adds current references.
- **Point for the blog:** a retailer listing is not proof that a reference is current. Two of two Panerai retailer finds were references the brand no longer shows.

## 9. Round 4 (9 November 2026, unit 6)

All requests used `tick-ticker-prices/1.0 (+https://tick-ticker.com)` (verified by me), from Paul's Mac, one at a time per domain, at least 3 s apart.

- **Bell & Ross, one retry at one request per minute.** 13:07:39 UTC, `https://bellross.com/products/br-03-skeleton-steel`: HTTP 429, body `local_rate_limited`, `retry-after: 60`, `server: cloudflare` on the first request. The rule was one retry, so no second request was made. **Bell & Ross is dropped** from the tracker; it can come back only through a press-office price list or a crawl permission.
- **Cartier and Breitling live pilot**, 13:08:50 to 13:08:57 UTC, through the unit 6 Worker code (`apps/prices/scripts/pilot-live.ts`): `robots.txt` for both domains (200), then CRWSSA0029 CH and US and AB0138211B1A1 CH and US (all 200). Six requests. All four prices equal the 6 November figures.
- **Tax labelling** (read from the pages saved on 6 November, no new requests):

| Brand       | CH                     | FR                      | UK                     | US                  | Where                                                                                       |
| ----------- | ---------------------- | ----------------------- | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Cartier     | "incl. VAT"            | "TVA incluse"           | "incl. VAT"            | none (empty label)  | `data-d-vat-i18` attribute, shown beside the price by script; US tax span empty             |
| Breitling   | "VAT Incl."            | "TVA incluse"           | "VAT Incl."            | "Excl. Sales Tax"   | Server HTML beside the price                                                                |
| Omega       | none beside the price  | not reached (CH only)   | not reached            | not reached         | Cart set to show subtotals including tax                                                    |
| Longines    | none beside the price  | none beside the price   | none beside the price  | none                | Cart strings only: "(TVA incluse)", "(VAT included)"; US cart shows "Tax" on top            |
| Tissot      | none                   | none                    | none                   | none                | Product page shows the price and "Add to cart" only                                        |
| Oris        | none                   | none                    | none                   | none                | Product page shows the price and reference only                                            |
| Grand Seiko | none                   | none                    | none                   | none                | Product page shows the price and collection only                                           |

Where a page says nothing, the price is taken as the market's usual retail convention (`price_markets.tax_included`: included in CH, FR and UK, excluded in the US). The Worker stores whatever wording it finds in `price_sources.tax_label` and on each snapshot.

## 10. Round 5 (9 November 2026, unit 7)

No block, 403, reset or repeated 429 met on any of the six brands. All requests used `tick-ticker-barometer`'s fetcher with `tick-ticker-prices/1.0 (+https://tick-ticker.com)`, `robots.txt` read and obeyed first, at least 3 s per domain, from Paul's Mac (verified by me, from the fetcher's own request log).

- **Fixture pages**, about 13:19 to 13:25 UTC, through `apps/prices/scripts/save-fixture.ts`: Longines `L2.286.4.52.6` in CH, FR, UK and US; Tissot `T1504101104100` CH and US; Rado `R32505313` CH and US; Omega `31030425001001` CH; Oris `4053` and `4064` CH and US; Grand Seiko `SBGX363` CH and US and `SBGD201` CH and US. All HTTP 200. 24 page requests plus `robots.txt` for six domains.
- **Live sample**, 13:27 UTC, `apps/prices/scripts/sample-live.ts`: 12 pages (two per brand) and the `robots.txt` files, 18 requests, all 200. Every price equals the 6 November figure. Listed in `docs/plans/u7-sample-prices.md`.
- **Markup found**: Longines JSON-LD plus `span[data-qa-id=product-price]`; Tissot (Salesforce) JSON-LD plus `span.ti-price-sales`; Rado and Omega on Magento (Rado microdata only, Omega JSON-LD with the main offer's `sku` on the offer and other variants in `addOn`); Oris Nuxt page with microdata in `div.stage-price` and `p.stage-button-info` for "not available online"; Grand Seiko plain HTML (`p._price`, no structured data).
- **Price on request**: Oris models "not available online" (message in the page's language) and Grand Seiko pages with a header but no `p._price` (for example SBGD201 in the US).
- **Tax wording**: unchanged from section 9; none of the six prints any beside the price on the product page.
