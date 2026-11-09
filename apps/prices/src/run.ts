// A capture run: fetch every active reference page (or a filtered subset), parse
// it with its adapter, store the evidence in R2 and append one price snapshot per
// page. Domains run side by side; within a domain requests are serial and paced
// by the PoliteFetcher.
//
// Monthly cron runs are resumable: each invocation picks up the month's open run
// and skips pages that already have a snapshot in it, until none are left. Manual
// runs (POST /api/run) are closed at the end of their invocation.

import {
  countRunSnapshots,
  finishCaptureRun,
  findCaptureRunSince,
  findOpenCaptureRun,
  getCaptureRun,
  hasManualBrandCapture,
  insertPriceSnapshot,
  listCaptureTargets,
  recordRobotsCheck,
  startCaptureRun,
  storeRunReport,
  upsertPriceSource,
  type CaptureTarget,
  type CaptureTargetFilter,
  type CaptureTrigger,
  type PriceStatus,
  type RunProblem,
} from "@baromontres/shared";
import { adapterFor, fetchPrice, type PriceResult } from "./adapters/index.ts";
import { evidenceDocument } from "./extract.ts";
import { evidenceKey, putEvidence } from "./evidence.ts";
import { PoliteFetcher, type PoliteFetcherOptions } from "./polite-fetch.ts";

export interface RunOptions {
  trigger: CaptureTrigger;
  filter?: Omit<CaptureTargetFilter, "excludeRunId">;
  fetcher?: PoliteFetcherOptions;
  now?: () => Date;
}

export interface RunReport {
  runId: number;
  resumed: boolean;
  finished: boolean;
  attempted: number;
  remaining: number;
  counts: Record<string, number>;
  /** Pages whose price was not read, with the reason. */
  problems: { url: string; status: string; message: string; reference_id?: number; market_code?: string }[];
  /** Retailer prices that do not count yet (no manual brand capture). */
  unconfirmedRetailer: string[];
  requests: number;
  results: { target: CaptureTarget; result: PriceResult }[];
}

/** Pages with an adapter. Brands still waiting for theirs (unit 7) are left out. */
const runnable = (ts: CaptureTarget[]) => ts.filter((t) => adapterFor(t.url, t.adapter_key) !== null);

/** Statuses the fetcher reports when the page was not reached in this invocation. */
const DEFERRED = new Set(["budget", "rate_limited"]);

