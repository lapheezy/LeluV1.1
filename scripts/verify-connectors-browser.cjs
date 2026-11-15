/**
 * Job 2 acceptance — every public data connector called from INSIDE the
 * running app in Chromium (real CORS, the app's own module), one request
 * each, recording which hosts were contacted and whether the CORS relay
 * (api.allorigins.win, the existing corsFetch fallback) was needed.
 *
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-connectors-browser.cjs <out.json>
 */
const fs = require("node:fs");
const { chromium } = require("playwright");
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = process.argv[2] ?? "connectors-browser.json";

const QUERIES = {
  "wikipedia.summary": { title: "Coral bleaching" }, "wikipedia.search": { query: "coral bleaching", limit: 5 },
  "wikidata.sparql": { sparql: "SELECT ?c ?cLabel ?pop WHERE { ?c wdt:P31 wd:Q6256; wdt:P1082 ?pop. SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. } } ORDER BY DESC(?pop) LIMIT 5" },
  "crossref.works": { query: "coral bleaching", rows: 5 }, "arxiv.search": { query: "coral reef", max: 3 }, "openalex.works": { query: "coral bleaching", limit: 3 },
  "usgs.earthquakes": { magnitude: "4.5", period: "week" }, "nws.forecast": { lat: 40.7128, lon: -74.006 }, "openmeteo.forecast": { lat: 38.72, lon: -9.14 },
  "hackernews.top": { limit: 5 }, "github.releases": { repo: "mrdoob/three.js", limit: 3 }, "nominatim.search": { query: "Lisbon", limit: 1 },
};

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const page = await (await browser.newContext()).newPage();
  const hosts = [];
  page.on("request", (r) => { try { const u = new URL(r.url()); if (!r.url().startsWith(BASE)) hosts.push({ host: u.hostname, at: Date.now() }); } catch { /* data: */ } });
  const corsErrors = [];
  page.on("console", (m) => { if (/CORS|Access-Control/i.test(m.text())) corsErrors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}?connectors`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const rows = [];
  for (const [id, q] of Object.entries(QUERIES)) {
    const t0 = Date.now();
    const r = await page.evaluate(async ({ id, q }) => {
      const C = await import("/src/core/data/PublicDataConnectors.ts");
      const t = performance.now();
      const res = await C.queryConnector(id, q, { timeoutMs: 20000 });
      return { ok: res.ok, ms: Math.round(performance.now() - t), rows: res.ok ? res.rows.length : 0, detail: res.ok ? res.summary.slice(0, 120) : res.reason.slice(0, 200), citation: res.ok ? res.citation : null };
    }, { id, q });
    const contacted = [...new Set(hosts.filter((h) => h.at >= t0).map((h) => h.host))];
    rows.push({ id, ...r, hosts: contacted, relay: contacted.includes("api.allorigins.win") });
    console.log(`${r.ok ? "OK  " : "FAIL"} ${id.padEnd(20)} ${String(r.ms).padStart(5)} ms  rows ${r.rows}  hosts ${contacted.join(",")}  ${r.detail}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, rows, corsConsole: corsErrors.slice(0, 20) }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
