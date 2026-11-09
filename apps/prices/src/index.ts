import { createApp } from "./app.ts";
import { numVar, type PricesEnv } from "./env.ts";
import { runCapture } from "./run.ts";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: PricesEnv, ctx: ExecutionContext) {
    const budget = numVar(env.INVOCATION_BUDGET_MS, 600_000);
    const maxHosts = env.MAX_HOSTS_PER_INVOCATION ? numVar(env.MAX_HOSTS_PER_INVOCATION, 1) : undefined;
    ctx.waitUntil(
      runCapture(env.DB, env.EVIDENCE, {
        trigger: "cron",
        maxHosts,
        // One step per 10-minute firing, so each firing starts at the next domain.
        hostOffset: Math.floor(event.scheduledTime / 600_000),
        fetcher: {
          minDelayMs: numVar(env.MIN_DELAY_MS, 3000),
          maxRequests: numVar(env.MAX_REQUESTS_PER_INVOCATION, 40),
          deadline: Date.now() + budget,
        },
      }).then((r) =>
        console.log(
          JSON.stringify({ run: r.runId, resumed: r.resumed, finished: r.finished, attempted: r.attempted, remaining: r.remaining, requests: r.requests, counts: r.counts, problems: r.problems.length, unconfirmed_retailer: r.unconfirmedRetailer.length }),
        ),
      ),
    );
  },
} satisfies ExportedHandler<PricesEnv>;
