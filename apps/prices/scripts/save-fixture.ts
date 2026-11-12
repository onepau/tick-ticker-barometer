/**
 * Saves a few live pages as test fixtures, through the polite fetcher (robots.txt,
 * >= 3 s per domain, honest user agent). Writes only under the given directory.
 *   node scripts/save-fixture.ts <outDir> <name>=<url> ...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PoliteFetcher } from "../src/polite-fetch.ts";

const [dir, ...pairs] = process.argv.slice(2);
mkdirSync(dir!, { recursive: true });
const f = new PoliteFetcher();
for (const p of pairs) {
  const i = p.indexOf("=");
  const name = p.slice(0, i);
  const url = p.slice(i + 1);
  const r = await f.get(url);
  console.log(name, r.status, "httpStatus" in r ? r.httpStatus : "", "html" in r ? r.html.length : "", "message" in r ? r.message : "");
  if (r.status === "ok") writeFileSync(`${dir}/${name}.html`, r.html);
}
