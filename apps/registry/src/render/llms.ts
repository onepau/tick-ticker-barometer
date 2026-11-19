/**
 * /llms.txt: a plain-text guide for language models and other crawlers (llmstxt.org
 * format: title, summary, then sections of links). The price section appears only while
 * PRICES_PUBLIC is on.
 */
import { DATASET_LICENSE_NAME, DATASET_LICENSE_URL, PRICE_REPORTS } from "@baromontres/shared/price-public";

export function llmsTxt(origin: string, prices: boolean): string {
  const lines = [
    "# tick-ticker brand registry and list-price tracker",
    "",
    "> An independent, English-language registry of watch brands (ownership, founding, status) with, where published, dated official list prices of new watches in Switzerland, France, the United Kingdom and the United States. Part of tick-ticker.com. Not affiliated with any brand and not a seller of watches.",
    "",
    "## Brand registry",
    "",
    `- [All brands](${origin}/brands): A–Z index, filterable by status and group.`,
    `- [Dormant and defunct brands](${origin}/brands/dormant-and-defunct): brands that have stopped or paused, and revivals.`,
    `- [Registry feed: brands](${origin}/api/registry/v1/brands.json): JSON, one entry per brand with slug, group, status and canonical URL.`,
    `- [Registry feed: groups](${origin}/api/registry/v1/groups.json): JSON, one entry per watch group.`,
    `- [Sitemap](${origin}/sitemap.xml)`,
    "",
    "Each brand page (`/brand/<slug>`) states founding and dissolution years, parent group, headquarters, official site and a Wikidata link where known. Brand facts come from public records and Wikidata (CC0) and are reviewed by hand.",
  ];
  if (prices) {
    lines.push(
      "",
      "## List prices",
      "",
      `- [Price index](${origin}/prices): tracked brands and references.`,
      `- [Methodology](${origin}/prices/methodology): sources, capture frequency, tax treatment, exchange rates, corrections.`,
      ...PRICE_REPORTS.map(
        (r) => `- [Price changes in ${r.year}](${origin}/prices/${r.slug}): every list-price change since the ${r.baselineLabel} baseline, by brand, market and percentage.`,
      ),
      `- [Registry feed: references](${origin}/api/registry/v1/references.json): JSON, one entry per tracked reference with its price page URL.`,
      "",
      "Reference price pages (`/prices/<brand>/<reference>`) show the official list price in each market with tax stated (VAT included in Switzerland, France and the United Kingdom; sales tax excluded in the United States), the date last checked, the source (the brand's site or a named authorised retailer) and the price history. Prices are never a quote: tick-ticker sells no watches. Cite the page and its check date.",
    );
  }
  return lines.join("\n") + "\n";
}
