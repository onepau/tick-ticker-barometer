/**
 * Unit 2 loader: turn Paul's reviewed CSV into an idempotent SQL file. Never touches D1.
 *
 *   node scripts/review-to-sql.ts             # write seed/registry_review.sql
 *   node scripts/review-to-sql.ts --summary   # also print a markdown dry-run summary
 *
 * Run from apps/registry, after registry_seed.sql has been applied. Reads
 * docs/plans/u2-registry-review.csv (do NOT regenerate it with wikidata-seed.ts: that
 * overwrites the review). Rules:
 *
 *  - status `reject` skips the row. Wikidata-only rows are not inserted; registry
 *    brands are never deleted, and a rejected registry row is left untouched.
 *  - Otherwise `status` (active|dormant|dead|revived), else `status_suggested`, sets
 *    brands.status; blank leaves it NULL/unchanged.
 *  - Wikidata facts fill blanks only (COALESCE): they never overwrite data already in
 *    the registry. `corrections` overwrite, and `field=` (empty) clears.
 *  - Existing brand ids and slugs never change. New rows get the slug in the CSV, which
 *    must not collide with a registry row's slug.
 *  - Anything unknown or malformed aborts with an error naming the CSV line.
 *
 * `corrections` is `field=value` pairs separated by `;`. Fields: name, group,
 * founded_year, dissolved_year, hq_city, hq_country (name or ISO alpha-2), website,
 * wikidata_id, status, founders (names separated by `|`, replaces the founder list).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { foldAscii } from "@baromontres/shared/slug";
import { readCsvObjects } from "./csv.ts";
import { CSV_HEADER } from "./wikidata-seed.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CSV_IN = join(REPO, "docs/plans/u2-registry-review.csv");
const SQL_OUT = join(REPO, "apps/registry/seed/registry_review.sql");

export interface ReviewRow {
  slug: string;
  name: string;
  name_fr: string;
  wikidata_id: string;
  group: string;
  founded_year: string;
  dissolved_year: string;
  status_suggested: string;
  hq_city: string;
  hq_country: string;
  website: string;
  founders: string;
  match_confidence: string;
  source: string;
  corrections: string;
  status: string;
}

const STATUSES = ["active", "dormant", "dead", "revived"] as const;
type Status = (typeof STATUSES)[number];
const FIELDS = [
  "name",
  "group",
  "founded_year",
  "dissolved_year",
  "hq_city",
  "hq_country",
  "website",
  "wikidata_id",
  "status",
  "founders",
] as const;
type Field = (typeof FIELDS)[number];

export interface Plan {
  sql: string;
  summary: {
    rows: number;
    rejected: number;
    updated: number; // existing registry brands with something to set
    inserted: number; // new brands
    untouched: number; // registry brands with nothing to apply
    groups: string[]; // groups referenced (created only when absent)
  };
  /** Rows Paul corrected: Wikidata value (before) → applied value (after). */
  changes: { slug: string; field: string; before: string; after: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lit = (v: string | number | null) =>
  v === null ? "NULL" : typeof v === "number" ? String(v) : q(v);

let COUNTRY_LOOKUP: Map<string, string> | undefined;
/** ISO 3166-1 alpha-2 from a code or an English country name; null when unknown. */
export function normaliseCountry(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (!COUNTRY_LOOKUP) {
    COUNTRY_LOOKUP = new Map();
    const names = new Intl.DisplayNames("en", { type: "region" });
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const n = names.of(code);
        if (n && n !== code) COUNTRY_LOOKUP.set(foldAscii(n), code);
      }
    for (const [n, c] of [
      ["usa", "US"],
      ["america", "US"],
      ["uk", "GB"],
      ["great britain", "GB"],
      ["england", "GB"],
      ["czech republic", "CZ"],
      ["holland", "NL"],
      ["soviet union", "SU"],
      ["hongkong", "HK"],
    ] as const)
      COUNTRY_LOOKUP.set(n, c);
  }
  return COUNTRY_LOOKUP.get(foldAscii(s)) ?? null;
}

/** Group slug: folded, hyphenated words. Unlike brand slugs it keeps words such as "Group". */
export function groupSlug(name: string): string {
  const s = foldAscii(name)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s)
    throw new Error(
      `group name has no usable characters: ${JSON.stringify(name)}`,
    );
  return s;
}

