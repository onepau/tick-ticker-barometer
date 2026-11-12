import { beforeEach, describe, expect, it } from "vitest";
import { createRegistryApp } from "../src/app.ts";
import { createTestD1, type TestD1 } from "./d1.ts";

function seed(t: TestD1): void {
  t.raw.exec(`
    INSERT INTO groups (slug, name, wikidata_id, website) VALUES
      ('swatch-group', 'The Swatch Group', 'Q694323', 'https://www.swatchgroup.com'),
      ('richemont', 'Richemont', NULL, NULL);
    INSERT INTO brands (slug, name, group_id, founded_year, dissolved_year, status, hq_city, hq_country, website, wikidata_id) VALUES
      ('omega', 'Omega', 1, 1848, NULL, 'active', 'Biel/Bienne', 'CH', 'https://www.omegawatches.com', 'Q785143'),
      ('angelus', 'Angelus', NULL, 1891, 1960, 'revived', NULL, NULL, NULL, NULL),
      ('ebel', 'Ebel', NULL, 1911, NULL, 'dormant', NULL, NULL, NULL, NULL),
      ('zodiac-x', 'Zodiac <X> & Co', NULL, 1882, 1990, 'dead', NULL, NULL, NULL, NULL);
    INSERT INTO brands (slug, name) VALUES ('h-moser', 'H. Moser & Cie.'), ('ulysse-nardin', 'Ulysse Nardin');
    INSERT INTO brands (slug, name, group_id, status) VALUES ('breguet', 'Breguet', 1, 'active');
    INSERT INTO brand_people (brand_id, name, role, from_year) VALUES
      (1, 'Louis Brandt', 'founder', 1848),
      (1, 'Raynald Aeschlimann', 'CEO', 2016);
    INSERT INTO brand_aliases (alias, source, brand_id) VALUES
      ('omega', 'gphg', 1), ('omega-sa', 'onlywatch', 1), ('angelus', 'gphg', 2);
  `);
}

const ORIGIN = "https://prices.tick-ticker.com";

