import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aliasesSql,
  brandsSql,
  dice,
  matchOnlyWatch,
} from "../scripts/build-seed.ts";
import { parseCsv, readCsvObjects, writeCsv } from "../scripts/csv.ts";
import { createTestD1 } from "./d1.ts";

const ow = (over: Partial<Parameters<typeof matchOnlyWatch>[0]> = {}) => ({
  brand_id: "x",
  brand_name: "X",
  gphg_slug: null,
  country: null,
  website: null,
  ...over,
});

describe("Only Watch matching", () => {
  const registry = new Set([
    "andersen",
    "patek-philippe",
    "h-moser",
    "iwc-schaffhausen",
  ]);
  const aliases = new Map([["iwc", "iwc-schaffhausen"]]);

  it("prefers the Only Watch gphg_slug, in either GPHG or hyphen form", () => {
    expect(
      matchOnlyWatch(
        ow({
          brand_id: "andersen-geneve",
          brand_name: "Andersen Genève",
          gphg_slug: "andersen",
        }),
        registry,
        aliases,
        new Map(),
      ),
    ).toMatchObject({ slug: "andersen", method: "gphg_slug" });
    expect(
      matchOnlyWatch(
        ow({ gphg_slug: "patek philippe" }),
        registry,
        aliases,
        new Map(),
      ),
    ).toMatchObject({ slug: "patek-philippe" });
  });

  it("falls back to the slug of the name, then GPHG raw spellings", () => {
    expect(
      matchOnlyWatch(
        ow({ brand_name: "H. Moser & Cie" }),
        registry,
        aliases,
        new Map(),
      ),
    ).toMatchObject({ method: "name_slug", slug: "h-moser" });
    expect(
      matchOnlyWatch(ow({ brand_name: "IWC" }), registry, aliases, new Map()),
    ).toMatchObject({ method: "gphg_alias" });
  });

  it("applies Paul's resolution to an existing slug, and leaves 'new' unmatched", () => {
    const res = new Map([
      ["swatch", "patek-philippe"],
      ["blu", "new"],
    ]);
    expect(
      matchOnlyWatch(
        ow({ brand_id: "swatch", brand_name: "Swatch" }),
        registry,
        aliases,
        res,
      ),
    ).toMatchObject({ method: "resolution" });
    expect(
      matchOnlyWatch(
        ow({ brand_id: "blu", brand_name: "BLU" }),
        registry,
        aliases,
        res,
      ),
    ).toBeNull();
  });

  it("ignores a gphg_slug that is not in the registry", () => {
    expect(
      matchOnlyWatch(
        ow({ brand_name: "Nobody", gphg_slug: "ghost" }),
        registry,
        aliases,
        new Map(),
      ),
    ).toBeNull();
  });

  it("scores similarity", () => {
    expect(dice("swatch", "swatch")).toBe(1);
    expect(dice("swatch", "rolex")).toBe(0);
  });
});

describe("seed SQL", () => {
  it("upserts brands without renumbering them, escaping quotes", () => {
    const t = createTestD1();
    const first = brandsSql([
      {
        slug: "l-epee-1839",
        name: "L'Epée 1839",
        hq_country: "CH",
        website: null,
      },
    ]).join("\n");
    t.raw.exec(first);
    t.raw.exec(
      brandsSql([
        {
          slug: "l-epee-1839",
          name: "L'Epée",
          hq_country: "FR",
          website: "https://example.com",
        },
      ]).join("\n"),
    );
    expect(
      t.raw.prepare("SELECT id, name, hq_country, website FROM brands").all(),
    ).toEqual([
      {
        id: 1,
        name: "L'Epée",
        hq_country: "CH",
        website: "https://example.com",
      },
    ]);
  });

  it("writes aliases by slug and skips unknown slugs", () => {
    const t = createTestD1();
    t.raw.exec(
      brandsSql([
        { slug: "omega", name: "Omega", hq_country: null, website: null },
      ]).join("\n"),
    );
    t.raw.exec(
      aliasesSql("gphg", [
        ["omega", "omega"],
        ["OMEGA SA", "omega"],
        ["ghost", "nope"],
      ]).join("\n"),
    );
    expect(
      t.raw
        .prepare("SELECT alias FROM brand_aliases ORDER BY alias")
        .all()
        .map((r) => r.alias),
    ).toEqual(["OMEGA SA", "omega"]);
  });

  it("the committed seed applies cleanly and matches every live GPHG slug", () => {
    const t = createTestD1();
    t.raw.exec(
      readFileSync(
        new URL("../seed/registry_seed.sql", import.meta.url),
        "utf8",
      ),
    );
    const gphg: [string, string][] = JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/shared/tests/fixtures/gphg-brands.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const slugs = new Set(
      t.raw
        .prepare("SELECT slug FROM brands")
        .all()
        .map((r) => r.slug),
    );
    for (const [id] of gphg)
      expect(slugs.has(id.replace(/\s+/g, "-"))).toBe(true);
    const gphgAlias = t.raw
      .prepare(
        `SELECT b.slug FROM brand_aliases a JOIN brands b ON b.id = a.brand_id WHERE a.source = 'gphg' AND a.alias = 'audemars piguet'`,
      )
      .get();
    expect(gphgAlias).toEqual({ slug: "audemars-piguet" });
  });
});

describe("csv helpers", () => {
  it("round-trips quotes, commas and new lines", () => {
    const text = writeCsv(
      ["a", "b"],
      [
        ['x, "y"', "line\nbreak"],
        [null, 3],
      ],
    );
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ['x, "y"', "line\nbreak"],
      ["", "3"],
    ]);
    expect(readCsvObjects(text)[1]).toEqual({ a: "", b: "3" });
  });
});
