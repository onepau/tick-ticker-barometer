import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertNoSlugCollisions,
  brandKey,
  findSlugCollisions,
  normaliseRefCode,
  slugFromGphgBrandId,
  slugifyBrand,
  slugifyReference,
  uniqueSlug,
} from "../src/slug.ts";

// Snapshot of tick-ticker-gphg/brands.csv (brand_id, display_name), 6 November 2026.
// Refresh it when GPHG adds brands; the live slugs are slugFromGphgBrandId(brand_id).
const gphg: [string, string][] = JSON.parse(
  readFileSync(new URL("./fixtures/gphg-brands.json", import.meta.url), "utf8"),
);

describe("slugifyBrand: parity with live GPHG slugs", () => {
  it("has the full GPHG brand list", () => {
    expect(gphg.length).toBe(725);
  });

  it("reproduces the GPHG slug for every GPHG brand", () => {
    const mismatches = gphg
      .map(([id, name]) => ({
        name,
        expected: slugFromGphgBrandId(id),
        got: slugifyBrand(name),
      }))
      .filter((r) => r.expected !== r.got);
    expect(mismatches).toEqual([]);
  });

  it("reproduces the GPHG brand_id as the key", () => {
    for (const [id, name] of gphg) expect(brandKey(name)).toBe(id);
  });

  it("gives every GPHG brand a distinct slug", () => {
    expect(findSlugCollisions(gphg.map(([, name]) => name)).size).toBe(0);
  });

  it.each([
    ["Audemars Piguet", "audemars-piguet"],
    ["H. Moser & Cie.", "h-moser"],
    ["L'Epée 1839", "l-epee-1839"],
    ["Andersen Genève", "andersen"],
    ["Van Cleef & Arpels", "van-cleef-arpels"],
    ["Montres du Manège", "du-manege"],
    ["Bvlgari", "bulgari"],
    ["Atelier Akrivia", "akrivia"],
    ["Fiyta-X", "fiyta"],
    ["Suzanne Rohr and Anita Porchet", "suzanne-rohr-anita-porchet"],
  ])("%s → %s", (name, slug) => {
    expect(slugifyBrand(name)).toBe(slug);
  });
});

describe("slugifyBrand: new brands", () => {
  it("folds accents", () => {
    expect(slugifyBrand("Hermès")).toBe("hermes");
    expect(slugifyBrand("Glashütte Original")).toBe("glashutte-original");
    expect(slugifyBrand("Louis Érard")).toBe("louis-erard");
  });

  it("transliterates letters NFKD cannot decompose", () => {
    expect(slugifyBrand("Ørsted Ure")).toBe("orsted-ure");
    expect(slugifyBrand("Straße Uhren")).toBe("strasse-uhren");
    expect(slugifyBrand("Łódź Zegarki")).toBe("lodz-zegarki");
    expect(slugifyBrand("Cæsar")).toBe("caesar");
  });

  it("collapses punctuation, curly quotes and whitespace", () => {
    expect(slugifyBrand("  A. Lange  &  Söhne ")).toBe("a-lange-sohne");
    expect(slugifyBrand("Beda’a")).toBe("beda-a");
    expect(slugifyBrand("TAG-Heuer")).toBe("tag-heuer");
  });

  it("keeps noise words when the name is nothing else", () => {
    expect(slugifyBrand("Montres")).toBe("montres");
    expect(slugifyBrand("Watch Co.")).toBe("watch-co");
  });

  it("throws on a name with no Latin letters or digits", () => {
    expect(() => slugifyBrand("飞亚达")).toThrow(/no usable characters/);
    expect(() => slugifyBrand("  ")).toThrow();
  });

  it("only ever yields lower-case ASCII words joined by single hyphens", () => {
    const samples = ["Ünïcödé Wätch", "A--B", "1815", "X & Y & Z", "Ça va SA"];
    for (const s of samples)
      expect(slugifyBrand(s)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("collision checks", () => {
  it("reports names that share a slug", () => {
    const c = findSlugCollisions(["Andersen Genève", "Andersen", "Omega"]);
    expect([...c]).toEqual([["andersen", ["Andersen", "Andersen Genève"]]]);
  });

  it("ignores the same name given twice", () => {
    expect(findSlugCollisions(["Omega", "Omega"]).size).toBe(0);
  });

  it("assertNoSlugCollisions throws with the clashing names", () => {
    expect(() => assertNoSlugCollisions(["Hermès", "Hermes Watches"])).toThrow(
      /hermes: Hermes Watches \| Hermès/,
    );
    expect(() => assertNoSlugCollisions(["Omega", "Rolex"])).not.toThrow();
  });

  it("uniqueSlug suffixes only when taken", () => {
    expect(uniqueSlug("omega", new Set())).toBe("omega");
    expect(uniqueSlug("omega", new Set(["omega"]))).toBe("omega-2");
    expect(uniqueSlug("omega", new Set(["omega", "omega-2"]))).toBe("omega-3");
  });
});

describe("slugifyReference", () => {
  it.each([
    ["omega", "310.30.42.50.01.001", "omega/310-30-42-50-01-001"],
    ["rolex", "126610LN", "rolex/126610ln"],
    ["patek-philippe", "5711/1A-010", "patek-philippe/5711-1a-010"],
    [
      "audemars-piguet",
      "15500ST.OO.1220ST.01",
      "audemars-piguet/15500st-oo-1220st-01",
    ],
    ["cartier", " WSSA0018 ", "cartier/wssa0018"],
    ["tudor", "M79360N-0001", "tudor/m79360n-0001"],
    ["grand-seiko", "SBGA211", "grand-seiko/sbga211"],
  ])("%s %s → %s", (brand, ref, slug) => {
    expect(slugifyReference(brand, ref)).toBe(slug);
  });

  it("normalises runs of separators and accents", () => {
    expect(normaliseRefCode("IW 3716 -- 05")).toBe("iw-3716-05");
    expect(normaliseRefCode("Réf. 1234")).toBe("ref-1234");
  });

  it("rejects an empty reference or a malformed brand slug", () => {
    expect(() => normaliseRefCode("...")).toThrow();
    expect(() => slugifyReference("Omega", "123")).toThrow(
      /invalid brand slug/,
    );
    expect(() => slugifyReference("omega/", "123")).toThrow();
  });
});
