import { describe, expect, it } from "vitest";
import {
  groupSlug,
  loadInMemory,
  normaliseCountry,
  parseCorrections,
  planReview,
} from "../scripts/review-to-sql.ts";
import { CSV_HEADER } from "../scripts/wikidata-seed.ts";

const row = (over: Record<string, string>) =>
  Object.fromEntries(CSV_HEADER.map((h) => [h, over[h] ?? ""])) as Record<string, string>;

const reg = (slug: string, over: Record<string, string> = {}) =>
  row({ slug, name: slug, match_confidence: "none", source: "registry", ...over });
const matched = (slug: string, over: Record<string, string> = {}) =>
  row({
    slug,
    name: slug,
    wikidata_id: "Q1",
    match_confidence: "exact",
    source: "registry+wikidata",
    ...over,
  });
const fresh = (slug: string, over: Record<string, string> = {}) =>
  row({
    slug,
    name: slug,
    wikidata_id: "Q99",
    match_confidence: "new",
    source: "wikidata",
    ...over,
  });

// Real seed brands (registry_seed.sql) so the "existing" rows exist in the database.
const apply = (rows: Record<string, string>[], times = 1) => {
  const { sql } = planReview(rows);
  const db = loadInMemory([]);
  for (let i = 0; i < times; i++) db.exec(sql);
  return db;
};
const brand = (db: ReturnType<typeof apply>, slug: string) =>
  db.prepare("SELECT * FROM brands WHERE slug = ?").get(slug) as any;

const ebel = "ebel";
const lange = "a-lange-sohne";

describe("corrections parsing", () => {
  it("reads pairs and empty values", () => {
    expect(parseCorrections("group=; hq_city=Bienne", "x")).toEqual(
      new Map([["group", ""], ["hq_city", "Bienne"]]),
    );
  });
  it("aborts on unknown fields, bare chunks and duplicates", () => {
    expect(() => parseCorrections("colour=red", "x")).toThrow(/unknown correction field/);
    expect(() => parseCorrections("just text", "x")).toThrow(/malformed/);
    expect(() => parseCorrections("group=a; group=b", "x")).toThrow(/twice/);
  });
});

describe("country and group helpers", () => {
  it("normalises country names to ISO alpha-2", () => {
    expect(normaliseCountry("Switzerland")).toBe("CH");
    expect(normaliseCountry("ch")).toBe("CH");
    expect(normaliseCountry("United States")).toBe("US");
    expect(normaliseCountry("Atlantis")).toBeNull();
  });
  it("slugs groups without dropping words like Group", () => {
    expect(groupSlug("The Swatch Group")).toBe("the-swatch-group");
    expect(groupSlug("LVMH Moët Hennessy")).toBe("lvmh-moet-hennessy");
  });
});

