/**
 * Public price pages (unit 9): /prices/<brand-slug>/<ref-slug>.
 *
 * Complete server-rendered HTML: the current prices, the change history and the regional
 * comparison are all in the markup. The Chart.js line chart is an optional enhancement
 * over the same numbers. The structured data describes the watch (Product, no Offer: this
 * site sells nothing) and the price series (Dataset).
 */
import {
  DATASET_LICENSE_URL,
  MARKET_NAME,
  TAX_TEXT,
  buildMarketSeries,
  convertToChf,
  dayOf,
  formatMoney,
  getFxSnapshot,
  getPublicReference,
  listMarkets,
  listPublicSnapshots,
  sourceLabel,
  type FxSnapshot,
  type MarketSeries,
  type PublicReference,
  type SeriesPoint,
} from "@baromontres/shared/price-public";
import { crumbs, escapeHtml, layout } from "./html.ts";
import { breadcrumbLd, safeUrl, type Page } from "./pages.ts";

export const METHODOLOGY_PATH = "/prices/methodology";
/** Pinned Chart.js from cdnjs, with the subresource hash cdnjs publishes for this file. */
export const CHARTJS_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
export const CHARTJS_SRI =
  "sha512-CQBWl4fJHWbryGE+Pc7UAxWMUMNMWzWxF4SQo9CgkJIN1kx6djDQZjh3Y8SZ1d+6I+1zze6Z7kHXO7q3UyZAWw==";

export const referenceTitle = (r: PublicReference): string =>
  `${r.brand_name} ${r.name ?? r.family ?? ""}`.replace(/\s+/g, " ").trim();

/** The price, or the status that stands in for it. */
export const priceText = (p: SeriesPoint): string =>
  p.status === "price_on_request"
    ? "Price on request"
    : p.status === "unavailable"
      ? "Not available online"
      : p.amount_minor != null
        ? formatMoney(p.amount_minor, p.currency)
        : "";

