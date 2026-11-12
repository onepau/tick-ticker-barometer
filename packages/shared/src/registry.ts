/**
 * Brand registry: row types, SQL and feed shapes for migrations 0005 and 0006.
 *
 * Kept apart from queries.ts (an agreed deviation) so the registry and price branches
 * can work in parallel without editing the same file.
 *
 * Re-exports the slug helpers so index.ts needs a single export line.
 */

export * from './slug.ts';

/** Default public origin of the registry Worker (shared with the price Worker); the Worker's PUBLIC_ORIGIN var overrides it. */
export const REGISTRY_ORIGIN = "https://prices.tick-ticker.com";

export type BrandStatus = "active" | "dormant" | "dead" | "revived";
/** Status as shown publicly: the database keeps 'dead', the site and the feed say 'defunct'. */
export type PublicBrandStatus = "active" | "dormant" | "defunct" | "revived";
export const toPublicStatus = (s: BrandStatus | null): PublicBrandStatus | null =>
  s === "dead" ? "defunct" : s;
export const fromPublicStatus = (s: string): BrandStatus | null =>
  s === "defunct" ? "dead" : (["active", "dormant", "revived"] as string[]).includes(s) ? (s as BrandStatus) : null;

export type BrandAliasSource = "gphg" | "onlywatch" | "manual";

export interface GroupRow {
  id: number;
  slug: string;
  name: string;
  wikidata_id: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandRow {
  id: number;
  slug: string;
  name: string;
  group_id: number | null;
  founded_year: number | null;
  dissolved_year: number | null;
  status: BrandStatus | null;
  hq_city: string | null;
  hq_country: string | null;
  website: string | null;
  wikidata_id: string | null;
  prices_public: 0 | 1 | null;
  created_at: string;
  updated_at: string;
}

export interface BrandAliasRow {
  id: number;
  alias: string;
  source: BrandAliasSource;
  brand_id: number;
  created_at: string;
}

export interface BrandPersonRow {
  id: number;
  brand_id: number;
  name: string;
  role: string;
  from_year: number | null;
  to_year: number | null;
  created_at: string;
}

export interface WatchReferenceRow {
  id: number;
  brand_id: number;
  slug: string;
  ref_code: string;
  family: string | null;
  name: string | null;
  case_material: string | null;
  diameter_mm: number | null;
  active: 0 | 1;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Feed shapes (/api/registry/v1/*) ─────────────────────────────────────────

export interface BrandFeedItem {
  id: number;
  slug: string;
  name: string;
  group: { id: number; slug: string; name: string } | null;
  status: PublicBrandStatus | null;
  url: string;
  /** Price page URL; null until the price pages ship (phase D). */
  price_url: string | null;
}

export interface GroupFeedItem {
  id: number;
  slug: string;
  name: string;
  wikidata_id: string | null;
  website: string | null;
  url: string;
  brand_count: number;
}

export interface Feed<T> {
  version: 1;
  generated_at: string;
  count: number;
  items: T[];
}

export const brandUrl = (slug: string, origin: string = REGISTRY_ORIGIN): string =>
  `${origin}/brand/${slug}`;
export const groupUrl = (slug: string, origin: string = REGISTRY_ORIGIN): string =>
  `${origin}/group/${slug}`;

/** Row shape returned by listBrandFeedRows: a brand joined to its group. */
export interface BrandFeedRow {
  id: number;
  slug: string;
  name: string;
  status: BrandStatus | null;
  group_id: number | null;
  group_slug: string | null;
  group_name: string | null;
}

export function toBrandFeedItem(
  row: BrandFeedRow,
  origin: string = REGISTRY_ORIGIN,
): BrandFeedItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    group:
      row.group_id != null && row.group_slug != null && row.group_name != null
        ? { id: row.group_id, slug: row.group_slug, name: row.group_name }
        : null,
    status: toPublicStatus(row.status),
    url: brandUrl(row.slug, origin),
    price_url: null,
  };
}