/** Parse `a=1; b=; c=x` into pairs. A chunk without `=` is an error. */
export function parseCorrections(
  text: string,
  where: string,
): Map<Field, string> {
  const out = new Map<Field, string>();
  for (const chunk of text.split(";")) {
    if (!chunk.trim()) continue;
    const i = chunk.indexOf("=");
    if (i < 0)
      throw new Error(
        `${where}: malformed correction ${JSON.stringify(chunk.trim())} (expected field=value)`,
      );
    const field = chunk.slice(0, i).trim() as Field;
    if (!FIELDS.includes(field))
      throw new Error(
        `${where}: unknown correction field ${JSON.stringify(field)} (allowed: ${FIELDS.join(", ")})`,
      );
    if (out.has(field))
      throw new Error(`${where}: field ${field} corrected twice`);
    out.set(field, chunk.slice(i + 1).trim());
  }
  return out;
}

function parseYear(v: string, field: string, where: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1500 || n > 2100)
    throw new Error(
      `${where}: ${field} must be a year 1500-2100, got ${JSON.stringify(v)}`,
    );
  return n;
}

function parseStatus(v: string, where: string): Status | null {
  if (v === "") return null;
  if (!(STATUSES as readonly string[]).includes(v))
    throw new Error(
      `${where}: unknown status ${JSON.stringify(v)} (allowed: ${STATUSES.join(", ")}, reject)`,
    );
  return v as Status;
}

