/**
 * LIVE verification of the API-ecosystem sources: real network calls
 * through the real provider classes and the real catalog parser.
 *
 *   npx tsx scripts/verify-api-ecosystem-live.ts [out.json]
 *
 * Every row says whether it reached the service. Nothing is mocked here;
 * the offline (fixture) checks are tests/api-ecosystem.test.ts.
 */
import { writeFileSync } from "node:fs";
import { DictionaryProvider, FrankfurterProvider, OpenLibraryProvider, UsgsEarthquakeProvider } from "../src/providers/ReferenceProviders.ts";
import { parsePublicApis, filterDiscovered } from "../src/core/apiEcosystem/PublicApisParser.ts";
import { safeFetch } from "../plugins/safeFetch.ts";
import { PUBLIC_APIS_URL } from "../plugins/sourceCatalogApi.ts";

type Row = { check: string; live: true; ok: boolean; latencyMs: number; detail: string };
const rows: Row[] = [];

async function run(check: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const detail = await fn();
    rows.push({ check, live: true, ok: true, latencyMs: Date.now() - started, detail });
  } catch (error) {
    rows.push({ check, live: true, ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : String(error) });
  }
}

const first = async (p: { search: (q: string) => Promise<Array<{ title: string; content: string }>> }, q: string) => {
  const results = await p.search(q);
  if (results.length === 0) throw new Error(`0 results for "${q}"`);
  return `${results.length} result(s); first: ${results[0].title} — ${results[0].content.slice(0, 140)}`;
};

await run("dictionary: define serendipity", () => first(new DictionaryProvider(), "define serendipity"));
await run("openlibrary: books by Octavia Butler", () => first(new OpenLibraryProvider(), "books by Octavia Butler"));
await run("frankfurter: convert 100 USD to EUR", () => first(new FrankfurterProvider(), "convert 100 USD to EUR"));
await run("usgs: recent earthquakes", () => first(new UsgsEarthquakeProvider(), "recent earthquakes"));
await run("discovery: public-apis README via safeFetch + parser", async () => {
  const page = await safeFetch(PUBLIC_APIS_URL, { maxBytes: 1_000_000 });
  const apis = parsePublicApis(page.body);
  const open = filterDiscovered(apis, { freeOpen: true, limit: 100 });
  const known = apis.filter((a) => a.knownAs).map((a) => `${a.name}→${a.knownAs}`);
  return `${page.bytes} bytes; ${apis.length} APIs in ${new Set(apis.map((a) => a.category)).size} categories; ` +
    `${open.length}+ key-less HTTPS+CORS; matched to catalog: ${known.slice(0, 12).join(", ")}`;
});

const report = { ranAt: new Date().toISOString(), node: process.version, rows };
console.log(JSON.stringify(report, null, 2));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
