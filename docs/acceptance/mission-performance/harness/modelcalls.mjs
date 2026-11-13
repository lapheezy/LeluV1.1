import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const page = await (await b.newContext()).newPage(); const t0 = Date.now();
page.on("request", (r) => { if (/\/api\/(model|ai|anthropic|groq|openrouter|chat)/.test(r.url())) { let body = r.postData() ?? ""; let j; try { j = JSON.parse(body); } catch {} const msgs = j?.messages ?? []; console.log(`+${Date.now()-t0}ms ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/,"")} model=${j?.model} msgs=${msgs.length} bytes=${body.length} max_tokens=${j?.max_tokens} tools=${(j?.tools??[]).length}`); const last = msgs.at(-1); console.log("   last:", JSON.stringify(last?.content)?.slice(0, 300)); } });
page.on("response", async (r) => { if (/\/api\/model\//.test(r.url())) console.log(`   <- ${r.status()} ${r.url().split("/api/")[1]}`); });
await page.goto(process.env.URL ?? "http://127.0.0.1:4180/"); await page.waitForTimeout(+(process.env.WAIT ?? 20000)); await b.close();
