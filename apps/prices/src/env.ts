export interface PricesEnv {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  /** Secret: bearer token for POST /api/run. */
  RUN_TOKEN?: string;
  /** Secret: bearer token for POST /api/capture (the bookmarklet). */
  CAPTURE_TOKEN?: string;
  PUBLIC_ORIGIN?: string;
  MAX_REQUESTS_PER_INVOCATION?: string;
  INVOCATION_BUDGET_MS?: string;
  MIN_DELAY_MS?: string;
}

export const numVar = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
