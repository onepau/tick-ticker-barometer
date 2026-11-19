import { beforeEach, describe, expect, it } from "vitest";
import { createRegistryApp } from "../src/app.ts";
import { DEFAULT_SALT, makeToken } from "../src/contact.ts";
import { createTestD1, type TestD1 } from "./d1.ts";
import { seedPrices } from "./price-seed.ts";

const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} }) as unknown as ExecutionContext;
const app = createRegistryApp();

let t: TestD1;
beforeEach(() => {
  t = createTestD1();
});

const get = (path: string, env: Record<string, string | undefined> = {}) =>
  app.request(path, {}, { DB: t.db, ...env }, ctx());

/** A form post with a token rendered `agoMs` ago. */
async function post(fields: Record<string, string>, o: { agoMs?: number; ip?: string; token?: string } = {}) {
  const token = o.token ?? (await makeToken(DEFAULT_SALT, Date.now() - (o.agoMs ?? 30_000)));
  const body = new URLSearchParams({ message: "The price is wrong.", website: "", t: token, ...fields });
  return app.request(
    "/contact",
    { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": o.ip ?? "203.0.113.7" } },
    { DB: t.db },
    ctx(),
  );
}
const rows = () => t.raw.prepare(`SELECT * FROM contact_messages ORDER BY id`).all() as Record<string, any>[];

describe("GET /contact", () => {
  it("renders the form, noindex, uncached, without the price flag", async () => {
    const res = await get("/contact");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('<form class="contact" method="post" action="/contact">');
    for (const f of ['name="name"', 'name="email"', 'name="page"', 'name="message"', 'name="website"', 'name="t"']) expect(html).toContain(f);
    expect(html).toContain("we can only reply if you give one");
    expect(html).toContain("deleted once it has been dealt with");
    expect(html).toContain('content="noindex,follow"');
    expect(html).toContain('href="/contact">Contact</a>'); // footer link
  });

  it("prefills the page from ?page= and ignores anything that is not a local path", async () => {
    expect(await (await get("/contact?page=/prices/omega/x")).text()).toContain('value="/prices/omega/x"');
    for (const bad of ["https://evil.example/", "//evil.example", "javascript:alert(1)", '/"><script>']) {
      const html = await (await get(`/contact?page=${encodeURIComponent(bad)}`)).text();
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("<script>alert");
      expect(html).toContain('name="page" maxlength="200" placeholder="/prices/omega/…" value=""');
    }
  });

  it("is not in the sitemap and does not use a price-Worker path", async () => {
    expect(await (await get("/sitemap.xml", { PRICES_PUBLIC: "1" })).text()).not.toContain("/contact");
  });
});

describe("POST /contact", () => {
  it("stores a valid message, hashes the IP and redirects to the thank-you page", async () => {
    const res = await post({ name: "Ann", email: "ann@example.com", page: "/prices/omega/x", message: "Check CH." }, { ip: "198.51.100.9" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact/thanks");
    const [r] = rows();
    expect(r).toMatchObject({ name: "Ann", email: "ann@example.com", page: "/prices/omega/x", message: "Check CH.", status: "new" });
    expect(r!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain("198.51.100.9");
    expect((await (await get("/contact/thanks")).text())).toContain("Thank you");
  });

  it("name, email and page are optional", async () => {
    expect((await post({})).status).toBe(303);
    expect(rows()[0]).toMatchObject({ name: null, email: null, page: null });
  });

  it("a filled honeypot looks like success and stores nothing", async () => {
    const res = await post({ website: "http://spam.example" });
    expect(res.status).toBe(303);
    expect(rows()).toHaveLength(0);
  });

  it("too fast, forged or missing tokens look like success and store nothing", async () => {
    expect((await post({}, { agoMs: 500 })).status).toBe(303);
    expect((await post({}, { token: `${Date.now() - 60_000}.${"0".repeat(32)}` })).status).toBe(303);
    expect((await post({}, { token: "" })).status).toBe(303);
    expect(rows()).toHaveLength(0);
  });

  it("an expired form is re-shown with the message kept", async () => {
    const res = await post({ message: "Keep me" }, { agoMs: 25 * 3_600_000 });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("timed out");
    expect(html).toContain("Keep me");
    expect(rows()).toHaveLength(0);
  });

  it("rejects a missing or oversized message and keeps the input, escaped", async () => {
    let res = await post({ message: "   ", name: "<b>Ann</b>" });
    expect(res.status).toBe(400);
    let html = await res.text();
    expect(html).toContain("Please write a message.");
    expect(html).toContain("&lt;b&gt;Ann&lt;/b&gt;");
    expect(html).not.toContain("<b>Ann</b>");
    res = await post({ message: "x".repeat(5001), email: "not-an-email" });
    html = await res.text();
    expect(html).toContain("under 5000 characters");
    expect(html).toContain("does not look right");
    expect(rows()).toHaveLength(0);
  });

  it("escapes a message containing markup when the form is re-shown", async () => {
    const html = await (await post({ message: '</textarea><script>alert(1)</script>', email: "bad" })).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;");
  });

  it("allows five messages an hour per sender, then answers 429; another sender is unaffected", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ message: `m${i}` }, { ip: "203.0.113.50" })).status).toBe(303);
    const sixth = await post({ message: "m6" }, { ip: "203.0.113.50" });
    expect(sixth.status).toBe(429);
    expect(rows()).toHaveLength(5);
    expect((await post({ message: "other" }, { ip: "203.0.113.51" })).status).toBe(303);
    // Messages older than an hour no longer count.
    t.raw.exec(`UPDATE contact_messages SET created_at = datetime('now', '-2 hours')`);
    expect((await post({ message: "later" }, { ip: "203.0.113.50" })).status).toBe(303);
  });

  it("without the table (migration 0011 not applied) it answers politely, not with a 500", async () => {
    t.raw.exec(`DROP TABLE contact_messages`);
    const res = await post({});
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Contact form unavailable");
  });

  it("a huge body is refused", async () => {
    const res = await app.request(
      "/contact",
      { method: "POST", body: "message=" + "x".repeat(40_000), headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "40008" } },
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(413);
  });
});

describe("links to the form", () => {
  it("methodology and reference pages link to it", async () => {
    seedPrices(t);
    const env = { PRICES_PUBLIC: "1" };
    expect(await (await get("/prices/methodology", env)).text()).toContain('href="/contact?page=/prices/methodology"');
    expect(await (await get("/prices/omega/310-30-42-50-01-001", env)).text()).toContain('href="/contact?page=/prices/omega/310-30-42-50-01-001">Report a correction');
  });
  it("the CSV is gone and nothing links to it", async () => {
    seedPrices(t);
    const env = { PRICES_PUBLIC: "1" };
    expect((await get("/prices/dataset.csv", env)).status).toBe(404);
    for (const p of ["/prices", "/prices/methodology", "/llms.txt"]) expect(await (await get(p, env)).text()).not.toMatch(/dataset\.csv|\bCSV\b/);
  });
});