interface Facts {
  name: string;
  group: string; // "" = none
  founded: number | null;
  dissolved: number | null;
  city: string;
  country: string | null;
  website: string;
  wikidata: string;
  founders: string[];
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export function planReview(input: Record<string, string>[]): Plan {
  const rows = input as unknown as ReviewRow[];
  if (rows.length === 0) throw new Error("review CSV has no rows");
  for (const h of CSV_HEADER)
    if (!(h in rows[0]!)) throw new Error(`review CSV is missing column ${h}`);

  const registrySlugs = new Set(
    rows.filter((r) => r.source.startsWith("registry")).map((r) => r.slug),
  );
  const seenSlugs = new Set<string>();
  const seenWd = new Set<string>();
  const groups = new Map<string, string>(); // slug → name
  const groupSql: string[] = [];
  const brandSql: string[] = [];
  const peopleSql: string[] = [];
  const plan: Plan = {
    sql: "",
    summary: {
      rows: rows.length,
      rejected: 0,
      updated: 0,
      inserted: 0,
      untouched: 0,
      groups: [],
    },
    changes: [],
  };

  const groupRef = (name: string) =>
    `(SELECT id FROM groups WHERE slug = ${q(groupSlug(name))} OR lower(name) = lower(${q(name)}) ORDER BY (slug = ${q(groupSlug(name))}) DESC LIMIT 1)`;
  const ensureGroup = (name: string) => {
    const slug = groupSlug(name);
    if (groups.has(slug)) return;
    groups.set(slug, name);
    groupSql.push(
      `INSERT INTO groups (slug, name) SELECT ${q(slug)}, ${q(name)} WHERE NOT EXISTS (SELECT 1 FROM groups WHERE slug = ${q(slug)} OR lower(name) = lower(${q(name)}));`,
    );
  };

  rows.forEach((r, idx) => {
    const where = `line ${idx + 2} (${r.slug || "no slug"})`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug))
      throw new Error(`${where}: invalid slug`);
    if (seenSlugs.has(r.slug)) throw new Error(`${where}: duplicate slug`);
    seenSlugs.add(r.slug);
    if (
      !["registry", "registry+wikidata", "wikidata"].includes(
        r.source.split(";")[0]!.trim(),
      )
    )
      throw new Error(`${where}: unknown source ${JSON.stringify(r.source)}`);
    const isNewRow = r.source.startsWith("wikidata");
    if (r.status === "reject") {
      plan.summary.rejected++;
      return;
    }
    if (isNewRow && r.match_confidence === "ambiguous")
      throw new Error(
        `${where}: ambiguous Wikidata match must be resolved (delete the row or set status=reject)`,
      );
    if (isNewRow && registrySlugs.has(r.slug))
      throw new Error(
        `${where}: new brand slug collides with a registry brand`,
      );
    if (!r.name) throw new Error(`${where}: missing name`);

    const status = parseStatus(
      r.status === "" ? r.status_suggested : r.status,
      where,
    );
    const fixes = parseCorrections(r.corrections, where);

    // Wikidata facts as in the CSV (the "before"), then Paul's corrections on top.
    const wd: Facts = {
      name: r.name,
      group: r.group,
      founded: parseYear(r.founded_year, "founded_year", where),
      dissolved: parseYear(r.dissolved_year, "dissolved_year", where),
      city: r.hq_city,
      country: r.hq_country === "" ? null : normaliseCountry(r.hq_country),
      website: r.website,
      wikidata: r.wikidata_id,
      founders: r.founders
        ? r.founders
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    };
    if (r.hq_country && wd.country === null)
      throw new Error(
        `${where}: unknown hq_country ${JSON.stringify(r.hq_country)}`,
      );
    if (wd.wikidata && !/^Q[0-9]+$/.test(wd.wikidata))
      throw new Error(`${where}: bad wikidata_id`);

    const corrected = new Set<Field>();
    const eff: Facts = { ...wd };
    let statusFix: Status | null | undefined; // undefined = no correction
    for (const [f, v] of fixes) {
      corrected.add(f);
      switch (f) {
        case "name":
          if (!v) throw new Error(`${where}: name cannot be cleared`);
          eff.name = v;
          break;
        case "group":
          eff.group = v;
          break;
        case "founded_year":
          eff.founded = parseYear(v, f, where);
          break;
        case "dissolved_year":
          eff.dissolved = parseYear(v, f, where);
          break;
        case "hq_city":
          eff.city = v;
          break;
        case "hq_country": {
          const c = v === "" ? null : normaliseCountry(v);
          if (v && c === null)
            throw new Error(
              `${where}: unknown hq_country ${JSON.stringify(v)}`,
            );
          eff.country = c;
          break;
        }
        case "website":
          eff.website = v;
          break;
        case "wikidata_id":
          if (v && !/^Q[0-9]+$/.test(v))
            throw new Error(`${where}: bad wikidata_id ${JSON.stringify(v)}`);
          eff.wikidata = v;
          break;
        case "status":
          statusFix = parseStatus(v, where);
          break;
        case "founders":
          eff.founders = v
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
          break;
      }
      const before =
        f === "status"
          ? r.status_suggested || ""
          : f === "founders"
            ? r.founders
            : String(
                (wd as any)[
                  f === "group"
                    ? "group"
                    : f === "founded_year"
                      ? "founded"
                      : f === "dissolved_year"
                        ? "dissolved"
                        : f === "hq_city"
                          ? "city"
                          : f === "hq_country"
                            ? "country"
                            : f === "wikidata_id"
                              ? "wikidata"
                              : f
                ] ?? "",
              );
      plan.changes.push({ slug: r.slug, field: f, before, after: v });
    }
    if (
      eff.founded !== null &&
      eff.dissolved !== null &&
      eff.dissolved < eff.founded
    )
      throw new Error(
        `${where}: dissolved_year ${eff.dissolved} is before founded_year ${eff.founded}`,
      );
    const finalStatus = statusFix !== undefined ? statusFix : status;
    if (eff.wikidata) {
      if (seenWd.has(eff.wikidata))
        throw new Error(`${where}: wikidata_id ${eff.wikidata} used twice`);
      seenWd.add(eff.wikidata);
    }
    if (eff.group) ensureGroup(eff.group);

    const groupExpr = eff.group ? groupRef(eff.group) : "NULL";
    if (isNewRow) {
      plan.summary.inserted++;
      const cols =
        "slug, name, group_id, founded_year, dissolved_year, status, hq_city, hq_country, website, wikidata_id";
      const vals = [
        q(r.slug ?? ""),
        q(eff.name),
        groupExpr,
        lit(eff.founded),
        lit(eff.dissolved),
        lit(finalStatus),
        lit(eff.city || null),
        lit(eff.country),
        lit(eff.website || null),
        lit(eff.wikidata || null),
      ].join(", ");
      const set = cols
        .split(", ")
        .slice(1)
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      // Only ever refreshes a row this loader inserted (same wikidata_id).
      brandSql.push(
        `INSERT INTO brands (${cols}) VALUES (${vals}) ON CONFLICT(slug) DO UPDATE SET ${set}, updated_at = datetime('now') WHERE brands.wikidata_id IS excluded.wikidata_id;`,
      );
    } else {
      // Fill blanks from Wikidata; corrections overwrite (empty clears).
      const sets: string[] = [];
      const put = (
        col: string,
        field: Field,
        val: string,
        valueIfEmpty = "NULL",
      ) => {
        if (corrected.has(field)) sets.push(`${col} = ${val || valueIfEmpty}`);
        else if (val) sets.push(`${col} = COALESCE(${col}, ${val})`);
      };
      put("name", "name", corrected.has("name") ? q(eff.name) : "");
      put("group_id", "group", eff.group ? groupExpr : "");
      put(
        "founded_year",
        "founded_year",
        eff.founded === null ? "" : String(eff.founded),
      );
      put(
        "dissolved_year",
        "dissolved_year",
        eff.dissolved === null ? "" : String(eff.dissolved),
      );
      put("hq_city", "hq_city", eff.city ? q(eff.city) : "");
      put("hq_country", "hq_country", eff.country ? q(eff.country) : "");
      put("website", "website", eff.website ? q(eff.website) : "");
      put("wikidata_id", "wikidata_id", eff.wikidata ? q(eff.wikidata) : "");
      if (finalStatus !== null || statusFix === null)
        sets.push(`status = ${lit(finalStatus)}`);
      if (
        sets.length === 0 &&
        !corrected.has("founders") &&
        eff.founders.length === 0
      ) {
        plan.summary.untouched++;
        return;
      }
      plan.summary.updated++;
      if (sets.length > 0)
        brandSql.push(
          `UPDATE brands SET ${sets.join(", ")}, updated_at = datetime('now') WHERE slug = ${q(r.slug ?? "")};`,
        );
    }

    // Founders: a correction replaces the list; otherwise add any that are missing.
    if (corrected.has("founders"))
      peopleSql.push(
        `DELETE FROM brand_people WHERE role = 'founder' AND brand_id = (SELECT id FROM brands WHERE slug = ${q(r.slug ?? "")});`,
      );
    for (const name of eff.founders)
      peopleSql.push(
        `INSERT INTO brand_people (brand_id, name, role) SELECT b.id, ${q(name)}, 'founder' FROM brands b WHERE b.slug = ${q(r.slug ?? "")} AND NOT EXISTS (SELECT 1 FROM brand_people p WHERE p.brand_id = b.id AND p.name = ${q(name)} AND p.role = 'founder');`,
      );
  });

  plan.summary.groups = [...groups.values()].sort();
  plan.sql = [
    "-- Generated by apps/registry/scripts/review-to-sql.ts from docs/plans/u2-registry-review.csv.",
    "-- Do not edit by hand. Run after registry_seed.sql. Idempotent; never deletes brands,",
    "-- never changes an existing slug or id. Wikidata facts fill blanks; corrections overwrite.",
    "",
    "-- Groups (created only when no group has that slug or name)",
    ...groupSql,
    "",
    "-- Brands",
    ...brandSql,
    "",
    "-- Founders",
    ...peopleSql,
    "",
  ].join("\n");
  return plan;
}

