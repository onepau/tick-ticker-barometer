/**
 * Unit 2: registry seed from Wikidata. Produces a review CSV; never writes to D1.
 *
 *   node scripts/wikidata-seed.ts            # query once, cache, build the CSV
 *   node scripts/wikidata-seed.ts --refresh  # ignore the cache and re-query
 *
 * Run from apps/registry. One SPARQL query, results cached in seed/wikidata-raw.json
 * (reruns read the cache). Existing registry brands come from migration 0005 plus
 * seed/registry_seed.sql, replayed into in-memory SQLite. Output:
 * docs/plans/u2-registry-review.csv. Wikidata data is CC0.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { slugifyBrand, uniqueSlug } from "@baromontres/shared/slug";
import { writeCsv } from "./csv.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const RAW_PATH = join(REPO, "apps/registry/seed/wikidata-raw.json");
const SEED_SQL = join(REPO, "apps/registry/seed/registry_seed.sql");
const CSV_OUT = join(REPO, "docs/plans/u2-registry-review.csv");

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "tick-ticker-registry-seed/0.1 (https://tick-ticker.com; brand registry seed script)";

/**
 * Watch companies: industry (P452) horology Q41767 or watchmaking Q63346664, or an
 * instance of "watch manufacturing company" Q136094627 (or a subclass). Multi-valued
 * properties are folded with GROUP_CONCAT so there is one row per item.
 */
export const SPARQL = `
SELECT ?item
  (SAMPLE(?en) AS ?en) (SAMPLE(?fr) AS ?fr)
  (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts)
  (GROUP_CONCAT(DISTINCT STR(?inc); separator="|") AS ?inception)
  (GROUP_CONCAT(DISTINCT STR(?dis); separator="|") AS ?dissolved)
  (GROUP_CONCAT(DISTINCT CONCAT(STR(?parent), "~", ?parentLabel); separator="|") AS ?parents)
  (GROUP_CONCAT(DISTINCT ?founderLabel; separator="|") AS ?founders)
  (GROUP_CONCAT(DISTINCT ?hqLabel; separator="|") AS ?hqs)
  (GROUP_CONCAT(DISTINCT ?site; separator="|") AS ?websites)
  (GROUP_CONCAT(DISTINCT ?iso; separator="|") AS ?countries)
WHERE {
  { ?item wdt:P452 wd:Q41767 } UNION { ?item wdt:P452 wd:Q63346664 }
  UNION { ?item wdt:P31/wdt:P279* wd:Q136094627 }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt) = "en") }
  OPTIONAL { ?item wdt:P571 ?inc }
  OPTIONAL { ?item wdt:P576 ?dis }
  OPTIONAL { ?item wdt:P749 ?parent . ?parent rdfs:label ?parentLabel FILTER(LANG(?parentLabel) = "en") }
  OPTIONAL { ?item wdt:P112 ?f . ?f rdfs:label ?founderLabel FILTER(LANG(?founderLabel) = "en") }
  OPTIONAL { ?item wdt:P159 ?hq . ?hq rdfs:label ?hqLabel FILTER(LANG(?hqLabel) = "en") }
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?iso }
}
GROUP BY ?item`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface WdItem {
  id: string; // Q-number
  en: string;
  fr: string;
  alts: string[];
  foundedYear: number | null;
  dissolvedYear: number | null;
  parent: string; // English label of the first parent organisation
  founders: string[];
  hqCity: string;
  website: string;
  country: string; // ISO 3166-1 alpha-2, or ""
}

export interface RegistryBrand {
  slug: string;
  name: string;
  /** Alias spellings (GPHG, Only Watch, manual). */
  aliases: string[];
}

export type Confidence = "exact" | "alias" | "ambiguous" | "new" | "none";

export interface Match {
  item: WdItem;
  confidence: Exclude<Confidence, "none">;
  slug: string | null; // matched registry slug (exact/alias)
  candidates: string[]; // registry slugs considered (ambiguous)
}

type Binding = Record<string, { value: string } | undefined>;

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Year of a Wikidata xsd:dateTime string ("1905-01-01T00:00:00Z"); BCE and junk give null. */
export function yearOf(value: string): number | null {
  const m = /^(\d{4})-/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1500 && y <= 2100 ? y : null;
}

const split = (v: string | undefined): string[] =>
  v ? v.split("|").filter(Boolean) : [];

/** Wikidata values that are still unresolved Q-ids (an item with no English label). */
const isQid = (s: string) => /^Q\d+$/.test(s);