export async function runCapture(
  db: D1Database,
  bucket: R2Bucket,
  o: RunOptions,
): Promise<RunReport> {
  const now = o.now ?? (() => new Date());
  const { runId, resumed, done } = await openRun(db, o.trigger, now());
  if (done) {
    // This month's cron run already finished: nothing to do until next month.
    return { runId, resumed, finished: true, attempted: 0, remaining: 0, counts: await countRunSnapshots(db, runId), problems: [], unconfirmedRetailer: [], requests: 0, results: [] };
  }
  const fetcher = new PoliteFetcher(o.fetcher);
  const targets = runnable(await listCaptureTargets(db, { ...o.filter, excludeRunId: runId }));
  const problems: RunReport["problems"] = [];
  const unconfirmed = new Set<string>();
  const results: RunReport["results"] = [];
  const robotsRecorded = new Set<string>();
  let attempted = 0;
  let deferred = 0;

  // Group by host so each domain is worked through in order, all domains at once.
  const byHost = new Map<string, CaptureTarget[]>();
  for (const t of targets) {
    const host = new URL(t.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), t]);
  }

  await Promise.all(
    [...byHost.entries()].map(async ([host, list]) => {
      for (const t of list) {
        const adapter = adapterFor(t.url, t.adapter_key)!;
        attempted++;
        const result = await fetchPrice(
          adapter,
          { refCode: t.ref_code, brandSlug: t.brand_slug, url: t.url },
          t.market_code,
          fetcher,
        );
        if (!robotsRecorded.has(host) && result.fetchStatus !== "budget") {
          robotsRecorded.add(host);
          const rules = await fetcher.robots(host);
          await recordRobotsCheck(db, t.source, !rules.blockedReason, rules, now().toISOString());
        }
        if (DEFERRED.has(result.fetchStatus)) {
          // Not reached this time: leave it for the next invocation of the run.
          deferred++;
          problems.push({ url: t.url, status: result.fetchStatus, message: result.message ?? "" });
          if (result.fetchStatus === "budget") break;
          continue;
        }
        results.push({ target: t, result });
        let evidence: { key: string; hash: string } | null = null;
        if (result.evidenceParts.length > 0) {
          const doc = evidenceDocument(
            {
              url: t.url,
              final_url: result.finalUrl,
              captured_at: now().toISOString(),
              run: runId,
              reference: t.reference_slug,
              market: t.market_code,
              source: t.source,
              status: result.status,
              price_text: result.priceText,
              tax_label: result.taxLabel,
              user_agent: fetcher.userAgent,
            },
            result.evidenceParts,
          );
          evidence = await putEvidence(
            bucket,
            evidenceKey({ runId, brandSlug: t.brand_slug, refCode: t.ref_code, market: t.market_code, source: t.source.startsWith("retailer:") ? t.source : undefined }),
            doc,
            { run: String(runId), url: t.url, source: t.source },
          );
        }
        await writeSnapshot(db, t, runId, now(), {
          status: result.status,
          amountMinor: result.amountMinor,
          url: result.finalUrl ?? t.url,
          evidence,
          taxLabel: result.taxLabel,
        });
        if (result.taxLabel) {
          await upsertPriceSource(db, {
            brand_id: t.brand_id,
            market_code: t.market_code,
            source: t.source,
            method: "fetch",
            adapter_key: adapter.key,
            tax_label: result.taxLabel,
          });
        }
        if (result.status !== "ok") {
          problems.push({ url: t.url, status: result.status, message: result.message ?? "", reference_id: t.reference_id, market_code: t.market_code });
        }
        if (t.source.startsWith("retailer:") && result.status === "ok" && !(await hasManualBrandCapture(db, t.reference_id))) {
          unconfirmed.add(`${t.reference_slug} ${t.market_code} (${t.source})`);
        }
      }
    }),
  );

  const remaining = runnable(await listCaptureTargets(db, { ...o.filter, excludeRunId: runId })).length;
  const counts = await countRunSnapshots(db, runId);
  // Manual runs close now; cron runs close when nothing is left.
  const finished = o.trigger === "manual" || remaining === 0;
  const prior = await getCaptureRun(db, runId);
  const priorErrors = prior?.errors ? (JSON.parse(prior.errors) as unknown[]) : [];
  const errors = [
    ...priorErrors,
    ...problems.map((p) => ({ ...p, at: now().toISOString() })),
    ...[...unconfirmed].map((u) => ({ status: "retailer_unconfirmed", message: `no manual brand capture yet: ${u}` })),
  ];
  const allCounts = { ...counts, remaining, requests: fetcher.requestsMade, deferred };
  if (finished) {
    await finishCaptureRun(db, runId, allCounts, errors, now().toISOString());
    // Validation report: coverage, changes since the previous capture, outliers.
    const scope = runnable(await listCaptureTargets(db, o.filter ?? {}));
    await storeRunReport(
      db,
      runId,
      scope.map((t) => ({ reference_id: t.reference_id, market_code: t.market_code, brand_slug: t.brand_slug })),
      errors as RunProblem[],
      now(),
    );
  } else {
    await db
      .prepare(`UPDATE capture_runs SET counts = ?, errors = ? WHERE id = ?`)
      .bind(JSON.stringify(allCounts), JSON.stringify(errors), runId)
      .run();
  }
  return {
    runId,
    resumed,
    finished,
    attempted,
    remaining,
    counts,
    problems,
    unconfirmedRetailer: [...unconfirmed],
    requests: fetcher.requestsMade,
    results,
  };
}

/**
 * Cron: resume this month's open run, or start one if the month has none. An open
 * run from an earlier month is closed first. Manual: always a fresh run.
 */
async function openRun(db: D1Database, trigger: CaptureTrigger, now: Date): Promise<{ runId: number; resumed: boolean; done: boolean }> {
  if (trigger === "cron") {
    const monthStart = `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`;
    const open = await findOpenCaptureRun(db, "cron");
    if (open && open.started_at >= monthStart) return { runId: open.id, resumed: true, done: false };
    if (open) {
      const counts = await countRunSnapshots(db, open.id);
      await finishCaptureRun(db, open.id, { ...counts, closed_unfinished: 1 }, open.errors ? JSON.parse(open.errors) : [], now.toISOString());
    }
    const thisMonth = await findCaptureRunSince(db, "cron", monthStart);
    if (thisMonth) return { runId: thisMonth.id, resumed: true, done: true };
  }
  return { runId: await startCaptureRun(db, trigger, now.toISOString()), resumed: false, done: false };
}

async function writeSnapshot(
  db: D1Database,
  t: CaptureTarget,
  runId: number,
  at: Date,
  r: {
    status: PriceStatus;
    amountMinor?: number | null;
    url?: string;
    evidence?: { key: string; hash: string } | null;
    taxLabel?: string | null;
  },
): Promise<void> {
  await insertPriceSnapshot(db, {
    reference_id: t.reference_id,
    market_code: t.market_code,
    amount_minor: r.status === "ok" ? (r.amountMinor ?? null) : null,
    currency: t.currency,
    status: r.status,
    captured_at: at.toISOString(),
    source_url: r.url ?? t.url,
    evidence_key: r.evidence?.key ?? null,
    content_hash: r.evidence?.hash ?? null,
    run_id: runId,
    source: t.source,
    method: "fetch",
    tax_label: r.taxLabel ?? null,
  });
}