export function pctText(from: number, to: number): string {
  const pct = Math.round(((to - from) / from) * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function currentCards(series: MarketSeries[]): string {
  return `<div class="pricecards">${series
    .map((s) => {
      const ok = s.latest.status === "ok";
      const lastListed =
        !ok && s.lastOk
          ? `<div class="s">Last listed price: ${escapeHtml(priceText(s.lastOk))}, on ${dayOf(s.lastOk.captured_at)}</div>`
          : "";
      const link = safeUrl(s.latest.source_url);
      return `<div class="pricecard"><span class="k">${escapeHtml(MARKET_NAME[s.market])}</span><div class="amt">${escapeHtml(priceText(s.latest))}</div>${lastListed}
<div class="s">${ok ? `${TAX_TEXT(s.taxIncluded)} · ` : ""}checked ${dayOf(s.latest.captured_at)}</div>
<div class="s">Source: ${
        link
          ? `<a href="${escapeHtml(link)}" rel="noopener nofollow">${escapeHtml(sourceLabel(s.source))}</a>`
          : escapeHtml(sourceLabel(s.source))
      }</div></div>`;
    })
    .join("")}</div>`;
}

function historyTable(series: MarketSeries[]): string {
  type Row = { market: MarketSeries; p: SeriesPoint; prev: SeriesPoint | null };
  const rows: Row[] = [];
  for (const s of series)
    s.changes.forEach((p, i) =>
      rows.push({ market: s, p, prev: i ? s.changes[i - 1]! : null }),
    );
  rows.sort((a, b) =>
    a.p.captured_at === b.p.captured_at
      ? 0
      : a.p.captured_at < b.p.captured_at
        ? 1
        : -1,
  );
  const body = rows
    .map(({ market, p, prev }) => {
      let change = "First capture";
      let cls = "";
      if (prev) {
        if (
          p.status === "ok" &&
          prev.status === "ok" &&
          prev.amount_minor &&
          p.amount_minor &&
          prev.currency === p.currency
        ) {
          change = pctText(prev.amount_minor, p.amount_minor);
          cls = p.amount_minor > prev.amount_minor ? "up" : "down";
        } else change = "Status change";
      }
      return `<tr><td>${dayOf(p.captured_at)}</td><td>${escapeHtml(MARKET_NAME[market.market])}</td><td class="num">${escapeHtml(priceText(p))}</td><td class="num ${cls}">${change}</td><td>${escapeHtml(sourceLabel(market.source))}</td></tr>`;
    })
    .join("");
  const checks = series
    .map((s) => `${MARKET_NAME[s.market]} ${s.checks}`)
    .join(", ");
  return `<div class="tablewrap"><table class="data"><caption>The first capture in each market and every later change of price or status, newest first. Checks so far: ${escapeHtml(checks)}.</caption>
<thead><tr><th>Date</th><th>Market</th><th class="num">List price</th><th class="num">Change</th><th>Source</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function comparisonSection(series: MarketSeries[], fx: FxSnapshot): string {
  const priced = series.filter(
    (s) => s.latest.status === "ok" && s.latest.amount_minor != null,
  );
  if (priced.length < 2) return "";
  const rows = priced.map((s) => ({
    s,
    conv: convertToChf(s.latest.amount_minor!, s.latest.currency, fx),
  }));
  if (rows.some((r) => !r.conv)) return "";
  const ch = rows.find((r) => r.s.market === "CH")?.conv;
  const rateDates = [...new Set(rows.map((r) => r.conv!.rateDate))].sort();
  const body = rows
    .map(({ s, conv }) => {
      const vs =
        s.market === "CH"
          ? "Reference"
          : ch
            ? pctText(ch.chfMinor, conv!.chfMinor)
            : "";
      return `<tr><td>${escapeHtml(MARKET_NAME[s.market])}</td><td class="num">${escapeHtml(formatMoney(s.latest.amount_minor!, s.latest.currency))}</td><td class="num">${escapeHtml(formatMoney(conv!.chfMinor, "CHF"))}</td><td class="num">${vs}</td><td>${TAX_TEXT(s.taxIncluded)}</td></tr>`;
    })
    .join("");
  const rateNote = `Converted at the European Central Bank reference rate of ${rateDates.join(" and ")}.`;
  return `<section class="block"><h2>Regional comparison in Swiss francs</h2>
<p class="small">${escapeHtml(rateNote)} Prices in Switzerland, France and the United Kingdom include VAT. United States prices are shown as listed and <strong>exclude sales tax</strong>, which varies by state and is added at the till, so the comparison is indicative only. Converted figures are for comparison; they are never stored in place of a captured price.</p>
<div class="tablewrap"><table class="data"><thead><tr><th>Market</th><th class="num">Listed price</th><th class="num">In CHF</th><th class="num">Against Switzerland</th><th>Tax</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function chartSection(series: MarketSeries[]): {
  html: string;
  script: string;
} {
  // One line per market, in that market's own currency: x = every date on which any
  // market changed (plus each market's latest check), y = the 'ok' price in major units.
  const days = new Set<string>();
  for (const s of series) {
    for (const p of s.changes) days.add(dayOf(p.captured_at));
    days.add(dayOf(s.latest.captured_at));
  }
  const labels = [...days].sort();
  const datasets = series
    .map((s) => {
      const byDay = new Map<string, number | null>();
      const put = (p: SeriesPoint) =>
        byDay.set(
          dayOf(p.captured_at),
          p.status === "ok" && p.amount_minor != null
            ? p.amount_minor / 100
            : null,
        );
      s.changes.forEach(put);
      put(s.latest);
      return {
        label: `${MARKET_NAME[s.market]} (${s.currency})`,
        data: labels.map((d) => byDay.get(d) ?? null),
      };
    })
    .filter((d) => d.data.some((v) => v != null));
  if (labels.length < 2 || !datasets.length) return { html: "", script: "" };
  const payload = JSON.stringify({ labels, datasets }).replace(/</g, "\\u003c");
  const html = `<figure class="chart" id="price-chart" hidden><canvas role="img" aria-label="Line chart of the list price in each market over time; the same figures are in the table above."></canvas><figcaption>List price in each market's own currency; stepped lines show when a price changed. The table above has the same figures.</figcaption></figure>
<script type="application/json" id="price-series">${payload}</script>`;
  const script = `<script src="${CHARTJS_SRC}" integrity="${CHARTJS_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer" defer></script>
<script>
document.addEventListener("DOMContentLoaded",function(){
  if(!window.Chart)return;
  var fig=document.getElementById("price-chart"),raw=document.getElementById("price-series");
  if(!fig||!raw)return;
  var d=JSON.parse(raw.textContent),colours=["#1B4F8C","#B4650C","#3F6B45","#9E3B3F"];
  fig.hidden=false;
  new window.Chart(fig.querySelector("canvas"),{type:"line",
    data:{labels:d.labels,datasets:d.datasets.map(function(s,i){return{label:s.label,data:s.data,borderColor:colours[i%4],backgroundColor:colours[i%4],stepped:true,spanGaps:true,pointRadius:3,borderWidth:2}})},
    options:{responsive:true,scales:{y:{title:{display:true,text:"List price, local currency"}}},plugins:{legend:{position:"bottom"}}}});
});
</script>`;
  return { html, script };
}

function factsLine(r: PublicReference): string {
  return [
    r.family,
    r.case_material ? `${r.case_material} case` : null,
    r.diameter_mm != null ? `${r.diameter_mm} mm` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function referenceJsonLd(
  origin: string,
  r: PublicReference,
  series: MarketSeries[],
): object[] {
  const url = `${origin}/prices/${r.slug}`;
  const title = referenceTitle(r);
  const days = series
    .flatMap((s) => [
      ...s.changes.map((p) => dayOf(p.captured_at)),
      dayOf(s.latest.captured_at),
    ])
    .sort();
  return [
    breadcrumbLd(origin, [
      { name: "Prices", path: "/prices" },
      { name: r.brand_name, path: `/brand/${r.brand_slug}` },
      { name: r.ref_code, path: `/prices/${r.slug}` },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: title,
      url,
      sku: r.ref_code,
      model: r.name ?? r.family ?? r.ref_code,
      brand: {
        "@type": "Brand",
        name: r.brand_name,
        url: `${origin}/brand/${r.brand_slug}`,
      },
      category: "Wristwatch",
      ...(r.case_material ? { material: r.case_material } : {}),
      // No "offers": tick-ticker does not sell watches.
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${title} (ref. ${r.ref_code}): official list prices by market`,
      description: `Dated official list prices for ${title}, reference ${r.ref_code}, in ${series.map((s) => MARKET_NAME[s.market]).join(", ")}, with the tax treatment of each market. Captured from the brand's own site or a named authorised retailer.`,
      url,
      creator: {
        "@type": "Organization",
        name: "tick-ticker",
        url: "https://tick-ticker.com",
      },
      license: DATASET_LICENSE_URL,
      isAccessibleForFree: true,
      ...(days.length
        ? { temporalCoverage: `${days[0]}/${days[days.length - 1]}` }
        : {}),
      variableMeasured: series.map((s) => ({
        "@type": "PropertyValue",
        name: `List price in ${MARKET_NAME[s.market]}`,
        unitText: s.currency,
        description: TAX_TEXT(s.taxIncluded),
      })),
      about: { "@type": "Product", name: title, sku: r.ref_code },
    },
  ];
}

export async function referencePricePage(
  db: D1Database,
  origin: string,
  slug: string,
): Promise<Page | null> {
  const ref = await getPublicReference(db, slug);
  if (!ref) return null;
  const [snapshots, markets] = await Promise.all([
    listPublicSnapshots(db, ref.id),
    listMarkets(db),
  ]);
  const series = buildMarketSeries(snapshots, markets);
  if (!series.length) return null;

  const lastChecked = series
    .map((s) => dayOf(s.latest.captured_at))
    .sort()
    .pop()!;
  const fx = await getFxSnapshot(db, lastChecked);
  const title = referenceTitle(ref);
  const chart = chartSection(series);
  const facts = factsLine(ref);
  const description = `Official list prices for ${title} (ref. ${ref.ref_code}) in ${series
    .map((s) => MARKET_NAME[s.market])
    .join(
      ", ",
    )}, with dated history and tax treatment. Last checked ${lastChecked}.`;

  const body = `${crumbs([
    { name: "Prices", href: "/prices" },
    { name: ref.brand_name, href: `/brand/${ref.brand_slug}` },
    { name: ref.ref_code },
  ])}
  <header class="page-head"><span class="eyebrow">List price · ref. ${escapeHtml(ref.ref_code)}</span>
    <h1 class="display">${escapeHtml(title)}</h1>
    <p class="lead">Official list price of the new watch${facts ? ` (${escapeHtml(facts)})` : ""}, as published by <a href="/brand/${escapeHtml(ref.brand_slug)}">${escapeHtml(ref.brand_name)}</a> or a named authorised retailer. Last checked ${lastChecked}.</p>
  </header>
  <section class="block"><h2>Current list price by market</h2>${currentCards(series)}
    <p class="small">Prices are captured from public pages, not quoted by tick-ticker, and tick-ticker does not sell watches. See the <a href="${METHODOLOGY_PATH}">methodology</a> for sources, tax treatment and corrections.</p></section>
  <section class="block"><h2>Price history</h2>${historyTable(series)}${chart.html}</section>
  ${comparisonSection(series, fx)}`;

  return {
    html: layout(
      origin,
      {
        title: `${title} (ref. ${ref.ref_code}) list price`,
        description,
        canonical: `/prices/${ref.slug}`,
        navCurrent: "/prices",
        pricesNav: true,
        jsonld: referenceJsonLd(origin, ref, series),
        bodyEnd: chart.script,
      },
      body,
    ),
  };
}
