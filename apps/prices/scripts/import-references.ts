/**
 * Writes apps/prices/seed/references_seed.sql from docs/plans/u5-reference-candidates.csv.
 *
 *   node scripts/import-references.ts            (from apps/prices)
 *   pnpm --filter @baromontres/prices db:migrate:local
 *   pnpm --filter @baromontres/registry db:seed:local   (brands first)
 *   pnpm --filter @baromontres/prices db:seed:local
 *
 * Local D1 only. Re-running is safe: every statement upserts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildReferencesSql } from "./references-sql.ts";

const csvPath = new URL("../../../docs/plans/u5-reference-candidates.csv", import.meta.url);
const outPath = new URL("../seed/references_seed.sql", import.meta.url);
const r = buildReferencesSql(readFileSync(csvPath, "utf8"));
writeFileSync(outPath, r.sql);
console.log(`references ${r.references}, urls ${r.urls}, sources ${r.sources} -> seed/references_seed.sql`);
for (const s of r.skipped) console.log(`skipped: ${s}`);
