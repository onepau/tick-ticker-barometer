import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistryApp, FEED_CACHE_CONTROL } from "../src/app.ts";
import worker from "../src/index.ts";
import { createTestD1, type TestD1 } from "./d1.ts";

// workers-types types Response.json() as unknown; the tests assert on the shape.
const json = (r: Response): Promise<any> => r.json() as Promise<any>;

function seed(t: TestD1): void {
  t.raw.exec(`
    INSERT INTO groups (slug, name, wikidata_id, website) VALUES
      ('swatch-group', 'The Swatch Group', 'Q694323', 'https://www.swatchgroup.com'),
      ('richemont', 'Richemont', NULL, NULL);
    INSERT INTO brands (slug, name, group_id, status) VALUES
      ('omega', 'Omega', 1, 'active'),
      ('audemars-piguet', 'Audemars Piguet', NULL, 'active'),
      ('h-moser', 'H. Moser & Cie.', NULL, NULL),
      ('breguet', 'Breguet', 1, 'active');
  `);
}

const ctx = () =>
  ({
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  }) as unknown as ExecutionContext;

describe("registry feed routes", () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
    seed(t);
  });

  it("serves brands.json with precomputed slugs and canonical URLs", async () => {
    const res = await createRegistryApp().request(
      "/api/registry/v1/brands.json",
      {},
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toBe(FEED_CACHE_CONTROL);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.version).toBe(1);
    expect(body.count).toBe(4);
    expect(Date.parse(body.generated_at)).not.toBeNaN();
    // Ordered by slug.
    expect(body.items.map((b: { slug: string }) => b.slug)).toEqual([
      "audemars-piguet",
      "breguet",
      "h-moser",
      "omega",
    ]);
    expect(body.items[3]).toEqual({
      id: 1,
      slug: "omega",
      name: "Omega",
      group: { id: 1, slug: "swatch-group", name: "The Swatch Group" },
      status: "active",
      url: "https://prices.tick-ticker.com/brand/omega",
      price_url: null,
    });
    expect(body.items[2]).toMatchObject({
      slug: "h-moser",
      group: null,
      status: null,
    });
  });

  it("serves groups.json with brand counts", async () => {
    const res = await createRegistryApp().request(
      "/api/registry/v1/groups.json",
      {},
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(FEED_CACHE_CONTROL);
    const body = await json(res);
    expect(body.count).toBe(2);
    expect(body.items).toEqual([
      {
        id: 2,
        slug: "richemont",
        name: "Richemont",
        wikidata_id: null,
        website: null,
        url: "https://prices.tick-ticker.com/group/richemont",
        brand_count: 0,
      },
      {
        id: 1,
        slug: "swatch-group",
        name: "The Swatch Group",
        wikidata_id: "Q694323",
        website: "https://www.swatchgroup.com",
        url: "https://prices.tick-ticker.com/group/swatch-group",
        brand_count: 2,
      },
    ]);
  });

  it("returns empty feeds on an empty registry", async () => {
    const empty = createTestD1();
    const res = await createRegistryApp().request(
      "/api/registry/v1/brands.json",
      {},
      { DB: empty.db },
      ctx(),
    );
    expect(await json(res)).toMatchObject({ count: 0, items: [] });
  });

  it("lists the endpoints at the version root", async () => {
    const res = await createRegistryApp().request(
      "/api/registry/v1",
      {},
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).endpoints).toContain(
      "/api/registry/v1/brands.json",
    );
  });

  it("answers unknown paths with a JSON 404", async () => {
    const res = await createRegistryApp().request(
      "/api/registry/v2/brands.json",
      {},
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not_found" });
  });

  it("answers a database failure with an uncached 500", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createRegistryApp().request(
      "/api/registry/v1/brands.json",
      {},
      { DB: broken },
      ctx(),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    spy.mockRestore();
  });

  it("works through the default fetch export, whatever the host (service binding)", async () => {
    const res = await worker.fetch(
      new Request("https://registry/api/registry/v1/brands.json"),
      { DB: t.db },
      ctx(),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).count).toBe(4);
  });
});

describe("Cache API", () => {
  let t: TestD1;
  let store: Map<string, Response>;

  beforeEach(() => {
    t = createTestD1();
    seed(t);
    store = new Map();
    const cache = {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
    };
    vi.stubGlobal("caches", { default: cache });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stores a miss and serves the next request without touching D1", async () => {
    const waits: Promise<unknown>[] = [];
    const c = {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const app = createRegistryApp();

    const first = await app.request(
      "/api/registry/v1/brands.json?x=1",
      {},
      { DB: t.db },
      c,
    );
    await Promise.all(waits);
    expect(first.status).toBe(200);
    expect(store.has("http://localhost/api/registry/v1/brands.json")).toBe(
      true,
    );

    const before = t.prepared();
    const second = await app.request(
      "/api/registry/v1/brands.json?x=2",
      {},
      { DB: t.db },
      c,
    );
    expect(t.prepared()).toBe(before);
    expect(second.headers.get("cache-control")).toBe(FEED_CACHE_CONTROL);
    expect((await json(second)).count).toBe(4);
  });
});
