import { describe, expect, it } from "vitest";
import {
  buildRows,
  CSV_HEADER,
  matchItems,
  parseBinding,
  suggestStatus,
  yearOf,
  type RegistryBrand,
  type WdItem,
} from "../scripts/wikidata-seed.ts";

const item = (over: Partial<WdItem> = {}): WdItem => ({
  id: "Q1",
  en: "X",
  fr: "",
  alts: [],
  foundedYear: null,
  dissolvedYear: null,
  parent: "",
  founders: [],
  hqCity: "",
  website: "",
  country: "",
  ...over,
});

const registry: RegistryBrand[] = [
  { slug: "omega", name: "Omega", aliases: [] },
  {
    slug: "iwc-schaffhausen",
    name: "IWC Schaffhausen",
    aliases: ["International Watch Co."],
  },
  { slug: "beauregard", name: "Beauregard", aliases: [] },
];

describe("parseBinding", () => {
  it("reads years, folded lists and the first parent label", () => {
    const i = parseBinding({
      item: { value: "http://www.wikidata.org/entity/Q42" },
      en: { value: "Cortébert" },
      fr: { value: "Cortébert SA" },
      inception: { value: "1790-01-01T00:00:00Z|1800-01-01T00:00:00Z" },
      dissolved: { value: "1982-01-01T00:00:00Z" },
      parents: { value: "http://www.wikidata.org/entity/Q9~Swatch Group" },
      founders: { value: "B|A" },
      countries: { value: "CH" },
    });
    expect(i).toMatchObject({
      id: "Q42",
      foundedYear: 1790,
      dissolvedYear: 1982,
      parent: "Swatch Group",
      founders: ["A", "B"],
      country: "CH",
    });
  });
  it("drops an unlabelled Q-id name and out-of-range years", () => {
    expect(yearOf("-0300-01-01T00:00:00Z")).toBeNull();
    expect(yearOf("1200-01-01T00:00:00Z")).toBeNull();
    const i = parseBinding({ item: { value: "x/Q7" }, en: { value: "Q7" } });
    expect(i.en).toBe("");
  });
});

describe("matchItems", () => {
  it("matches on slug, ignoring noise words such as SA", () => {
    const [m] = matchItems([item({ en: "Omega SA" })], registry);
    expect(m).toMatchObject({ confidence: "exact", slug: "omega" });
  });
  it("matches an alias spelling with lower confidence", () => {
    const [m] = matchItems([item({ en: "International Watch Co." })], registry);
    expect(m).toMatchObject({ confidence: "alias", slug: "iwc-schaffhausen" });
  });
  it("flags two items claiming one registry brand as ambiguous", () => {
    const ms = matchItems(
      [
        item({ id: "Q1", en: "Beauregard" }),
        item({ id: "Q2", en: "Beauregard" }),
      ],
      registry,
    );
    expect(ms.map((m) => m.confidence)).toEqual(["ambiguous", "ambiguous"]);
    expect(ms[0]!.candidates).toEqual(["beauregard"]);
  });
  it("reports unknown names as new", () => {
    expect(matchItems([item({ en: "Farer" })], registry)[0]!.confidence).toBe(
      "new",
    );
  });
});

describe("row shaping", () => {
  it("suggests dead only when dissolved", () => {
    expect(suggestStatus(item({ dissolvedYear: 1982 }))).toBe("dead");
    expect(suggestStatus(item())).toBe("active");
  });
  it("enriches registry rows, adds new ones with unique slugs, leaves review columns blank", () => {
    const items = [
      item({
        id: "Q1",
        en: "Omega SA",
        fr: "Omega",
        foundedYear: 1848,
        country: "CH",
      }),
      item({ id: "Q2", en: "Farer" }),
      item({ id: "Q3", en: "Farer" }),
    ];
    const { rows, counts } = buildRows(registry, matchItems(items, registry));
    expect(counts).toMatchObject({ exact: 1, new: 2, none: 2, ambiguous: 0 });
    expect(rows.every((r) => r.length === CSV_HEADER.length)).toBe(true);
    const col = (n: string) => CSV_HEADER.indexOf(n);
    const omega = rows.find((r) => r[0] === "omega")!;
    expect(omega[col("wikidata_id")]).toBe("Q1");
    expect(omega[col("founded_year")]).toBe(1848);
    expect(omega[col("name_fr")]).toBe(""); // same as the English name
  });
  it("leaves name_fr blank when it equals the registry name", () => {
    const items = [item({ en: "Omega SA", fr: "Omega" })];
    const { rows } = buildRows(registry, matchItems(items, registry));
    expect(
      rows.find((r) => r[0] === "omega")![CSV_HEADER.indexOf("name_fr")],
    ).toBe("");
  });
  it("gives duplicate new brands distinct slugs", () => {
    const { rows } = buildRows(
      registry,
      matchItems(
        [item({ id: "Q2", en: "Farer" }), item({ id: "Q3", en: "Farer" })],
        registry,
      ),
    );
    const slugs = rows.map((r) => r[0]);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("farer-2");
    const farer = rows.find((r) => r[0] === "farer")!;
    expect(farer.slice(-2)).toEqual(["", ""]);
  });
  it("does not guess a status for registry brands with no Wikidata item", () => {
    const { rows } = buildRows(registry, []);
    expect(
      rows.every((r) => r[CSV_HEADER.indexOf("status_suggested")] === ""),
    ).toBe(true);
  });
});
