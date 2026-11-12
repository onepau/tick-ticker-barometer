/**
 * Server-rendered registry pages: /brand/<slug>, /group/<slug>, /brands and the
 * dormant-and-defunct hub. Each page function loads what it needs from D1 and returns the
 * finished HTML, or null for an unknown slug (the caller renders the 404).
 *
 * Many brands carry only a name, so every fact is optional: an empty fact is left out
 * rather than shown blank, and a name-only brand gets a short note instead of an empty
 * panel.
 */
import {
  getBrandBySlug,
  getGroupById,
  getGroupBySlug,
  listBrandAliases,
  listBrandDirectory,
  listBrandPeople,
  listGroupFeedRows,
  type BrandAliasRow,
  type BrandDirectoryFilter,
  type BrandDirectoryRow,
  type BrandPersonRow,
  type BrandRow,
  type BrandStatus,
  fromPublicStatus,
  isNameOnly,
  type GroupRow,
} from "@baromontres/shared/registry";
import { crumbs, escapeHtml, layout } from "./html.ts";

export const GPHG_ORIGIN = "https://gphg.tick-ticker.com";
export const ONLYWATCH_ORIGIN = "https://onlywatch.tick-ticker.com";
export const BLOG_ORIGIN = "https://blog.tick-ticker.com";
/** Paul's posts on the dead and the revived GPHG brands (blog route is /posts/<slug>). */
export const BLOG_DEAD_BRANDS_URL = `${BLOG_ORIGIN}/posts/gphg-dead-brands`;
export const BLOG_COMEBACK_BRANDS_URL = `${BLOG_ORIGIN}/posts/gphg-comeback-brands`;

/** Public status names, as used in the `?status=` filter. */
export const STATUSES = ["active", "dormant", "defunct", "revived"] as const;
const STATUS_LABEL: Record<BrandStatus, string> = {
  active: "Active",
  dormant: "Dormant",
  dead: "Defunct",
  revived: "Revived",
};
export const HUB_STATUSES: BrandStatus[] = ["dead", "dormant", "revived"];

export interface Page {
  html: string;
}

// ── small helpers ────────────────────────────────────────────────────────────

function countryName(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

const statusChip = (s: BrandStatus | null): string =>
  s ? `<span class="chip ${s}">${STATUS_LABEL[s]}</span>` : "";

function yearsSpan(from: number | null, to: number | null): string {
  if (from != null && to != null) return `${from}–${to}`;
  if (from != null) return `est. ${from}`;
  if (to != null) return `until ${to}`;
  return "";
}

function wikidataUrl(id: string): string {
  return `https://www.wikidata.org/wiki/${id}`;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Only http(s) URLs become links; anything else in the data is ignored. */
const safeUrl = (u: string | null): string | null =>
  u && /^https?:\/\//i.test(u) ? u : null;

function breadcrumbLd(
  origin: string,
  items: { name: string; path?: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      ...(it.path ? { item: `${origin}${it.path}` } : {}),
    })),
  };
}

function itemListLd(
  origin: string,
  name: string,
  rows: BrandDirectoryRow[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: rows.length,
    itemListElement: rows.slice(0, 100).map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: r.name,
      url: `${origin}/brand/${r.slug}`,
    })),
  };
}

function brandListItem(r: BrandDirectoryRow, showGroup = false): string {
  const bits = [
    yearsSpan(r.founded_year, r.dissolved_year),
    showGroup && r.group_name ? escapeHtml(r.group_name) : "",
  ].filter(Boolean);
  return `<li><a class="nm" href="/brand/${escapeHtml(r.slug)}">${escapeHtml(r.name)}</a>${
    bits.length ? ` <span class="meta">${bits.join(" · ")}</span>` : ""
  }${r.status ? ` ${statusChip(r.status)}` : ""}</li>`;
}

// ── /brand/<slug> ────────────────────────────────────────────────────────────

/** Where unit 10 plugs in the latest list prices; nothing is rendered while there are none. */
function priceSectionHtml(_brand: BrandRow): string {
  return "";
}