export function toGroupFeedItem(
  row: Omit<GroupFeedItem, "url">,
  origin: string = REGISTRY_ORIGIN,
): GroupFeedItem {
  return { ...row, url: groupUrl(row.slug, origin) };
}

export function feed<T>(items: T[], now: Date = new Date()): Feed<T> {
  return {
    version: 1,
    generated_at: now.toISOString(),
    count: items.length,
    items,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listBrandFeedRows(
  db: D1Database,
): Promise<BrandFeedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.name, b.status,
              g.id AS group_id, g.slug AS group_slug, g.name AS group_name
         FROM brands b
         LEFT JOIN groups g ON g.id = b.group_id
        ORDER BY b.slug`,
    )
    .all<BrandFeedRow>();
  return results;
}

export async function listGroupFeedRows(
  db: D1Database,
): Promise<Omit<GroupFeedItem, "url">[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.slug, g.name, g.wikidata_id, g.website,
              (SELECT COUNT(*) FROM brands b WHERE b.group_id = g.id) AS brand_count
         FROM groups g
        ORDER BY g.slug`,
    )
    .all<Omit<GroupFeedItem, "url">>();
  return results;
}

export async function getBrandBySlug(
  db: D1Database,
  slug: string,
): Promise<BrandRow | null> {
  return db
    .prepare(`SELECT * FROM brands WHERE slug = ?`)
    .bind(slug)
    .first<BrandRow>();
}

/** Resolve a site's own brand identifier (GPHG brand_id, Only Watch brand_id…) to a registry brand. */
export async function findBrandByAlias(
  db: D1Database,
  source: BrandAliasSource,
  alias: string,
): Promise<BrandRow | null> {
  return db
    .prepare(
      `SELECT b.* FROM brand_aliases a JOIN brands b ON b.id = a.brand_id
        WHERE a.source = ? AND a.alias = ?`,
    )
    .bind(source, alias)
    .first<BrandRow>();
}

export async function listBrandPeople(
  db: D1Database,
  brandId: number,
): Promise<BrandPersonRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM brand_people WHERE brand_id = ?
        ORDER BY from_year IS NULL, from_year, name`,
    )
    .bind(brandId)
    .all<BrandPersonRow>();
  return results;
}

export async function listWatchReferences(
  db: D1Database,
  brandId: number,
  { activeOnly = true }: { activeOnly?: boolean } = {},
): Promise<WatchReferenceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM watch_references
        WHERE brand_id = ? AND (? = 0 OR active = 1)
        ORDER BY family IS NULL, family, ref_code`,
    )
    .bind(brandId, activeOnly ? 1 : 0)
    .all<WatchReferenceRow>();
  return results;
}

export async function getWatchReferenceBySlug(
  db: D1Database,
  slug: string,
): Promise<WatchReferenceRow | null> {
  return db
    .prepare(`SELECT * FROM watch_references WHERE slug = ?`)
    .bind(slug)
    .first<WatchReferenceRow>();
}

// ── Page queries (unit 3) ────────────────────────────────────────────────────

/** A brand joined to its group, as listed on /brands, /group/<slug> and the hub. */
export interface BrandDirectoryRow {
  id: number;
  slug: string;
  name: string;
  status: BrandStatus | null;
  founded_year: number | null;
  dissolved_year: number | null;
  group_id: number | null;
  group_slug: string | null;
  group_name: string | null;
}

export interface BrandDirectoryFilter {
  /** One status, or "unknown" for brands whose status is NULL. */
  status?: BrandStatus | "unknown";
  /** A group slug, or "independent" for brands without a group. */
  group?: string;
  /** Restrict to these statuses (the dormant-and-defunct hub). */
  statuses?: BrandStatus[];
}

