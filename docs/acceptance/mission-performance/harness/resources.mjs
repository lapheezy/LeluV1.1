import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: +(process.env.W ?? 1440), height: +(process.env.H ?? 900) } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable"); const reqs = new Map(); const size = new Map();
cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, t: e.timestamp, init: e.initiator?.stack?.callFrames?.slice(0, 6).map((f) => f.url.split("/").pop() + ":" + f.functionName).join(" < ") ?? e.initiator?.type, body: e.request.postData?.slice(0, 400) }));
cdp.on("Network.loadingFinished", (e) => size.set(e.requestId, e.encodedDataLength));
await page.goto(process.env.URL ?? "http://127.0.0.1:4180/"); await page.waitForTimeout(+(process.env.WAIT ?? 10000));
const rows = [...reqs].map(([id, r]) => ({ ...r, kb: Math.round((size.get(id) ?? 0) / 1024) }));
const kind = (u) => u.includes(".glb") ? "glb" : u.endsWith(".js") ? "js" : u.includes("/api/") ? "api" : u.split(".").pop().slice(0, 5);
const by = {}; for (const r of rows) { const k = kind(r.url); by[k] ??= [0, 0]; by[k][0]++; by[k][1] += r.kb; }
console.log("BY KIND", JSON.stringify(by));
for (const r of rows.sort((a, b) => b.kb - a.kb).slice(0, +(process.env.TOP ?? 15))) console.log(String(r.kb).padStart(7), "KB", r.url.replace(/^https?:\/\/[^/]+/, ""));
const pat = process.env.FIND; if (pat) for (const r of rows.filter((r) => r.url.includes(pat))) console.log("\nFIND", r.url, "\n  initiator:", r.init, "\n  body:", r.body);
await b.close();
