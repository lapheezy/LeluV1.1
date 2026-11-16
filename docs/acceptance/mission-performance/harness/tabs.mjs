import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext(); const t0 = Date.now(); const calls = [];
const hide = process.env.HIDE === "1";
if (hide) await ctx.addInitScript(() => { Object.defineProperty(document, "visibilityState", { get: () => "hidden" }); Object.defineProperty(document, "hidden", { get: () => true }); });
ctx.on("request", (r) => { const m = r.url().match(/\/api\/model\/([^/]+)\/chat/); if (m) calls.push([Math.round((Date.now() - t0) / 1000), m[1], r.frame()?.page() ? "" : ""]); });
const pages = []; for (let i = 0; i < +(process.env.TABS ?? 1); i++) { const p = await ctx.newPage(); pages.push(p); p.on("request", (r) => { const m = r.url().match(/\/api\/model\/([^/]+)\/chat/); if (m) console.log(`tab${i} +${Math.round((Date.now()-t0)/1000)}s ${m[1]}`); }); await p.goto("http://127.0.0.1:4180/"); }
await new Promise((r) => setTimeout(r, +(process.env.WAIT ?? 150000)));
console.log(`TOTAL model requests: ${calls.length} by provider:`, JSON.stringify(calls.reduce((a, [, p]) => ((a[p] = (a[p] ?? 0) + 1), a), {})));
await b.close();