describe("registry pages", () => {
  let t: TestD1;
  const get = (path: string) =>
    createRegistryApp().request(path, {}, { DB: t.db });
  const ld = (html: string): any[] =>
    [
      ...html.matchAll(
        /<script type="application\/ld\+json">(.*?)<\/script>/gs,
      ),
    ].map((m) => JSON.parse(m[1]!));

  beforeEach(() => {
    t = createTestD1();
    seed(t);
  });

  describe("/brand/<slug>", () => {
    it("renders a full brand: facts, links and JSON-LD", async () => {
      const res = await get("/brand/omega");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const html = await res.text();
      expect(html).toContain('<h1 class="display">Omega</h1>');
      expect(html).toContain('href="/group/swatch-group"');
      expect(html).toContain("The Swatch Group");
      expect(html).toContain("1848");
      expect(html).toContain("Biel/Bienne, Switzerland");
      expect(html).toContain("Louis Brandt");
      expect(html).toContain("omegawatches.com");
      expect(html).toContain("https://gphg.tick-ticker.com/brand/omega");
      expect(html).toContain(
        "https://onlywatch.tick-ticker.com/brand/omega-sa",
      );
      expect(html).toContain(
        `<link rel="canonical" href="${ORIGIN}/brand/omega">`,
      );
      expect(html).not.toContain("hreflang");

      const [crumb, org] = ld(html);
      expect(crumb["@type"]).toBe("BreadcrumbList");
      expect(org["@type"]).toBe("Organization");
      expect(org.foundingDate).toBe("1848");
      expect(org.dissolutionDate).toBeUndefined();
      expect(org.parentOrganization.name).toBe("The Swatch Group");
      expect(org.founder).toEqual([
        { "@type": "Person", name: "Louis Brandt" },
      ]);
      expect(org.sameAs).toEqual([
        "https://www.wikidata.org/wiki/Q785143",
        "https://www.omegawatches.com",
      ]);
    });

    it("includes dissolutionDate for a dissolved brand", async () => {
      const html = await (await get("/brand/angelus")).text();
      const org = ld(html)[1];
      expect(org.foundingDate).toBe("1891");
      expect(org.dissolutionDate).toBe("1960");
      expect(html).toContain("Dissolved");
      expect(html).toContain("Revived");
    });

    it("renders a name-only brand with no blank facts", async () => {
      const res = await get("/brand/h-moser");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("H. Moser &amp; Cie.");
      expect(html).toContain("holds only the name");
      expect(html).not.toContain('class="facts"');
      expect(html).not.toContain("GPHG Index</span>");
      for (const label of [
        "Founded",
        "Status",
        "Headquarters",
        "Group",
        "Key people",
      ]) {
        expect(html).not.toContain(`<dt>${label}</dt>`);
      }
      const org = ld(html)[1];
      expect(org["@type"]).toBe("Organization");
      expect(Object.keys(org).sort()).toEqual([
        "@context",
        "@type",
        "name",
        "url",
      ]);
    });

    it("shows no status when it is NULL, and no price section", async () => {
      const html = await (await get("/brand/ulysse-nardin")).text();
      expect(html).not.toContain('class="chip');
      expect(html).not.toMatch(/price/i);
    });

    it("escapes names in HTML and JSON-LD", async () => {
      const html = await (await get("/brand/zodiac-x")).text();
      expect(html).toContain("Zodiac &lt;X&gt; &amp; Co");
      expect(html).not.toContain("<X>");
      expect(ld(html)[1].name).toBe("Zodiac <X> & Co");
    });

    it("returns an HTML 404 for an unknown slug", async () => {
      const res = await get("/brand/nope");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toContain("Page not found");
    });

    it("redirects an upper-case slug to the lower-case URL", async () => {
      const res = await get("/brand/Omega");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/brand/omega");
    });
  });

  describe("/group/<slug>", () => {
    it("lists a group's brands", async () => {
      const res = await get("/group/swatch-group");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The Swatch Group");
      expect(html).toContain('href="/brand/omega"');
      expect(html).toContain('href="/brand/breguet"');
      expect(html).not.toContain('href="/brand/ebel"');
      const org = ld(html)[1];
      expect(org["@type"]).toBe("Organization");
      expect(org.subOrganization).toHaveLength(2);
      expect(org.sameAs).toContain("https://www.wikidata.org/wiki/Q694323");
    });

    it("handles a group with no brands", async () => {
      const html = await (await get("/group/richemont")).text();
      expect(html).toContain("No brands are linked");
    });

    it("lists brands with no group under /group/independent", async () => {
      const res = await get("/group/independent");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/brand/h-moser"');
      expect(html).toContain('href="/brand/ebel"');
      expect(html).not.toContain('href="/brand/omega"');
    });

    it("404s for an unknown group", async () => {
      expect((await get("/group/nope")).status).toBe(404);
    });
  });

  describe("/brands", () => {
    it("lists every brand A–Z with letter anchors and group links", async () => {
      const html = await (await get("/brands")).text();
      expect(html).toContain("7 brands");
      expect(html.indexOf('href="/brand/angelus"')).toBeLessThan(
        html.indexOf('href="/brand/omega"'),
      );
      expect(html).toContain('id="letter-A"');
      expect(html).toContain('href="/group/richemont"');
      expect(html).not.toContain("noindex");
    });

    it("filters by status", async () => {
      const html = await (await get("/brands?status=dormant")).text();
      expect(html).toContain('href="/brand/ebel"');
      expect(html).not.toContain('href="/brand/omega"');
      expect(html).toContain("1 brand match");
      expect(html).toContain('content="noindex,follow"');
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/brands">`);
    });

    it("filters by group, independent and unknown status", async () => {
      let html = await (await get("/brands?group=swatch-group")).text();
      expect(html).toContain('href="/brand/breguet"');
      expect(html).not.toContain('href="/brand/ebel"');

      html = await (
        await get("/brands?group=independent&status=unknown")
      ).text();
      expect(html).toContain('href="/brand/h-moser"');
      expect(html).not.toContain('href="/brand/ebel"');
      expect(html).not.toContain('href="/brand/omega"');
    });

    it("ignores invalid filter values and reports empty results", async () => {
      const all = await (await get("/brands?status=bogus&group=nope")).text();
      expect(all).toContain("7 brands");
      const none = await (await get("/brands?group=richemont")).text();
      expect(none).toContain("No brands match these filters");
    });
  });

  describe("/brands/dormant-and-dead", () => {
    it("lists only dormant, dead and revived brands", async () => {
      const res = await get("/brands/dormant-and-dead");
      expect(res.status).toBe(200);
      const html = await res.text();
      for (const slug of ["ebel", "angelus", "zodiac-x"])
        expect(html).toContain(`href="/brand/${slug}"`);
      for (const slug of ["omega", "breguet", "h-moser", "ulysse-nardin"])
        expect(html).not.toContain(`href="/brand/${slug}"`);
      expect(html).toContain(
        "https://blog.tick-ticker.com/posts/gphg-dead-brands",
      );
      expect(ld(html).map((o) => o["@type"])).toEqual([
        "BreadcrumbList",
        "ItemList",
      ]);
    });

    it("renders an empty hub when no status is set", async () => {
      t.raw.exec("UPDATE brands SET status = NULL");
      const html = await (await get("/brands/dormant-and-dead")).text();
      expect(html).toContain("No brands are marked");
      expect(html).toContain("gphg-dead-brands");
    });
  });

  describe("sitemap, robots and misc routes", () => {
    it("lists every brand and group URL", async () => {
      const res = await get("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/xml/);
      const xml = await res.text();
      for (const slug of [
        "omega",
        "angelus",
        "ebel",
        "zodiac-x",
        "h-moser",
        "ulysse-nardin",
        "breguet",
      ])
        expect(xml).toContain(`<loc>${ORIGIN}/brand/${slug}</loc>`);
      for (const loc of [
        "/group/swatch-group",
        "/group/richemont",
        "/group/independent",
        "/brands",
        "/brands/dormant-and-dead",
      ])
        expect(xml).toContain(`<loc>${ORIGIN}${loc}</loc>`);
      expect(xml.match(/<url>/g)).toHaveLength(7 + 2 + 3);
      expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    });

    it("points robots.txt at the sitemap", async () => {
      expect(await (await get("/robots.txt")).text()).toContain(
        `Sitemap: ${ORIGIN}/sitemap.xml`,
      );
    });

    it("uses PUBLIC_ORIGIN when set", async () => {
      const res = await createRegistryApp().request(
        "/sitemap.xml",
        {},
        { DB: t.db, PUBLIC_ORIGIN: "https://example.test" },
      );
      expect(await res.text()).toContain(
        "<loc>https://example.test/brands</loc>",
      );
    });

    it("redirects / to /brands and 404s other paths as HTML, API paths as JSON", async () => {
      expect((await get("/")).headers.get("location")).toBe("/brands");
      const miss = await get("/nowhere");
      expect(miss.status).toBe(404);
      expect(miss.headers.get("content-type")).toMatch(/text\/html/);
      const api = await get("/api/registry/v1/nope");
      expect(api.status).toBe(404);
      expect(await api.json()).toEqual({ error: "not_found" });
    });
  });
});