function factsPanel(
  brand: BrandRow,
  group: GroupRow | null,
  people: BrandPersonRow[],
): string {
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    rows.push(`<div class="row"><dt>${label}</dt><dd>${value}</dd></div>`);

  if (group)
    row(
      "Group",
      `<a href="/group/${escapeHtml(group.slug)}">${escapeHtml(group.name)}</a>`,
    );
  if (brand.founded_year != null) row("Founded", String(brand.founded_year));
  if (brand.dissolved_year != null)
    row("Dissolved", String(brand.dissolved_year));
  if (brand.status) row("Status", statusChip(brand.status));
  const place = [
    brand.hq_city,
    brand.hq_country ? countryName(brand.hq_country) : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (place) row("Headquarters", escapeHtml(place));
  if (people.length) {
    row(
      "Key people",
      `<ul>${people
        .map((p) => {
          const yrs = yearsSpan(p.from_year, p.to_year);
          return `<li>${escapeHtml(p.name)} <span class="yrs">${escapeHtml(p.role)}${
            yrs ? `, ${escapeHtml(yrs)}` : ""
          }</span></li>`;
        })
        .join("")}</ul>`,
    );
  }
  const site = safeUrl(brand.website);
  if (site)
    row(
      "Official site",
      `<a href="${escapeHtml(site)}" rel="noopener">${escapeHtml(hostOf(site))}</a>`,
    );
  if (brand.wikidata_id)
    row(
      "Wikidata",
      `<a href="${wikidataUrl(brand.wikidata_id)}" rel="noopener">${escapeHtml(brand.wikidata_id)}</a>`,
    );

  if (!rows.length) return "";
  return `<aside class="facts" aria-label="Facts"><h2>Facts</h2><dl>${rows.join("")}</dl></aside>`;
}

function brandDescription(brand: BrandRow, group: GroupRow | null): string {
  const bits: string[] = [];
  if (brand.founded_year != null) bits.push(`founded in ${brand.founded_year}`);
  if (brand.dissolved_year != null)
    bits.push(`dissolved in ${brand.dissolved_year}`);
  const place = [
    brand.hq_city,
    brand.hq_country ? countryName(brand.hq_country) : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (place) bits.push(`based in ${place}`);
  if (group) bits.push(`part of ${group.name}`);
  return bits.length
    ? `${brand.name} is a watch brand, ${bits.join(", ")}.`
    : "";
}

function brandJsonLd(
  origin: string,
  brand: BrandRow,
  group: GroupRow | null,
  people: BrandPersonRow[],
): object {
  const sameAs = [
    brand.wikidata_id ? wikidataUrl(brand.wikidata_id) : null,
    safeUrl(brand.website),
  ].filter(Boolean);
  const founders = people.filter((p) => /founder/i.test(p.role));
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: `${origin}/brand/${brand.slug}`,
    ...(brand.founded_year != null
      ? { foundingDate: String(brand.founded_year) }
      : {}),
    ...(brand.dissolved_year != null
      ? { dissolutionDate: String(brand.dissolved_year) }
      : {}),
    ...(group
      ? {
          parentOrganization: {
            "@type": "Organization",
            name: group.name,
            url: `${origin}/group/${group.slug}`,
          },
        }
      : {}),
    ...(founders.length
      ? { founder: founders.map((p) => ({ "@type": "Person", name: p.name })) }
      : {}),
    ...(brand.hq_city || brand.hq_country
      ? {
          location: {
            "@type": "Place",
            address: {
              "@type": "PostalAddress",
              ...(brand.hq_city ? { addressLocality: brand.hq_city } : {}),
              ...(brand.hq_country ? { addressCountry: brand.hq_country } : {}),
            },
          },
        }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function elsewhereCards(brand: BrandRow, aliases: BrandAliasRow[]): string {
  const cards: string[] = [];
  if (aliases.some((a) => a.source === "gphg")) {
    cards.push(
      `<a class="linkcard" href="${GPHG_ORIGIN}/brand/${escapeHtml(brand.slug)}"><span class="k">GPHG Index</span><div class="h">${escapeHtml(brand.name)} at the Grand Prix d'Horlogerie de Genève</div><div class="s">Entries, shortlists and prizes, 2001–2025</div></a>`,
    );
  }
  const seen = new Set<string>();
  for (const a of aliases.filter((x) => x.source === "onlywatch")) {
    if (seen.has(a.alias)) continue;
    seen.add(a.alias);
    cards.push(
      `<a class="linkcard" href="${ONLYWATCH_ORIGIN}/brand/${encodeURIComponent(a.alias)}"><span class="k">Only Watch Index</span><div class="h">${escapeHtml(brand.name)} at the Only Watch auctions</div><div class="s">Lots offered for charity</div></a>`,
    );
  }
  if (!cards.length) return "";
  return `<section class="block"><h2>Elsewhere on tick-ticker</h2><div class="linkcards">${cards.join("")}</div></section>`;
}

export async function brandPage(
  db: D1Database,
  origin: string,
  slug: string,
): Promise<Page | null> {
  const brand = await getBrandBySlug(db, slug);
  if (!brand) return null;
  const [group, people, aliases] = await Promise.all([
    brand.group_id != null
      ? getGroupById(db, brand.group_id)
      : Promise.resolve(null),
    listBrandPeople(db, brand.id),
    listBrandAliases(db, brand.id),
  ]);

  const facts = factsPanel(brand, group, people);
  const lead = brandDescription(brand, group);
  const description =
    lead ||
    `${brand.name} in the tick-ticker watch brand registry, with links to its records on the GPHG Index and Only Watch Index where they exist.`;
  const sparse = isNameOnly(brand, people.length);

  const main = `${lead ? `<p class="lead">${escapeHtml(lead)}</p>` : ""}${
    sparse
      ? `<p class="note">The registry holds only the name of this brand so far. Founding, ownership and status are added as they are verified.</p>`
      : ""
  }${elsewhereCards(brand, aliases)}${priceSectionHtml(brand)}`;

  const body = `${crumbs([
    { name: "Brands", href: "/brands" },
    { name: brand.name },
  ])}
  <header class="page-head"><span class="eyebrow">Watch brand${brand.status ? ` · ${STATUS_LABEL[brand.status]}` : ""}</span>
    <h1 class="display">${escapeHtml(brand.name)}</h1>
  </header>
  <div class="layout">
    <div>${main}</div>
    ${facts}
  </div>`;

  return {
    html: layout(
      origin,
      {
        title: `${brand.name} — watch brand`,
        description,
        canonical: `/brand/${brand.slug}`,
        ogType: "profile",
        noindex: sparse,
        navCurrent: "/brands",
        jsonld: [
          breadcrumbLd(origin, [
            { name: "Brands", path: "/brands" },
            { name: brand.name, path: `/brand/${brand.slug}` },
          ]),
          brandJsonLd(origin, brand, group, people),
        ],
      },
      body,
    ),
  };
}

// ── /group/<slug> ────────────────────────────────────────────────────────────

export const INDEPENDENT_SLUG = "independent";

export async function groupPage(
  db: D1Database,
  origin: string,
  slug: string,
): Promise<Page | null> {
  const group = await getGroupBySlug(db, slug);
  const independent = !group && slug === INDEPENDENT_SLUG;
  if (!group && !independent) return null;

  const rows = await listBrandDirectory(
    db,
    group ? { group: group.slug } : { group: "independent" },
  );
  const name = group ? group.name : "Independent brands";
  const path = `/group/${group ? group.slug : INDEPENDENT_SLUG}`;
  const site = group ? safeUrl(group.website) : null;

  const lead = group
    ? `${group.name} owns ${rows.length} ${rows.length === 1 ? "brand" : "brands"} in the registry.`
    : `${rows.length} ${rows.length === 1 ? "brand" : "brands"} in the registry with no parent group.`;

  const links = group
    ? [
        site
          ? `<a href="${escapeHtml(site)}" rel="noopener">${escapeHtml(hostOf(site))}</a>`
          : "",
        group.wikidata_id
          ? `<a href="${wikidataUrl(group.wikidata_id)}" rel="noopener">Wikidata ${escapeHtml(group.wikidata_id)}</a>`
          : "",
      ].filter(Boolean)
    : [];

  const body = `${crumbs([{ name: "Brands", href: "/brands" }, { name }])}
  <header class="page-head"><span class="eyebrow">${group ? "Watch group" : "No parent group"}</span>
    <h1 class="display">${escapeHtml(name)}</h1>
    <p class="lead">${escapeHtml(lead)}</p>
    ${links.length ? `<p class="muted">${links.join(" · ")}</p>` : ""}
  </header>
  <section class="block"><h2>Brands</h2>
  ${
    rows.length
      ? `<ul class="brandlist">${rows.map((r) => brandListItem(r)).join("")}</ul>`
      : `<p class="note">No brands are linked to this group yet.</p>`
  }</section>`;

  const orgLd = group
    ? {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: group.name,
        url: `${origin}${path}`,
        ...(rows.length
          ? {
              subOrganization: rows.map((r) => ({
                "@type": "Organization",
                name: r.name,
                url: `${origin}/brand/${r.slug}`,
              })),
            }
          : {}),
        ...(group.wikidata_id || site
          ? {
              sameAs: [
                group.wikidata_id ? wikidataUrl(group.wikidata_id) : null,
                site,
              ].filter(Boolean),
            }
          : {}),
      }
    : itemListLd(origin, name, rows);

  return {
    html: layout(
      origin,
      {
        title: group ? `${name} — brands` : name,
        description: group
          ? `${lead} Founding dates, status and records for each brand.`
          : `${lead} An independent listing from the tick-ticker brand registry.`,
        canonical: path,
        navCurrent: "/brands",
        jsonld: [
          breadcrumbLd(origin, [
            { name: "Brands", path: "/brands" },
            { name, path },
          ]),
          orgLd,
        ],
      },
      body,
    ),
  };
}

// ── /brands ──────────────────────────────────────────────────────────────────

const letterOf = (name: string): string => {
  const c = name.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

export async function brandsIndexPage(
  db: D1Database,
  origin: string,
  params: URLSearchParams,
): Promise<Page> {
  const groups = await listGroupFeedRows(db);
  const rawStatus = params.get("status") ?? "";
  const rawGroup = params.get("group") ?? "";
  // The URL says "defunct"; the database says "dead".
  const publicStatus = (STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : rawStatus === "unknown"
      ? "unknown"
      : undefined;
  const status: BrandDirectoryFilter["status"] | undefined =
    publicStatus === "unknown"
      ? "unknown"
      : publicStatus
        ? (fromPublicStatus(publicStatus) ?? undefined)
        : undefined;
  const group =
    rawGroup === "independent" || groups.some((g) => g.slug === rawGroup)
      ? rawGroup
      : undefined;
  const filtered = status !== undefined || group !== undefined;

  const rows = (await listBrandDirectory(db, { status, group })).sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );

  const byLetter = new Map<string, BrandDirectoryRow[]>();
  for (const r of rows) {
    const l = letterOf(r.name);
    (byLetter.get(l) ?? byLetter.set(l, []).get(l)!).push(r);
  }
  const alphabet = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  const present = alphabet.filter((l) => byLetter.has(l));
  const az = `<nav class="az" aria-label="Jump to letter">${alphabet
    .map((l) =>
      byLetter.has(l)
        ? `<a href="#letter-${l === "#" ? "other" : l}">${l}</a>`
        : `<span class="off" aria-hidden="true">${l}</span>`,
    )
    .join("")}</nav>`;

  const opt = (value: string, label: string, sel: boolean) =>
    `<option value="${escapeHtml(value)}"${sel ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const form = `<form class="filters" method="GET" action="/brands">
    <label>Status<select name="status">
      ${opt("", "Any status", publicStatus === undefined)}
      ${STATUSES.map((s) => opt(s, s[0]!.toUpperCase() + s.slice(1), publicStatus === s)).join("")}
      ${opt("unknown", "Not yet researched", publicStatus === "unknown")}
    </select></label>
    <label>Group<select name="group">
      ${opt("", "Any group", group === undefined)}
      ${opt("independent", "Independent (no group)", group === "independent")}
      ${groups.map((g) => opt(g.slug, g.name, group === g.slug)).join("")}
    </select></label>
    <button type="submit">Filter</button>
    ${filtered ? `<a class="clear" href="/brands">Clear filters</a>` : ""}
  </form>`;

  const sections = present
    .map(
      (l) =>
        `<section class="letter" id="letter-${l === "#" ? "other" : l}"><h2>${l}</h2><ul class="brandlist">${byLetter
          .get(l)!
          .map((r) => brandListItem(r, true))
          .join("")}</ul></section>`,
    )
    .join("");

  const groupLinks = groups.length
    ? `<section class="block"><h2>Groups</h2><ul class="brandlist">${groups
        .map(
          (g) =>
            `<li><a class="nm" href="/group/${escapeHtml(g.slug)}">${escapeHtml(g.name)}</a> <span class="meta">${g.brand_count} ${g.brand_count === 1 ? "brand" : "brands"}</span></li>`,
        )
        .join(
          "",
        )}<li><a class="nm" href="/group/${INDEPENDENT_SLUG}">Independent brands</a></li></ul></section>`
    : "";

  const body = `${crumbs([{ name: "Brands" }])}
  <header class="page-head"><span class="eyebrow">Registry</span>
    <h1 class="display">Watch brands, A–Z</h1>
    <p class="lead">Every watch brand in the tick-ticker registry, with its group, founding date and status where we have verified them. Brands that went quiet are collected in <a href="/brands/dormant-and-defunct">dormant and defunct</a>.</p>
    ${form}
  </header>
  <p class="count">${rows.length} ${rows.length === 1 ? "brand" : "brands"}${filtered ? " match these filters" : ""}</p>
  ${rows.length ? az + sections : `<p class="note">No brands match these filters.</p>`}
  ${filtered ? "" : groupLinks}`;

  return {
    html: layout(
      origin,
      {
        title: "Watch brands A–Z",
        description:
          "An A–Z registry of watch brands: group, founding date, status and links to GPHG and Only Watch records.",
        canonical: "/brands",
        navCurrent: "/brands",
        noindex: filtered,
        jsonld: [
          breadcrumbLd(origin, [{ name: "Brands", path: "/brands" }]),
          ...(filtered ? [] : [itemListLd(origin, "Watch brands A–Z", rows)]),
        ],
      },
      body,
    ),
  };
}

// ── /brands/dormant-and-defunct ─────────────────────────────────────────────────

const HUB_COPY: Record<string, { heading: string; blurb: string }> = {
  dead: { heading: "Dead", blurb: "Brands that have closed for good." },
  dormant: {
    heading: "Dormant",
    blurb: "Brands that are asleep: no current production.",
  },
  revived: {
    heading: "Revived",
    blurb: "Brands that were defunct or dormant and have come back.",
  },
};

export async function dormantAndDefunctPage(
  db: D1Database,
  origin: string,
): Promise<Page> {
  const rows = await listBrandDirectory(db, { statuses: HUB_STATUSES });
  const sections = HUB_STATUSES.map((s) => {
    const list = rows.filter((r) => r.status === s);
    const copy = HUB_COPY[s]!;
    if (!list.length) return "";
    return `<section class="block"><h2>${copy.heading} <span class="muted mono">${list.length}</span></h2>
      <p class="muted">${copy.blurb}</p>
      <ul class="brandlist">${list.map((r) => brandListItem(r, true)).join("")}</ul></section>`;
  }).join("");

  const body = `${crumbs([{ name: "Brands", href: "/brands" }, { name: "Dormant and defunct" }])}
  <header class="page-head"><span class="eyebrow">Registry hub</span>
    <h1 class="display">Dormant and defunct watch brands</h1>
    <p class="lead">Brands that stopped making watches, went to sleep or came back. Each links to its registry page.</p>
  </header>
  <section class="block"><h2>Read more</h2><div class="linkcards">
    <a class="linkcard" href="${BLOG_DEAD_BRANDS_URL}"><span class="k">Journal</span><div class="h">The GPHG's dead brands</div><div class="s">Brands that have disappeared from the Grand Prix, and why</div></a>
    <a class="linkcard" href="${BLOG_COMEBACK_BRANDS_URL}"><span class="k">Journal</span><div class="h">The GPHG's comeback brands</div><div class="s">Names that returned to the competition</div></a>
  </div></section>
  ${
    rows.length
      ? sections
      : `<section class="block"><p class="note">No brands are marked dormant, defunct or revived yet. Statuses are added as they are researched; see all brands in the <a href="/brands">A–Z index</a>.</p></section>`
  }`;

  return {
    html: layout(
      origin,
      {
        title: "Dormant and defunct watch brands",
        description:
          "Watch brands that have closed, gone dormant or been revived, with links to each brand's registry page and to the journal's post on the GPHG's dead brands.",
        canonical: "/brands/dormant-and-defunct",
        navCurrent: "/brands/dormant-and-defunct",
        jsonld: [
          breadcrumbLd(origin, [
            { name: "Brands", path: "/brands" },
            { name: "Dormant and defunct", path: "/brands/dormant-and-defunct" },
          ]),
          itemListLd(origin, "Dormant and defunct watch brands", rows),
        ],
      },
      body,
    ),
  };
}