/** Markdown dry-run summary for the PR description. `groupsCreated` comes from an in-memory run. */
export function summaryMarkdown(plan: Plan, groupsCreated: string[]): string {
  const s = plan.summary;
  const lines = [
    "| | count |",
    "|---|---|",
    `| CSV rows | ${s.rows} |`,
    `| existing brands updated | ${s.updated} |`,
    `| new brands inserted | ${s.inserted} |`,
    `| rows rejected (skipped) | ${s.rejected} |`,
    `| existing brands untouched | ${s.untouched} |`,
    `| groups created | ${groupsCreated.length}${groupsCreated.length ? ` (${groupsCreated.join(", ")})` : ""} |`,
    "",
    "| brand | field | Wikidata/CSV (before) | applied (after) |",
    "|---|---|---|---|",
    ...plan.changes.map(
      (c) =>
        `| ${c.slug} | ${c.field} | ${c.before || "∅"} | ${c.after || "∅ (cleared)"} |`,
    ),
  ];
  return lines.join("\n");
}

/** Replay migration 0005 + the seed + a review SQL in memory (tests and the dry run). */
export function loadInMemory(sqlFiles: string[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(join(REPO, "migrations/0005_registry_entities.sql"), "utf8"),
  );
  db.exec(
    readFileSync(join(REPO, "apps/registry/seed/registry_seed.sql"), "utf8"),
  );
  for (const f of sqlFiles) db.exec(f);
  return db;
}

function main() {
  const plan = planReview(readCsvObjects(readFileSync(CSV_IN, "utf8")));
  mkdirSync(dirname(SQL_OUT), { recursive: true });
  writeFileSync(SQL_OUT, plan.sql);
  console.log(`wrote ${SQL_OUT}`);
  if (process.argv.includes("--summary")) {
    const base = loadInMemory([]);
    const before = new Set(
      (base.prepare("SELECT slug FROM groups").all() as any[]).map(
        (g) => g.slug,
      ),
    );
    const after = loadInMemory([plan.sql]);
    const created = (
      after
        .prepare("SELECT slug, name FROM groups ORDER BY name")
        .all() as any[]
    )
      .filter((g) => !before.has(g.slug))
      .map((g) => g.name);
    console.log(summaryMarkdown(plan, created));
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