export function parseBinding(b: Binding): WdItem {
  const id = (b.item?.value ?? "").split("/").pop() ?? "";
  const years = (v: string | undefined) =>
    split(v)
      .map(yearOf)
      .filter((y): y is number => y !== null)
      .sort((a, c) => a - c);
  const en = b.en?.value ?? "";
  return {
    id,
    en: isQid(en) ? "" : en,
    fr: b.fr?.value ?? "",
    alts: split(b.alts?.value),
    foundedYear: years(b.inception?.value)[0] ?? null,
    dissolvedYear: years(b.dissolved?.value)[0] ?? null,
    parent:
      split(b.parents?.value)
        .map((p) => p.split("~").slice(1).join("~"))
        .find(Boolean) ?? "",
    founders: split(b.founders?.value).sort(),
    hqCity: split(b.hqs?.value).sort()[0] ?? "",
    website: split(b.websites?.value).sort()[0] ?? "",
    country: split(b.countries?.value).sort()[0] ?? "",
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

function safeSlug(name: string): string | null {
  try {
    return slugifyBrand(name);
  } catch {
    return null;
  }
}

/**
 * Match Wikidata items to registry brands. An item is "exact" when a label slugifies
 * to a registry slug, "alias" when only an alias spelling does. It is "ambiguous" when
 * its names point at several registry brands, or when another item claims the same
 * registry brand. Everything else is "new".
 */
export function matchItems(
  items: WdItem[],
  registry: RegistryBrand[],
): Match[] {
  const slugs = new Set(registry.map((b) => b.slug));
  const aliasToSlugs = new Map<string, Set<string>>();
  for (const b of registry)
    for (const a of b.aliases) {
      const s = safeSlug(a);
      if (!s || slugs.has(s)) continue; // a plain slug hit is handled as exact
      (aliasToSlugs.get(s) ?? aliasToSlugs.set(s, new Set()).get(s)!).add(
        b.slug,
      );
    }

  const raw: Match[] = items.map((item) => {
    const exact = new Set<string>();
    const viaAlias = new Set<string>();
    // The English label and the French label are the strong signals; altLabels are weaker.
    for (const name of [item.en, item.fr]) {
      const s = name ? safeSlug(name) : null;
      if (!s) continue;
      if (slugs.has(s)) exact.add(s);
      for (const t of aliasToSlugs.get(s) ?? []) viaAlias.add(t);
    }
    for (const name of item.alts) {
      const s = safeSlug(name);
      if (!s) continue;
      if (slugs.has(s)) viaAlias.add(s);
      for (const t of aliasToSlugs.get(s) ?? []) viaAlias.add(t);
    }
    if (exact.size === 1)
      return {
        item,
        confidence: "exact",
        slug: [...exact][0]!,
        candidates: [],
      };
    if (exact.size > 1)
      return {
        item,
        confidence: "ambiguous",
        slug: null,
        candidates: [...exact].sort(),
      };
    if (viaAlias.size === 1)
      return {
        item,
        confidence: "alias",
        slug: [...viaAlias][0]!,
        candidates: [],
      };
    if (viaAlias.size > 1)
      return {
        item,
        confidence: "ambiguous",
        slug: null,
        candidates: [...viaAlias].sort(),
      };
    return { item, confidence: "new", slug: null, candidates: [] };
  });

  // Two Wikidata items claiming one registry brand cannot both be right.
  const claimants = new Map<string, Match[]>();
  for (const m of raw)
    if (m.slug)
      (claimants.get(m.slug) ?? claimants.set(m.slug, []).get(m.slug)!).push(m);
  return raw.map((m) => {
    const group = m.slug ? claimants.get(m.slug)! : [];
    if (group.length < 2) return m;
    return { ...m, confidence: "ambiguous", slug: null, candidates: [m.slug!] };
  });
}

// ── Row shaping ──────────────────────────────────────────────────────────────

export const CSV_HEADER = [
  "slug",
  "name",
  "name_fr",
  "wikidata_id",
  "group",
  "founded_year",
  "dissolved_year",
  "status_suggested",
  "hq_city",
  "hq_country",
  "website",
  "founders",
  "match_confidence",
  "source",
  "corrections",
  "status",
];

export type Row = (string | number)[];

/** Dissolved means dead; otherwise active. Callers pass null when there is no evidence. */
export function suggestStatus(item: WdItem): "dead" | "active" {
  return item.dissolvedYear !== null ? "dead" : "active";
}

/** `name_fr` only when it differs from the English name. */
const frName = (item: WdItem, name: string) =>
  item.fr && item.fr !== name ? item.fr : "";

function wikidataFields(item: WdItem): Row {
  // group, founded, dissolved, status, hq_city, hq_country, website, founders
  return [
    item.parent,
    item.foundedYear ?? "",
    item.dissolvedYear ?? "",
    suggestStatus(item),
    item.hqCity,
    item.country,
    item.website,
    item.founders.join("; "),
  ];
}

/** A registry brand with no Wikidata match: kept in the CSV so Paul sees the whole registry. */
export function registryOnlyRow(b: RegistryBrand): Row {
  return [
    b.slug,
    b.name,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "none",
    "registry",
    "",
    "",
  ];
}

/** A registry brand enriched with its Wikidata item (exact or alias match). */
export function matchedRow(b: RegistryBrand, m: Match): Row {
  const { item } = m;
  return [
    b.slug,
    b.name,
    frName(item, b.name),
    item.id,
    ...wikidataFields(item),
    m.confidence,
    "registry+wikidata",
    "",
    "",
  ];
}

/** A Wikidata-only brand (new) or an ambiguous one; the slug is made unique among `taken`. */
export function wikidataOnlyRow(m: Match, taken: Set<string>): Row {
  const { item } = m;
  const base = safeSlug(item.en) ?? safeSlug(item.fr) ?? item.id.toLowerCase();
  const slug = uniqueSlug(base, taken);
  taken.add(slug);
  const source =
    m.confidence === "ambiguous"
      ? `wikidata; may be registry brand: ${m.candidates.join(" | ")}`
      : "wikidata";
  return [
    slug,
    item.en || item.fr,
    frName(item, item.en || item.fr),
    item.id,
    ...wikidataFields(item),
    m.confidence,
    source,
    "",
    "",
  ];
}

/** Build every CSV row: registry brands (enriched where matched), then Wikidata-only items. */
export function buildRows(
  registry: RegistryBrand[],
  matches: Match[],
): { rows: Row[]; counts: Record<Confidence, number> } {
  const bySlug = new Map(registry.map((b) => [b.slug, b]));
  const matchedBySlug = new Map<string, Match>();
  for (const m of matches)
    if (m.slug && (m.confidence === "exact" || m.confidence === "alias"))
      matchedBySlug.set(m.slug, m);

  const counts: Record<Confidence, number> = {
    exact: 0,
    alias: 0,
    ambiguous: 0,
    new: 0,
    none: 0,
  };
  const rows: Row[] = [];
  for (const b of registry) {
    const m = matchedBySlug.get(b.slug);
    if (m) {
      counts[m.confidence]++;
      rows.push(matchedRow(b, m));
    } else {
      counts.none++;
      rows.push(registryOnlyRow(b));
    }
  }
  const taken = new Set(bySlug.keys());
  for (const m of matches)
    if (m.confidence === "new" || m.confidence === "ambiguous") {
      counts[m.confidence]++;
      rows.push(wikidataOnlyRow(m, taken));
    }
  return { rows, counts };
}

// ── IO ───────────────────────────────────────────────────────────────────────

async function queryWikidata(): Promise<Binding[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: SPARQL }),
      signal: AbortSignal.timeout(65_000),
    }).catch(() => null);
    if (res?.ok) return ((await res.json()) as any).results.bindings;
    if (attempt >= 3)
      throw new Error(
        `Wikidata query failed (HTTP ${res?.status ?? "network"})`,
      );
    const wait = Number(res?.headers.get("retry-after")) || 10 * attempt;
    console.error(`attempt ${attempt} failed, retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

async function loadBindings(refresh: boolean): Promise<Binding[]> {
  if (!refresh && existsSync(RAW_PATH))
    return JSON.parse(readFileSync(RAW_PATH, "utf8")).bindings;
  const bindings = await queryWikidata();
  mkdirSync(dirname(RAW_PATH), { recursive: true });
  writeFileSync(
    RAW_PATH,
    JSON.stringify(
      {
        fetched_at: new Date().toISOString(),
        endpoint: ENDPOINT,
        query: SPARQL.trim(),
        bindings,
      },
      null,
      1,
    ) + "\n",
  );
  return bindings;
}

/** Registry brands and aliases, from migration 0005 + the seed replayed into memory. */
function loadRegistry(): RegistryBrand[] {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(join(REPO, "migrations/0005_registry_entities.sql"), "utf8"),
  );
  db.exec(readFileSync(SEED_SQL, "utf8"));
  const aliases = new Map<number, string[]>();
  for (const r of db
    .prepare("SELECT brand_id, alias FROM brand_aliases")
    .all() as any[])
    (
      aliases.get(r.brand_id) ?? aliases.set(r.brand_id, []).get(r.brand_id)!
    ).push(r.alias);
  return (
    db.prepare("SELECT id, slug, name FROM brands ORDER BY slug").all() as any[]
  ).map((b) => ({
    slug: b.slug,
    name: b.name,
    aliases: aliases.get(b.id) ?? [],
  }));
}

async function main() {
  const bindings = await loadBindings(process.argv.includes("--refresh"));
  const items = bindings
    .map(parseBinding)
    .filter((i) => i.id && (i.en || i.fr));
  const registry = loadRegistry();
  const matches = matchItems(items, registry);
  const { rows, counts } = buildRows(registry, matches);
  mkdirSync(dirname(CSV_OUT), { recursive: true });
  writeFileSync(CSV_OUT, writeCsv(CSV_HEADER, rows));
  console.log(
    `${items.length} Wikidata items, ${registry.length} registry brands → ${rows.length} rows`,
  );
  console.log(
    `matched: ${counts.exact} exact + ${counts.alias} alias; new: ${counts.new}; ambiguous: ${counts.ambiguous}; registry only: ${counts.none}`,
  );
  console.log(`wrote ${CSV_OUT}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
