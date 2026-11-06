/**
 * Build the registry seed (apps/registry/seed/registry_seed.sql) from local files:
 *
 *   tick-ticker-gphg/brands.csv          725 GPHG brands → registry brands (slugs = live GPHG slugs)
 *   tick-ticker-gphg/brand_aliases.csv   raw GPHG spellings → 'gphg' aliases
 *   tick-ticker-onlywatch/worker/{schema.sql,seed/seed_001.sql}
 *                                        Only Watch brands, replayed into in-memory SQLite
 *                                        (the remote onlywatch-db is never queried)
 *
 * Only Watch brands that match no registry brand are written to
 * docs/plans/u1-unmatched-brands.csv for Paul. Fill in its `resolution` column with
 * `new` (create a registry brand) or an existing registry slug (alias to it), then
 * re-run: resolutions are read back and kept.
 *
 * Run from apps/registry:  node scripts/build-seed.ts
 * Override source folders with GPHG_DIR and ONLYWATCH_DIR.
 *
 * The output is idempotent (upserts on slug and on (source, alias)), so re-seeding
 * never renumbers brands.id, which the price tables reference. Apply it locally only:
 *   pnpm --filter @baromontres/registry db:migrate:local
 *   pnpm --filter @baromontres/registry db:seed:local
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  assertNoSlugCollisions,
  slugFromGphgBrandId,
  slugifyBrand,
  uniqueSlug,
} from "@baromontres/shared/slug";
import { readCsvObjects, writeCsv } from "./csv.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const GPHG_DIR = process.env.GPHG_DIR ?? join(homedir(), "tick-ticker-gphg");
const ONLYWATCH_DIR =
  process.env.ONLYWATCH_DIR ?? join(homedir(), "tick-ticker-onlywatch");
const SEED_OUT = join(REPO, "apps/registry/seed/registry_seed.sql");
const UNMATCHED_OUT = join(REPO, "docs/plans/u1-unmatched-brands.csv");

// ── Types ────────────────────────────────────────────────────────────────────

interface SeedBrand {
  slug: string;
  name: string;
  hq_country: string | null;
  website: string | null;
}

interface OnlyWatchBrand {
  brand_id: string;
  brand_name: string;
  gphg_slug: string | null;
  country: string | null;
  website: string | null;
}

export type MatchMethod =
  "gphg_slug" | "name_slug" | "gphg_alias" | "resolution";

export interface Match {
  ow: OnlyWatchBrand;
  slug: string;
  method: MatchMethod;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

function readGphg(dir: string) {
  const brands = readCsvObjects(readFileSync(join(dir, "brands.csv"), "utf8"));
  const aliases = readCsvObjects(
    readFileSync(join(dir, "brand_aliases.csv"), "utf8"),
  );
  return { brands, aliases };
}

function readOnlyWatch(dir: string): OnlyWatchBrand[] {
  const worker = join(dir, "worker");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(worker, "schema.sql"), "utf8"));
  const seedDir = join(worker, "seed");
  for (const f of readdirSync(seedDir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(seedDir, f), "utf8"));
  }
  const rows = db
    .prepare(
      `SELECT brand_id, brand_name, gphg_slug, country, website FROM brands ORDER BY brand_id`,
    )
    .all() as unknown as OnlyWatchBrand[];
  db.close();
  return rows.map((r) => ({
    brand_id: r.brand_id,
    brand_name: r.brand_name,
    gphg_slug: r.gphg_slug?.trim() || null,
    country: r.country?.trim().toUpperCase() || null,
    website: r.website?.trim() || null,
  }));
}

/** Paul's resolutions from a previous run, keyed by Only Watch brand_id. */
function readResolutions(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const r of readCsvObjects(readFileSync(path, "utf8"))) {
    const v = (r.resolution ?? "").trim().toLowerCase();
    if (r.onlywatch_brand_id && v) out.set(r.onlywatch_brand_id, v);
  }
  return out;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Sørensen–Dice similarity on character bigrams, for "did you mean" suggestions. */
export function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++)
      m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  return total === 0 ? (a === b ? 1 : 0) : (2 * overlap) / total;
}

export function matchOnlyWatch(
  ow: OnlyWatchBrand,
  registry: ReadonlySet<string>,
  gphgAliasToSlug: ReadonlyMap<string, string>,
  resolutions: ReadonlyMap<string, string>,
): Match | null {
  if (ow.gphg_slug) {
    const slug = slugFromGphgBrandId(ow.gphg_slug);
    if (registry.has(slug)) return { ow, slug, method: "gphg_slug" };
  }
  let nameSlug: string | null = null;
  try {
    nameSlug = slugifyBrand(ow.brand_name);
  } catch {
    // No Latin characters: fall through to aliases and resolutions.
  }
  if (nameSlug && registry.has(nameSlug))
    return { ow, slug: nameSlug, method: "name_slug" };
  const viaAlias = gphgAliasToSlug.get(ow.brand_name.trim().toLowerCase());
  if (viaAlias) return { ow, slug: viaAlias, method: "gphg_alias" };
  const resolved = resolutions.get(ow.brand_id);
  if (resolved && resolved !== "new" && registry.has(resolved))
    return { ow, slug: resolved, method: "resolution" };
  return null;
}

