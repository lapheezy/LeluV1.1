/**
 * Cold page-load comparison, same machine, same method: N fresh browser
 * contexts per target × profile. Values are Navigation/Paint Timing and
 * performance.memory read from the page — container numbers, not device ones.
 *   node perf-probe.mjs <label>=<url> [<label>=<url> …]
 */
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
const N = Number(process.env.RUNS || 3);
const targets = process.argv.slice(2).map((a) => a.split("="));
const browser = await chromium.launch({ ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}), args: ["--no-sandbox", "--enable-precise-memory-info"] });
const out = {};
for (const [label, url] of targets) for (const [prof, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["iphone13", { ...devices["iPhone 13"], deviceScaleFactor: 1 }]]) {
  const runs = [];
  for (let i = 0; i < N; i += 1) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    // The default Resource Timing buffer holds 250 entries; LÉLU loads more.
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "load" });
    const wall = Date.now() - t0;
    await page.waitForTimeout(8000);
    runs.push({ wallLoadMs: wall, ...(await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
      const res = performance.getEntriesByType("resource");
      return { dclMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd), fcpMs: fcp ? Math.round(fcp.startTime) : null,
        requests8s: res.length, transferredKb8s: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
        heapMb8s: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, domNodes: document.getElementsByTagName("*").length };
    })), pageErrors: errors.length });
    await ctx.close();
  }
  const med = (k) => { const v = runs.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  out[`${label}/${prof}`] = { runs, median: Object.fromEntries(["wallLoadMs", "dclMs", "loadMs", "fcpMs", "requests8s", "transferredKb8s", "heapMb8s", "domNodes"].map((k) => [k, med(k)])) };
  console.log(label, prof, JSON.stringify(out[`${label}/${prof}`].median));
}
writeFileSync("docs/acceptance/workforce-consolidation/perf-probe.json", JSON.stringify(out, null, 2));
await browser.close();
