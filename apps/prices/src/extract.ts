// Small HTML helpers for adapters: JSON-LD blocks, text of a fragment, and the
// evidence extract stored in R2. Regex based on purpose: product pages are large
// (0.5–1 MB) and Workers have no DOM parser; adapters only need a few anchors.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  pound: "£",
  rsquo: "’",
  lsquo: "‘",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment (tags removed, entities decoded, spaces collapsed). */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export interface JsonLdBlock {
  raw: string;
  data: unknown;
}

/** Every parseable JSON-LD block on the page. */
export function jsonLdBlocks(html: string): JsonLdBlock[] {
  const out: JsonLdBlock[] = [];
  const re =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[0];
    try {
      out.push({ raw, data: JSON.parse(m[1]!.trim()) });
    } catch {
      // Malformed blocks are common; skip them.
    }
  }
  return out;
}

export interface ProductOffer {
  name: string | null;
  sku: string | null;
  mpn: string | null;
  price: unknown;
  priceCurrency: string | null;
  availability: string | null;
  url: string | null;
  block: JsonLdBlock;
}

function nodes(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(nodes);
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    return [o, ...nodes(o["@graph"])];
  }
  return [];
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;

/** The schema.org Product offers on the page, first offer of each product. */
export function productOffers(html: string): ProductOffer[] {
  const out: ProductOffer[] = [];
  for (const block of jsonLdBlocks(html)) {
    for (const n of nodes(block.data)) {
      const type = n["@type"];
      const isProduct =
        type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
      const o = (offers && typeof offers === "object" ? offers : {}) as Record<
        string,
        unknown
      >;
      out.push({
        name: str(n.name),
        sku: str(n.sku),
        mpn: str(n.mpn),
        price: o.price ?? (o as { lowPrice?: unknown }).lowPrice ?? null,
        priceCurrency: str(o.priceCurrency),
        availability: str(o.availability),
        url: str(o.url) ?? str(n.url),
        block,
      });
    }
  }
  return out;
}

/** Up to `radius` characters either side of the first match of `needle`. */
export function snippetAround(
  html: string,
  needle: string | RegExp,
  radius = 600,
): string | null {
  const i =
    typeof needle === "string" ? html.indexOf(needle) : html.search(needle);
  if (i < 0) return null;
  return html.slice(Math.max(0, i - radius), Math.min(html.length, i + radius));
}

/** First capture group of a regex, or null. */
export function match1(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] ?? null;
}

/**
 * The evidence stored in R2 for a fetched page: a small HTML document holding the
 * parts of the page the price was read from, with the URL and time on top. The
 * full page is not kept (it is 0.5–1 MB and mostly scripts); the extract is what
 * a reader needs to check the figure.
 */
export function evidenceDocument(
  meta: Record<string, string | number | null>,
  parts: (string | null)[],
): string {
  const head = Object.entries(meta)
    .map(([k, v]) => `${k}: ${String(v ?? "")}`.replace(/--/g, "- -"))
    .join("\n");
  const body = parts
    .filter((p): p is string => !!p)
    .map((p, i) => `<section data-part="${i + 1}">\n${p}\n</section>`)
    .join("\n");
  return `<!doctype html>\n<!--\n${head}\n-->\n<meta charset="utf-8">\n${body}\n`;
}

/** First sentence, keeping abbreviations such as "V.A.T." whole. */
export function firstSentence(s: string): string {
  const m = s.trim().match(/^.*?V\.A\.T\.(?=\s|$)|^.*?[a-z\d)]\.(?=\s+[A-Z]|$)/);
  return (m ? m[0] : s).trim();
}
