/**
 * Brand registry: row types, SQL and feed shapes for migrations 0005 and 0006.
 *
 * Kept apart from queries.ts (an agreed deviation) so the registry and price branches
 * can work in parallel without editing the same file.
 *
 * Re-exports the slug helpers so index.ts needs a single export line.
 */

export * from './slug.ts';

/** Public origin of the registry Worker. TODO: confirm the hostname before launch. */
export const REGISTRY_ORIGIN = "https://registry.tick-ticker.com";

export type BrandStatus = "active" | "dormant" | "dead" | "revived";
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
  status: BrandStatus | null;
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

export const brandUrl = (slug: string): string =>
  `${REGISTRY_ORIGIN}/brand/${slug}`;
export const groupUrl = (slug: string): string =>
  `${REGISTRY_ORIGIN}/group/${slug}`;

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

export function toBrandFeedItem(row: BrandFeedRow): BrandFeedItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    group:
      row.group_id != null && row.group_slug != null && row.group_name != null
        ? { id: row.group_id, slug: row.group_slug, name: row.group_name }
        : null,
    status: row.status,
    url: brandUrl(row.slug),
    price_url: null,
  };
}

export function toGroupFeedItem(
  row: Omit<GroupFeedItem, "url">,
): GroupFeedItem {
  return { ...row, url: groupUrl(row.slug) };
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
  /** Restrict to these statuses (the dormant-and-dead hub). */
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

/** Slug and last-modified date of every brand and group, for the sitemap. */
export async function listSitemapRows(
  db: D1Database,
): Promise<{ kind: "brand" | "group"; slug: string; updated_at: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT 'brand' AS kind, slug, updated_at FROM brands
       UNION ALL
       SELECT 'group' AS kind, slug, updated_at FROM groups
       ORDER BY kind, slug`,
    )
    .all<{ kind: "brand" | "group"; slug: string; updated_at: string }>();
  return results;
}
