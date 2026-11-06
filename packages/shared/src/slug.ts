/**
 * Slugs for the brand registry.
 *
 * `slugifyBrand` reproduces the slug that tick-ticker-gphg already serves at
 * `gphg.tick-ticker.com/brand/<slug>`: its `canonical_key()` (gphg/brand_index.py)
 * followed by `slugFromBrandId()` (worker/src/lib/db.js, spaces to hyphens). Registry
 * slugs must equal those wherever a GPHG page exists, so no live URL breaks. Keep the
 * word lists below in step with brand_index.py; the test over every GPHG brand
 * (packages/shared/tests/slug.test.ts) fails if they drift.
 *
 * On top of GPHG's rules it transliterates letters that Unicode NFKD cannot
 * decompose (ø, æ, ß, ł…). GPHG would silently drop those, turning "Ørsted" into
 * "rsted"; no GPHG brand contains one, so parity is unaffected.
 */

/** Legal and structural noise words dropped from the slug (not from display names). */
const NOISE = new Set([
  "watches",
  "watch",
  "montres",
  "manufacture",
  "geneve",
  "geneva",
  "sa",
  "cie",
  "co",
]);

/** Exact raw-string fixes GPHG applies before keying (corrupted source strings, confirmed merges). */
const RAW_FIXES: Record<string, string> = {
  "Moritz Grossmann Glash\\xfctte I/Sa": "Moritz Grossmann",
  "Moritz Grossmann Glashütte l/SA": "Moritz Grossmann",
  "Fiyta-X": "FIYTA",
};

/** GPHG's hand-curated merges on the normalised key (variant → target). */
const ALIAS: Record<string, string> = {
  bvlgari: "bulgari",
  "christiaan van der klaaw": "christiaan van der klaauw",
  "de grisonogo": "de grisogono",
  delanea: "delaneau",
  "chronometrie ferdinand berthoud": "ferdinand berthoud",
  "champs elyses": "champs elysees",
  "luxius suisses": "luxius suisse",
  "moritz grossmann glashutte i": "moritz grossmann glashutte",
  "moritz grossmann glashutte l": "moritz grossmann glashutte",
  "urban jugensen sonner": "urban jurgensen",
  "urban jurgensen sonner": "urban jurgensen",
  "atelier akrivia": "akrivia",
};

/** Letters NFKD leaves intact, so a plain ASCII fold would drop them. */
const TRANSLITERATE: Record<string, string> = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  ẞ: "SS",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "TH",
  ı: "i",
  ħ: "h",
  Ħ: "H",
};

/** Accent-fold to lower-case ASCII, transliterating what NFKD can't reach. */
export function foldAscii(input: string): string {
  return (
    input
      .replace(/[øØæÆœŒßẞłŁđĐðÐþÞıħĦ]/g, (c) => TRANSLITERATE[c] ?? c)
      // Typographic quotes and dashes would otherwise vanish and glue words together
      // ("Beda’a" → "bedaa" while "Beda'a" → "beda-a"); treat them as ASCII punctuation.
      .replace(/[‘’‚‛ʼ′`´]/g, "'")
      .replace(/[‐-―−]/g, "-")
      .normalize("NFKD")
      .replace(/[^\x00-\x7f]/g, "")
      .toLowerCase()
  );
}

/** Tokens of a brand name: ASCII-folded, `&` and punctuation turned into word breaks. */
function tokens(name: string): string[] {
  const fixed = RAW_FIXES[name] ?? name;
  return foldAscii(fixed)
    .replace(/&/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * GPHG's matching key: tokens without noise words or "and", joined by spaces, after
 * GPHG's alias merges. Equal to the `brand_id` column in tick-ticker-gphg/brands.csv.
 */
export function brandKey(name: string): string {
  const key = tokens(name)
    .filter((t) => !NOISE.has(t) && t !== "and")
    .join(" ");
  return ALIAS[key] ?? key;
}

/**
 * Registry slug for a brand name, for example "H. Moser & Cie." → "h-moser" and
 * "Andersen Genève" → "andersen". Throws if the name has no Latin letters or digits.
 */
export function slugifyBrand(name: string): string {
  let key = brandKey(name);
  // A name made only of noise words ("Montres", "Watch Co.") would key to nothing.
  // GPHG has no such brand; keep the words rather than return an empty slug.
  if (!key) key = tokens(name).join(" ");
  if (!key)
    throw new Error(
      `slugifyBrand: no usable characters in ${JSON.stringify(name)}`,
    );
  return key.replace(/\s+/g, "-");
}

/** Turn a GPHG `brand_id` ("audemars piguet") into its live slug ("audemars-piguet"). */
export function slugFromGphgBrandId(brandId: string): string {
  return brandId.trim().replace(/\s+/g, "-");
}

/** Normalise a manufacturer reference: "310.30.42.50.01.001" → "310-30-42-50-01-001". */
export function normaliseRefCode(refCode: string): string {
  const out = foldAscii(refCode)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!out)
    throw new Error(
      `normaliseRefCode: no usable characters in ${JSON.stringify(refCode)}`,
    );
  return out;
}

/** Reference slug: `<brand-slug>/<normalised-ref-code>`, for example `omega/310-30-42-50-01-001`. */
export function slugifyReference(brandSlug: string, refCode: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(brandSlug)) {
    throw new Error(
      `slugifyReference: invalid brand slug ${JSON.stringify(brandSlug)}`,
    );
  }
  return `${brandSlug}/${normaliseRefCode(refCode)}`;
}

/** Slugs claimed by more than one distinct name, mapped to those names. Empty when clean. */
export function findSlugCollisions(
  names: Iterable<string>,
  slugify: (name: string) => string = slugifyBrand,
): Map<string, string[]> {
  const bySlug = new Map<string, Set<string>>();
  for (const name of names) {
    const slug = slugify(name);
    const set = bySlug.get(slug) ?? new Set<string>();
    set.add(name);
    bySlug.set(slug, set);
  }
  const collisions = new Map<string, string[]>();
  for (const [slug, set] of bySlug)
    if (set.size > 1) collisions.set(slug, [...set].sort());
  return collisions;
}

/** Throw with a readable list if any slug is claimed by more than one name. */
export function assertNoSlugCollisions(
  names: Iterable<string>,
  slugify: (name: string) => string = slugifyBrand,
): void {
  const collisions = findSlugCollisions(names, slugify);
  if (collisions.size === 0) return;
  const lines = [...collisions].map(
    ([slug, ns]) => `  ${slug}: ${ns.join(" | ")}`,
  );
  throw new Error(`Slug collisions:\n${lines.join("\n")}`);
}

/**
 * A slug for a new brand that doesn't clash with `taken`: the plain slug when free,
 * otherwise `<slug>-2`, `<slug>-3`… Never use this to rename a brand that already has
 * a live GPHG page.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
