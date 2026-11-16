// Cold-boot measurement of the real built app through a gzip front.
import pw from "playwright"; const { chromium } = pw;
const URL = process.env.URL ?? "http://127.0.0.1:4180/"; const RUNS = +(process.env.RUNS ?? 5);
const PROFILES = { desktop: { cpu: 1, latency: 20, down: 50e6 }, mobile: { cpu: 4, latency: 120, down: 9e6 } };
const prof = PROFILES[process.env.PROFILE ?? "desktop"];
const med = (a) => { const s = [...a].filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined, args: ["--enable-unsafe-swiftshader"] });
const out = [];
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ viewport: process.env.PROFILE === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: prof.latency, downloadThroughput: prof.down / 8, uploadThroughput: 2e6 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
  let js = 0, jsN = 0, reqs = 0, api = {}; const t0 = Date.now();
  cdp.on("Network.loadingFinished", (e) => { reqs++; });
  cdp.on("Network.responseReceived", (e) => { const u = e.response.url; if (u.endsWith(".js")) jsN++; if (u.includes("/api/")) { const k = new globalThis.URL(u).pathname; api[k] = (api[k] ?? 0) + 1; } });
  cdp.on("Network.dataReceived", (e) => { js += e.encodedDataLength; });
  await page.addInitScript(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); });
  await page.goto(URL, { waitUntil: "commit" });
  const sel = async (s, ms = 30000) => { try { await page.waitForSelector(s, { timeout: ms, state: "attached" }); return Date.now() - t0; } catch { return null; } };
  const rootPainted = await page.waitForFunction(() => document.getElementById("root")?.children.length > 0, null, { timeout: 30000 }).then(() => Date.now() - t0).catch(() => null);
  const canvas = await sel("canvas", 30000);
  await page.waitForTimeout(6000);
  const m = await page.evaluate(() => {
    const p = (n) => performance.getEntriesByName(n)[0]?.startTime ?? null;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const lt = window.__lt; const tbt = lt.reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    return { fcp, app: p("lelu:APP_START"), chat: p("lelu:CHAT_READY"), boot: p("lelu:BOOTSTRAP_DONE"), provider: p("lelu:PROVIDER_READY"), longTasks: lt.length, longMs: Math.round(lt.reduce((a, [, d]) => a + d, 0)), tbt: Math.round(tbt), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, resources: performance.getEntriesByType("resource").length };
  });
  out.push({ ...m, rootPainted, canvas, transferKB: Math.round(js / 1024), jsFiles: jsN, api });
  await ctx.close();
}
await browser.close();
const keys = ["fcp", "rootPainted", "app", "chat", "boot", "provider", "canvas", "longTasks", "longMs", "tbt", "heapMB", "transferKB", "jsFiles", "resources"];
const summary = Object.fromEntries(keys.map((k) => [k, med(out.map((r) => r[k]))]));
console.log(JSON.stringify({ profile: process.env.PROFILE ?? "desktop", runs: RUNS, median: summary, apiCalls: out[0].api }, null, 1));
