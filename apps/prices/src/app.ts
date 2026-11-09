import { Hono } from "hono";
import { listUnconfirmedRetailerPrices, type MarketCode } from "@baromontres/shared";
import { bookmarkletHref, capturePage } from "./bookmarklet.ts";
import { handleCapture, type CapturePayload } from "./capture.ts";
import { numVar, type PricesEnv } from "./env.ts";
import { runCapture } from "./run.ts";

/** Constant-time comparison of a bearer token with the configured secret. */
export function tokenOk(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false; // unset or too weak: refuse everything
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

export function createApp() {
  const app = new Hono<{ Bindings: PricesEnv }>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
  });

  app.get("/health", (c) => c.json({ ok: true, worker: "tick-ticker-prices" }));

  // Manual trigger for an ad hoc run. Filters keep it small; the default is 10 pages.
  // POST /api/run?brands=cartier,breitling&markets=CH,US&limit=10
  app.post("/api/run", async (c) => {
    if (!tokenOk(c.req.header("authorization"), c.env.RUN_TOKEN)) return c.json({ error: "unauthorised" }, 401);
    const q = c.req.query();
    const markets = list(q.markets)?.map((m) => m.toUpperCase()) as MarketCode[] | undefined;
    const report = await runCapture(c.env.DB, c.env.EVIDENCE, {
      trigger: "manual",
      filter: {
        brandSlugs: list(q.brands),
        markets,
        referenceIds: list(q.refs)?.map(Number).filter(Number.isInteger),
        limit: Math.min(Number(q.limit) || 10, 200),
      },
      fetcher: {
        minDelayMs: numVar(c.env.MIN_DELAY_MS, 3000),
        maxRequests: numVar(c.env.MAX_REQUESTS_PER_INVOCATION, 40),
      },
    });
    return c.json({
      ...report,
      results: report.results.map(({ target, result }) => ({
        reference: target.reference_slug,
        market: target.market_code,
        source: target.source,
        url: target.url,
        status: result.status,
        amount_minor: result.amountMinor,
        currency: result.currency,
        price_text: result.priceText,
        tax_label: result.taxLabel,
        message: result.message ?? null,
      })),
    });
  });

  // Last runs and the retailer prices that do not count yet.
  app.get("/api/report", async (c) => {
    if (!tokenOk(c.req.header("authorization"), c.env.RUN_TOKEN)) return c.json({ error: "unauthorised" }, 401);
    const { results: runs } = await c.env.DB.prepare(
      `SELECT id, started_at, finished_at, "trigger" AS "trigger", counts FROM capture_runs ORDER BY id DESC LIMIT 10`,
    ).all();
    return c.json({ runs, unconfirmed_retailer_prices: await listUnconfirmedRetailerPrices(c.env.DB) });
  });

  const origin = (c: { env: PricesEnv; req: { url: string } }) => c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;

  app.get("/capture", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(capturePage(origin(c)));
  });

  app.get("/bookmarklet.txt", (c) => c.text(bookmarkletHref(origin(c))));

  app.post("/api/capture", async (c) => {
    if (!tokenOk(c.req.header("authorization"), c.env.CAPTURE_TOKEN)) return c.json({ ok: false, error: "unauthorised" }, 401);
    let body: Partial<CapturePayload>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "body must be JSON" }, 400);
    }
    const r = await handleCapture(c.env.DB, c.env.EVIDENCE, body);
    return r.ok ? c.json(r, 201) : c.json(r, r.status as 400);
  });

  return app;
}
