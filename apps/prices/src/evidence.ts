// Evidence for every price: an HTML extract (fetched pages) or the full page copy
// (bookmarklet captures) in R2, keyed by run, brand, reference and market.

export interface EvidenceKeyParts {
  runId: number;
  brandSlug: string;
  refCode: string;
  market: string;
  /** Distinguishes sources for the same cell, e.g. "retailer-www.bucherer.com". */
  source?: string;
  ext?: "html";
}

const seg = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** runs/<run>/<brand>/<ref>/<market>[--<source>].html */
export function evidenceKey(p: EvidenceKeyParts): string {
  const src = p.source ? `--${seg(p.source.replace(":", "-"))}` : "";
  return `runs/${p.runId}/${seg(p.brandSlug)}/${seg(p.refCode)}/${p.market.toUpperCase()}${src}.${p.ext ?? "html"}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores the evidence; returns its key and hash. */
export async function putEvidence(
  bucket: R2Bucket,
  key: string,
  html: string,
  meta: Record<string, string>,
): Promise<{ key: string; hash: string }> {
  const hash = await sha256Hex(html);
  await bucket.put(key, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: { ...meta, sha256: hash },
  });
  return { key, hash };
}
