import { createApp } from "./app.ts";
import { numVar, type PricesEnv } from "./env.ts";
import { runCapture } from "./run.ts";
import { runFxFetch } from "./fx.ts";

const app = createApp();

// Must match the cron expression in wrangler.toml (every 5 minutes).
const CRON_INTERVAL_MS = 5 * 60_000;

export default {
  fetch: app.fetch,
  async scheduled(
    event: ScheduledController,
    env: PricesEnv,
    ctx: ExecutionContext,
  ) {
    const budget = numVar(env.INVOCATION_BUDGET_MS, 600_000);
    const maxHosts = env.MAX_HOSTS_PER_INVOCATION
      ? numVar(env.MAX_HOSTS_PER_INVOCATION, 1)
      : undefined;
    // ECB reference rates, once a day after 16:30 CET (see fx.ts). Separate from the
    // capture so a failure on either side cannot affect the other.
    ctx.waitUntil(
      runFxFetch(env.DB, env.EVIDENCE, { now: () => new Date(event.scheduledTime) })
        .then((o) => o.status !== "skipped" && console.log(JSON.stringify({ fx: o })))
        .catch((e) => console.error("fx fetch failed", e)),
    );
    ctx.waitUntil(
      runCapture(env.DB, env.EVIDENCE, {
        trigger: "cron",
        maxHosts,
        // One step per firing, so each firing starts at the next domain.
        hostOffset: Math.floor(event.scheduledTime / CRON_INTERVAL_MS),
        fetcher: {
          minDelayMs: numVar(env.MIN_DELAY_MS, 3000),
          maxRequests: numVar(env.MAX_REQUESTS_PER_INVOCATION, 40),
          deadline: Date.now() + budget,
        },
      }).then((r) =>
        console.log(
          JSON.stringify({
            run: r.runId,
            resumed: r.resumed,
            finished: r.finished,
            attempted: r.attempted,
            remaining: r.remaining,
            requests: r.requests,
            counts: r.counts,
            problems: r.problems.length,
            unconfirmed_retailer: r.unconfirmedRetailer.length,
          }),
        ),
      ),
    );
  },
} satisfies ExportedHandler<PricesEnv>;