describe("planReview", () => {
  it("skips rejected rows: Wikidata-only rows are not inserted, registry brands untouched", () => {
    const db = apply([
      fresh("rejected-co", { status: "reject" }),
      reg(ebel, { status: "reject", corrections: "group=Chanel" }),
    ]);
    expect(brand(db, "rejected-co")).toBeUndefined();
    expect(brand(db, ebel)).toBeDefined();
    expect(brand(db, ebel).group_id).toBeNull();
    expect(db.prepare("SELECT count(*) n FROM groups").get()).toEqual({ n: 0 });
  });

  it("creates and links a group from a correction, reusing it by name or slug", () => {
    const db = apply([reg(ebel, { corrections: "group=Chanel" }), reg(lange, { corrections: "group=chanel" })]);
    const groups = db.prepare("SELECT slug, name FROM groups").all();
    expect(groups).toEqual([{ slug: "chanel", name: "Chanel" }]);
    expect(brand(db, ebel).group_id).toBe(brand(db, lange).group_id);
    expect(brand(db, ebel).group_id).not.toBeNull();
  });

  it("clears a field with `field=`", () => {
    const db = loadInMemory([planReview([matched(ebel, { group: "Movado" })]).sql]);
    expect(brand(db, ebel).group_id).not.toBeNull();
    db.exec(planReview([matched(ebel, { group: "Movado", corrections: "group=" })]).sql);
    expect(brand(db, ebel).group_id).toBeNull();
  });

  it("normalises hq_country in corrections to alpha-2", () => {
    const db = apply([reg(ebel, { corrections: "hq_city=Grenchen; hq_country=Switzerland" })]);
    expect(brand(db, ebel)).toMatchObject({ hq_city: "Grenchen", hq_country: "CH" });
  });

  it("Wikidata facts fill blanks but never overwrite existing registry data", () => {
    const db = loadInMemory([]);
    db.exec("UPDATE brands SET website = 'https://kept.example' WHERE slug = 'ebel'");
    db.exec(planReview([matched(ebel, { website: "https://other.example", founded_year: "1911", hq_country: "CH" })]).sql);
    expect(brand(db, ebel)).toMatchObject({ website: "https://kept.example", founded_year: 1911, hq_country: "CH", wikidata_id: "Q1" });
  });

  it("status: explicit, else suggested, else untouched; dead for dissolved", () => {
    const db = apply([
      matched(ebel, { status_suggested: "active" }),
      matched(lange, { wikidata_id: "Q2", status_suggested: "active", status: "dormant" }),
      reg("audemars-piguet"),
    ]);
    expect(brand(db, ebel).status).toBe("active");
    expect(brand(db, lange).status).toBe("dormant");
    expect(brand(db, "audemars-piguet").status).toBeNull();
  });

  it("inserts new brands and fills founders", () => {
    const db = apply([fresh("farer", { name: "Farer", founded_year: "2015", founders: "A B; C D", status_suggested: "active" })]);
    expect(brand(db, "farer")).toMatchObject({ name: "Farer", founded_year: 2015, status: "active", wikidata_id: "Q99" });
    const people = db.prepare("SELECT name, role FROM brand_people ORDER BY name").all();
    expect(people).toEqual([{ name: "A B", role: "founder" }, { name: "C D", role: "founder" }]);
  });

  it("is idempotent on a second run and leaves ids and slugs alone", () => {
    const rows = [
      matched(ebel, { group: "Movado", founders: "X Y", corrections: "group=Chanel" }),
      fresh("farer", { name: "Farer", founders: "A B", group: "Citizen Watch" }),
      reg(lange, { corrections: "hq_city=Glashütte" }),
    ];
    const snapshot = (db: ReturnType<typeof apply>) => ({
      brands: db.prepare("SELECT id, slug, name, group_id, founded_year, status, hq_city, hq_country, website, wikidata_id FROM brands ORDER BY id").all(),
      groups: db.prepare("SELECT id, slug, name FROM groups ORDER BY id").all(),
      people: db.prepare("SELECT brand_id, name, role FROM brand_people ORDER BY id").all(),
    });
    const base = loadInMemory([]);
    const baseBrands = base.prepare("SELECT id, slug FROM brands ORDER BY id").all();
    const once = snapshot(apply(rows, 1));
    const twice = snapshot(apply(rows, 2));
    expect(twice).toEqual(once);
    // Existing ids and slugs unchanged; only new brands are appended.
    expect(once.brands.slice(0, baseBrands.length).map((b: any) => ({ id: b.id, slug: b.slug }))).toEqual(baseBrands);
    expect(once.brands.length).toBe(baseBrands.length + 1);
  });

  it("aborts with a clear error on bad input", () => {
    expect(() => planReview([reg(ebel, { status: "zombie" })])).toThrow(/unknown status/);
    expect(() => planReview([reg(ebel, { corrections: "nope=1" })])).toThrow(/line 2 \(ebel\).*unknown correction field/);
    expect(() => planReview([reg(ebel, { hq_country: "Atlantis" })])).toThrow(/unknown hq_country/);
    expect(() => planReview([reg("Bad Slug")])).toThrow(/invalid slug/);
    expect(() => planReview([reg(ebel), reg(ebel)])).toThrow(/duplicate slug/);
    expect(() => planReview([fresh(ebel), reg(ebel)])).toThrow(/duplicate slug|collides/);
    expect(() => planReview([fresh("x", { match_confidence: "ambiguous" })])).toThrow(/ambiguous/);
    expect(() => planReview([reg(ebel, { founded_year: "2000", dissolved_year: "1990" })])).toThrow(/before founded_year/);
    expect(() => planReview([reg(ebel, { founded_year: "abc" })])).toThrow(/founded_year/);
  });
});
