import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME }); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
const reqs = []; let tSubmit = 0; const all = []; // ALLREQ
page.on("request", (r) => { if (tSubmit) all.push({ t: Date.now() - tSubmit, m: r.method(), u: r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 90) }); });
page.on("requestfinished", async (r) => { if (!tSubmit) return; const x = all.find((a) => a.u === r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 90) && a.done == null); if (x) x.done = Date.now() - tSubmit; });
page.on("console", (m) => { if (tSubmit && /\[(AIService|AIRuntime|Router|Resolver|Provider|Anthropic|Cognition|perf|Plan|Deliberat|Executive|Tool|Brain|Memory)/i.test(m.text())) all.push({ t: Date.now() - tSubmit, console: m.text().slice(0, 160) }); });
page.on("request", (r) => { const u = r.url(); if (/\/api\/(model|ai|anthropic)\//.test(u) && r.method() === "POST") { let j = {}; try { j = JSON.parse(r.postData() ?? "{}"); } catch {} reqs.push({ t: tSubmit ? Date.now() - tSubmit : -1, path: u.split("/api/")[1].split("?")[0], model: j.model, bytes: (r.postData() ?? "").length, msgs: (j.messages ?? []).length, sys: typeof j.system === "string" ? j.system.length : JSON.stringify(j.system ?? "").length, tools: (j.tools ?? []).length, max: j.max_tokens, stream: j.stream }); } });
page.on("response", (r) => { const x = reqs.find((q) => r.url().includes(q.path) && q.status == null); if (x) { x.status = r.status(); x.tResp = tSubmit ? Date.now() - tSubmit : -1; } });
await page.goto("http://127.0.0.1:4180/"); 
await page.waitForTimeout(4000);
const clickIf = async (sel, wait = 2000) => { const l = page.locator(sel).first(); if (await l.count().catch(() => 0)) { await l.click({ force: true }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };
await clickIf('button:has-text("Continue without an account")');
await clickIf('button:has-text("\u2709")', 2500);
const find = async () => { for (const sel of ['textarea[placeholder*="Message"]:visible', 'textarea:visible']) { const l = page.locator(sel).first(); if (await l.count().catch(() => 0)) return l; } return null; };
let box = await find();
for (let i = 0; !box && i < 10; i++) { await clickIf('button.lch-cosmos'); await clickIf('button:has-text("Continue without an account")'); for (const pill of ["Conversation", "Chat", "Universe"]) { if (await clickIf(`button:has-text("${pill}")`, 2500)) { box = await find(); if (box) break; } } if (!box) { box = await find(); await page.waitForTimeout(2000); } }
if (!box) throw new Error("no composer");
await page.waitForTimeout(3000); reqs.length = 0;
const prompt = process.env.PROMPT ?? "In one sentence, what is the capital of Australia?";
await box.evaluate((el) => el.focus()); await box.click().catch(() => {}); await page.keyboard.type(prompt, { delay: 12 }); await page.waitForTimeout(300);
const before = await page.evaluate(() => document.body.innerText.length);
tSubmit = Date.now(); await page.keyboard.press("Enter");
// first visible token: body text grows beyond the echoed prompt
let firstToken = null; const deadline = Date.now() + 90000; let lastLen = 0, stableSince = Date.now();
while (Date.now() < deadline) { await page.waitForTimeout(50); const txt = await page.evaluate(() => document.body.innerText); if (firstToken == null && /Canberra|canberra/.test(txt)) firstToken = Date.now() - tSubmit; if (txt.length !== lastLen) { lastLen = txt.length; stableSince = Date.now(); } if (firstToken != null && Date.now() - stableSince > 4000) break; }
const done = Date.now() - tSubmit - 4000;
const answer = await page.evaluate(() => { const m = [...document.querySelectorAll('[data-role="assistant"] .lcu-bubble, [data-role="assistant"]')].pop(); return m?.innerText?.slice(0, 300) ?? null; });
console.log(JSON.stringify(all.filter((a) => !/\.js$|\.css$|\.glb/.test(a.u ?? "")), null, 0).replace(/\},\{/g, "},\n{"));
const trace = await page.evaluate(() => { const t = globalThis.__LELU_ROUTING_TRACE__; const last = Array.isArray(t) ? t.at(-1) : (t?.turns?.at?.(-1) ?? t); return last; });
console.log("ROUTING_TRACE", JSON.stringify(trace ? { intent: trace.intent, total: trace.durationMs ?? trace.totalMs, stages: (trace.stages ?? []).map((s) => `${s.stage}:${s.durationMs}${s.handled ? "*" : ""}`).join(" "), notes: (trace.notes ?? []).slice(0, 12).map((n) => `${n.stage}: ${n.detail.slice(0, 80)}`) } : null, null, 1));
console.log(JSON.stringify({ prompt, firstAnswerTextMs: firstToken, settledMs: done, modelRequests: reqs.length, reqs, answer }, null, 1));
await page.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {}); await b.close();