// ── SQL output ───────────────────────────────────────────────────────────────

const q = (v: string | null): string =>
  v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function brandsSql(brands: SeedBrand[]): string[] {
  return chunks(brands, 100).map(
    (part) =>
      `INSERT INTO brands (slug, name, hq_country, website) VALUES\n` +
      part
        .map(
          (b) =>
            `  (${q(b.slug)}, ${q(b.name)}, ${q(b.hq_country)}, ${q(b.website)})`,
        )
        .join(",\n") +
      `\nON CONFLICT(slug) DO UPDATE SET\n` +
      `  name = excluded.name,\n` +
      `  hq_country = COALESCE(brands.hq_country, excluded.hq_country),\n` +
      `  website = COALESCE(brands.website, excluded.website),\n` +
      `  updated_at = datetime('now');`,
  );
}

export function aliasesSql(
  source: string,
  pairs: [alias: string, slug: string][],
): string[] {
  return chunks(pairs, 100).map(
    (part) =>
      `INSERT INTO brand_aliases (alias, source, brand_id)\n` +
      `SELECT v.column1, ${q(source)}, b.id FROM (VALUES\n` +
      part.map(([a, s]) => `  (${q(a)}, ${q(s)})`).join(",\n") +
      `\n) AS v JOIN brands b ON b.slug = v.column2 WHERE true\n` +
      `ON CONFLICT(source, alias) DO UPDATE SET brand_id = excluded.brand_id;`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const { brands: gphgBrands, aliases: gphgAliases } = readGphg(GPHG_DIR);
  const owBrands = readOnlyWatch(ONLYWATCH_DIR);
  const resolutions = readResolutions(UNMATCHED_OUT);

  // 1. GPHG brands: slug is the live GPHG slug; prove slugifyBrand agrees.
  const seed = new Map<string, SeedBrand>();
  const drift: string[] = [];
  for (const b of gphgBrands) {
    const slug = slugFromGphgBrandId(b.brand_id!);
    if (slugifyBrand(b.display_name!) !== slug)
      drift.push(
        `${b.display_name} → ${slugifyBrand(b.display_name!)} ≠ ${slug}`,
      );
    seed.set(slug, {
      slug,
      name: b.display_name!,
      hq_country: null,
      website: null,
    });
  }
  if (drift.length)
    throw new Error(
      `slugifyBrand disagrees with GPHG for:\n  ${drift.join("\n  ")}`,
    );
  assertNoSlugCollisions(gphgBrands.map((b) => b.display_name!));

  // 2. GPHG aliases: the brand_id itself plus every raw spelling.
  const gphgAliasPairs = new Map<string, string>();
  const addGphgAlias = (alias: string, slug: string) => {
    const prev = gphgAliasPairs.get(alias);
    if (prev && prev !== slug)
      throw new Error(
        `GPHG alias ${JSON.stringify(alias)} maps to both ${prev} and ${slug}`,
      );
    gphgAliasPairs.set(alias, slug);
  };
  for (const b of gphgBrands)
    addGphgAlias(b.brand_id!, slugFromGphgBrandId(b.brand_id!));
  const orphanAliases: string[] = [];
  for (const a of gphgAliases) {
    const slug = slugFromGphgBrandId(a.brand_id!);
    if (!seed.has(slug)) {
      orphanAliases.push(a.Brand!);
      continue;
    }
    addGphgAlias(a.Brand!, slug);
  }
  // Case-insensitive lookup of raw spellings and display names, for Only Watch matching.
  const aliasLookup = new Map<string, string>();
  for (const [alias, slug] of gphgAliasPairs)
    aliasLookup.set(alias.trim().toLowerCase(), slug);
  for (const b of seed.values())
    aliasLookup.set(b.name.trim().toLowerCase(), b.slug);

  // 3. Only Watch brands.
  const registry = new Set(seed.keys());
  const matches: Match[] = [];
  const unmatched: OnlyWatchBrand[] = [];
  for (const ow of owBrands) {
    const m = matchOnlyWatch(ow, registry, aliasLookup, resolutions);
    if (m) matches.push(m);
    else unmatched.push(ow);
  }
  // Only Watch's country and website fill gaps on matched brands.
  for (const m of matches) {
    const b = seed.get(m.slug)!;
    b.hq_country ??= m.ow.country;
    b.website ??= m.ow.website;
  }

  // 4. Unmatched brands Paul has marked `new` become registry brands.
  const created: Match[] = [];
  const pending: OnlyWatchBrand[] = [];
  for (const ow of unmatched) {
    if (resolutions.get(ow.brand_id) === "new") {
      const slug = uniqueSlug(slugifyBrand(ow.brand_name), registry);
      registry.add(slug);
      seed.set(slug, {
        slug,
        name: ow.brand_name,
        hq_country: ow.country,
        website: ow.website,
      });
      created.push({ ow, slug, method: "resolution" });
    } else pending.push(ow);
  }

  // 5. Write the unmatched list (all unmatched, with any resolution kept).
  const unmatchedRows = unmatched.map((ow) => {
    let suggested = "";
    try {
      suggested = slugifyBrand(ow.brand_name);
    } catch {
      suggested = "";
    }
    const nearest = [...seed.keys()]
      .filter((s) => !created.some((c) => c.slug === s))
      .map((s) => [s, dice(suggested || ow.brand_id, s)] as const)
      .filter(([, score]) => score >= 0.45)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, score]) => `${s} (${score.toFixed(2)})`)
      .join("; ");
    return [
      ow.brand_id,
      ow.brand_name,
      ow.gphg_slug,
      ow.country,
      ow.website,
      suggested,
      registry.has(suggested) && !created.some((c) => c.slug === suggested)
        ? "taken"
        : "free",
      nearest,
      resolutions.get(ow.brand_id) ?? "",
    ];
  });
  mkdirSync(dirname(UNMATCHED_OUT), { recursive: true });
  writeFileSync(
    UNMATCHED_OUT,
    writeCsv(
      [
        "onlywatch_brand_id",
        "onlywatch_name",
        "onlywatch_gphg_slug",
        "country",
        "website",
        "suggested_slug",
        "suggested_slug_status",
        "nearest_registry_slugs",
        "resolution",
      ],
      unmatchedRows,
    ),
  );

  // 6. Seed SQL.
  const allBrands = [...seed.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
  const owAliasPairs: [string, string][] = [...matches, ...created].map((m) => [
    m.ow.brand_id,
    m.slug,
  ]);
  const sql = [
    "-- Generated by apps/registry/scripts/build-seed.ts. Do not edit by hand; re-run the script.",
    `-- Sources: ${gphgBrands.length} GPHG brands, ${gphgAliasPairs.size} GPHG aliases, ` +
      `${owBrands.length} Only Watch brands (${matches.length} matched, ${created.length} created, ${pending.length} pending).`,
    "-- Idempotent: upserts on brands.slug and brand_aliases(source, alias). Local use only until reviewed.",
    "",
    ...brandsSql(allBrands),
    "",
    ...aliasesSql(
      "gphg",
      [...gphgAliasPairs].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    "",
    ...aliasesSql(
      "onlywatch",
      owAliasPairs.sort((a, b) => a[0].localeCompare(b[0])),
    ),
    "",
  ].join("\n");
  mkdirSync(dirname(SEED_OUT), { recursive: true });
  writeFileSync(SEED_OUT, sql);

  // 7. Self-check: apply migrations and the seed twice to an in-memory database.
  const check = new DatabaseSync(":memory:");
  check.exec("PRAGMA foreign_keys = ON");
  const migrations = join(REPO, "migrations");
  for (const f of readdirSync(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    check.exec(readFileSync(join(migrations, f), "utf8"));
  }
  check.exec(sql);
  const ids = JSON.stringify(
    check.prepare("SELECT id, slug FROM brands ORDER BY id").all(),
  );
  check.exec(sql);
  if (
    JSON.stringify(
      check.prepare("SELECT id, slug FROM brands ORDER BY id").all(),
    ) !== ids
  ) {
    throw new Error("Re-applying the seed changed brand ids");
  }
  const count = (t: string, w = "1") =>
    (
      check.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${w}`).get() as {
        n: number;
      }
    ).n;

  const byMethod = matches.reduce<Record<string, number>>(
    (acc, m) => ((acc[m.method] = (acc[m.method] ?? 0) + 1), acc),
    {},
  );
  console.log(`brands            ${count("brands")}`);
  console.log(`gphg aliases      ${count("brand_aliases", "source = 'gphg'")}`);
  console.log(
    `onlywatch aliases ${count("brand_aliases", "source = 'onlywatch'")}`,
  );
  console.log(
    `only watch        ${owBrands.length}: matched ${matches.length} ${JSON.stringify(byMethod)}, created ${created.length}, pending ${pending.length}`,
  );
  if (orphanAliases.length)
    console.log(
      `skipped ${orphanAliases.length} GPHG aliases whose brand_id is not in brands.csv`,
    );
  console.log(`wrote ${SEED_OUT}`);
  console.log(`wrote ${UNMATCHED_OUT}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