export async function listBrandDirectory(
  db: D1Database,
  filter: BrandDirectoryFilter = {},
): Promise<BrandDirectoryRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.status === "unknown") where.push("b.status IS NULL");
  else if (filter.status) {
    where.push("b.status = ?");
    binds.push(filter.status);
  }
  if (filter.group === "independent") where.push("b.group_id IS NULL");
  else if (filter.group) {
    where.push("g.slug = ?");
    binds.push(filter.group);
  }
  if (filter.statuses?.length) {
    where.push(`b.status IN (${filter.statuses.map(() => "?").join(",")})`);
    binds.push(...filter.statuses);
  }
  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.name, b.status, b.founded_year, b.dissolved_year,
              g.id AS group_id, g.slug AS group_slug, g.name AS group_name
         FROM brands b
         LEFT JOIN groups g ON g.id = b.group_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY b.name COLLATE NOCASE, b.slug`,
    )
    .bind(...binds)
    .all<BrandDirectoryRow>();
  return results;
}

export async function getGroupBySlug(
  db: D1Database,
  slug: string,
): Promise<GroupRow | null> {
  return db
    .prepare(`SELECT * FROM groups WHERE slug = ?`)
    .bind(slug)
    .first<GroupRow>();
}

export async function getGroupById(
  db: D1Database,
  id: number,
): Promise<GroupRow | null> {
  return db.prepare(`SELECT * FROM groups WHERE id = ?`).bind(id).first<GroupRow>();
}

export async function listGroups(db: D1Database): Promise<GroupRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM groups ORDER BY name COLLATE NOCASE`)
    .all<GroupRow>();
  return results;
}

export async function listBrandAliases(
  db: D1Database,
  brandId: number,
): Promise<BrandAliasRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM brand_aliases WHERE brand_id = ? ORDER BY source, alias`)
    .bind(brandId)
    .all<BrandAliasRow>();
  return results;
}

/** The facts that make a brand page worth indexing. */
export interface BrandFactFields {
  group_id: number | null;
  founded_year: number | null;
  dissolved_year: number | null;
  status: BrandStatus | null;
  hq_city: string | null;
  hq_country: string | null;
  website: string | null;
  wikidata_id: string | null;
}

/**
 * True when a brand has nothing beyond its name: no group, founding or dissolution year,
 * status, headquarters, website, Wikidata id or people. The single definition behind
 * noindex on the brand page and its absence from the sitemap, so a brand becomes
 * indexable automatically once it has any fact.
 */
export function isNameOnly(brand: BrandFactFields, peopleCount: number): boolean {
  return (
    peopleCount === 0 &&
    brand.group_id == null &&
    brand.founded_year == null &&
    brand.dissolved_year == null &&
    brand.status == null &&
    brand.hq_city == null &&
    brand.hq_country == null &&
    brand.website == null &&
    brand.wikidata_id == null
  );
}

/** Slug and last-modified date of every indexable brand and every group, for the sitemap. */
export async function listSitemapRows(
  db: D1Database,
): Promise<{ kind: "brand" | "group"; slug: string; updated_at: string }[]> {
  const { results: brands } = await db
    .prepare(
      `SELECT b.slug, b.updated_at, b.group_id, b.founded_year, b.dissolved_year, b.status,
              b.hq_city, b.hq_country, b.website, b.wikidata_id,
              (SELECT COUNT(*) FROM brand_people p WHERE p.brand_id = b.id) AS people_count
         FROM brands b ORDER BY b.slug`,
    )
    .all<BrandFactFields & { slug: string; updated_at: string; people_count: number }>();
  const { results: groups } = await db
    .prepare(`SELECT slug, updated_at FROM groups ORDER BY slug`)
    .all<{ slug: string; updated_at: string }>();
  return [
    ...brands
      .filter((b) => !isNameOnly(b, b.people_count))
      .map((b) => ({ kind: "brand" as const, slug: b.slug, updated_at: b.updated_at })),
    ...groups.map((g) => ({ kind: "group" as const, slug: g.slug, updated_at: g.updated_at })),
  ];
}
