/**
 * Routes of the public brand registry Worker (working hostname registry.tick-ticker.com).
 *
 * Serves the registry feed that the GPHG, Only Watch and blog sites link from:
 *   GET /api/registry/v1/brands.json
 *   GET /api/registry/v1/groups.json
 * Slugs and canonical URLs are precomputed in the feed so consumers never run their
 * own copy of slugifyBrand.
 *
 * The Worker entry point (index.ts) wraps this app in a plain `{ fetch }` export,
 * which also serves service bindings.
 */
import { Hono, type Context } from "hono";
import {
  feed,
  listBrandFeedRows,
  listGroupFeedRows,
  toBrandFeedItem,
  toGroupFeedItem,
} from "@baromontres/shared/registry";

export interface RegistryEnv {
  DB: D1Database;
}

type Env = { Bindings: RegistryEnv };

/** Browsers and the edge keep a feed for an hour; consumers should cache it too. */
export const FEED_CACHE_CONTROL = "public, max-age=3600";

const FEED_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": FEED_CACHE_CONTROL,
  // Open data: any site may fetch it from the browser.
  "Access-Control-Allow-Origin": "*",
};

/** The Workers Cache API, when the runtime has one (absent in Node tests and on workers.dev). */
function edgeCache(): Cache | null {
  return typeof caches !== "undefined" && "default" in caches
    ? (caches as unknown as { default: Cache }).default
    : null;
}

function waitUntil(c: Context<Env>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (unit tests): let the promise run on its own.
    promise.catch(() => {});
  }
}

/**
 * Serve a JSON feed through the Cache API: a hit skips D1 entirely; a miss builds the
 * body, returns it and stores a copy for the next request.
 */
async function cachedJson(
  c: Context<Env>,
  build: () => Promise<unknown>,
): Promise<Response> {
  const cache = edgeCache();
  // Key on the path only so query strings can't fragment or bypass the cache.
  const key = new Request(new URL(c.req.path, c.req.url).toString(), {
    method: "GET",
  });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = new Response(JSON.stringify(await build()), {
    status: 200,
    headers: FEED_HEADERS,
  });
  if (cache) waitUntil(c, cache.put(key, res.clone()));
  return res;
}

export function createRegistryApp(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/api/registry/v1/brands.json", (c) =>
    cachedJson(c, async () =>
      feed((await listBrandFeedRows(c.env.DB)).map(toBrandFeedItem)),
    ),
  );

  app.get("/api/registry/v1/groups.json", (c) =>
    cachedJson(c, async () =>
      feed((await listGroupFeedRows(c.env.DB)).map(toGroupFeedItem)),
    ),
  );

  app.get("/api/registry/v1", (c) =>
    c.json(
      {
        version: 1,
        endpoints: [
          "/api/registry/v1/brands.json",
          "/api/registry/v1/groups.json",
        ],
      },
      200,
      {
        "Cache-Control": FEED_CACHE_CONTROL,
        "Access-Control-Allow-Origin": "*",
      },
    ),
  );

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    console.error("registry error", err);
    return c.json({ error: "internal_error" }, 500, {
      "Cache-Control": "no-store",
    });
  });

  return app;
}
