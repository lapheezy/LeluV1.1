import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME }); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start");
await page.goto(process.env.URL ?? "http://127.0.0.1:4180/"); await page.waitForTimeout(+(process.env.WAIT ?? 12000));
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); const dt = profile.timeDeltas; 
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
// inclusive per function key
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
const selfBy = new Map(), inclBy = new Map();
for (const [id, t] of self) { const n = byId.get(id); selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + t); const seen = new Set(); let cur = id; while (cur != null) { const k = key(byId.get(cur)); if (!seen.has(k)) { inclBy.set(k, (inclBy.get(k) ?? 0) + t); seen.add(k); } cur = parent.get(cur); } }
const total = [...self.values()].reduce((a, b) => a + b, 0);
const idle = [...self].filter(([id]) => ["(idle)", "(program)"].includes(byId.get(id).callFrame.functionName)).reduce((a, [, t]) => a + t, 0);
console.log(`total ${Math.round(total / 1000)}ms, busy ${Math.round((total - idle) / 1000)}ms`);
console.log("TOP SELF"); for (const [k, t] of [...selfBy].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(String(Math.round(t / 1000)).padStart(6), k);
console.log("TOP INCLUSIVE (app frames)"); for (const [k, t] of [...inclBy].filter(([k]) => /\.js:/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(String(Math.round(t / 1000)).padStart(6), k);
await b.close();
