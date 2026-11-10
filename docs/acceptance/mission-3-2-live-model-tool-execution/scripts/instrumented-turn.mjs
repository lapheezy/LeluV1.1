/** MISSION 3.2 Gate B/C: capture the REAL outbound request + model tool calls. */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-2-live-model-tool-execution";
const promptText = readFileSync(process.argv[2], "utf8");
const tag = process.argv[3] ?? "gate-c";
const budget = Number(process.env.TIMEOUT_MS ?? 150000);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// Model override through the app's OWN documented channel (__LELU_<NAME>__),
// never a source edit: gpt-oss-120b's daily TPD was exhausted this run.
const m32model = process.env.M32_MODEL;
if (m32model) await page.addInitScript((m) => { globalThis.__LELU_GROQ_MODEL__ = m; }, m32model);
const pageErrors = [], consoleErrors = [], consoleAll = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
page.on("console", (m) => { const t = m.text(); consoleAll.push(`${m.type()}:${t}`.slice(0, 300)); if (m.type() === "error") consoleErrors.push(t.slice(0, 200)); });
await page.addInitScript(() => {
  window.__m32 = { req: [], res: [] };
  const orig = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const body = init && init.body;
    const rec = { at: Date.now(), path: String(url).replace(location.origin, ""), bytes: typeof body === "string" ? body.length : null };
    if (typeof body === "string" && String(url).includes("/api/model/")) {
      try {
        const p = JSON.parse(body);
        rec.model = p.model ?? null;
        rec.messages = Array.isArray(p.messages) ? p.messages.length : null;
        rec.stream = Boolean(p.stream);
        rec.tools = Array.isArray(p.tools) ? p.tools.length : 0;
        rec.toolNames = Array.isArray(p.tools) ? p.tools.map((t) => (t && t.function ? t.function.name : t && t.name)).slice(0, 40) : [];
      } catch { rec.parse = "failed"; }
    }
    window.__m32.req.push(rec);
    const res = await orig.apply(this, arguments);
    if (String(url).includes("/api/model/")) {
      res.clone().text().then((t) => {
        let parsed = null;
        try { parsed = JSON.parse(t); } catch {}
        const msg = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0].message : null;
        window.__m32.res.push({ at: Date.now(), path: rec.path, status: res.status, model: parsed && parsed.model ? parsed.model : null, streamed: Boolean(rec.stream), toolCalls: msg && Array.isArray(msg.tool_calls) ? msg.tool_calls.map((c) => ({ id: c.id, name: c.function && c.function.name, args: String((c.function && c.function.arguments) || "").slice(0, 500) })) : [], textLen: msg && msg.content ? msg.content.length : 0, sseHasToolCalls: /"tool_calls"/.test(t), sseNames: [...new Set((t.match(/"name"\s*:\s*"([a-z_]+)"/g) || []))].slice(0, 12), usage: parsed && parsed.usage ? parsed.usage : null, error: parsed && parsed.error ? String(parsed.error.message || parsed.error.code).slice(0, 200) : null });
      }).catch(() => {});
    }
    return res;
  };
});
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }); if (ok) break; await page.waitForTimeout(400); }
await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); });
await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20000 }).catch(() => {});
await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1200);
const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.click(nav.x, nav.y);
await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 20000 });
await page.waitForTimeout(1000);
const cues = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); return ta ? { disabled: ta.disabled, target: document.querySelector(".lcu-target")?.textContent ?? null } : null; });
const box = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); const r = ta.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.click(box.x, box.y);
await page.keyboard.type(promptText, { delay: 2 });
const typed = await page.locator(".lcu textarea").first().inputValue();
const beforeReqs = await page.evaluate(() => window.__m32.req.length);
await page.keyboard.press("Enter");
const sentAt = Date.now();
const samples = [];
let lastSig = "", stable = 0;
while (Date.now() - sentAt < budget) {
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => ({ t: Date.now(), win: Boolean(document.querySelector("[data-lelu-chat-window]")), sending: document.querySelector("[data-lelu-chat-window]")?.getAttribute("data-lelu-sending") ?? null, msgs: document.querySelectorAll(".lelu-cc-msg").length, reqs: window.__m32.req.length, resps: window.__m32.res.length, toolCalls: window.__m32.res.reduce((n, r) => n + (r.toolCalls ? r.toolCalls.length : 0), 0) })).catch(() => null);
  if (s) { samples.push({ ...s, t: s.t - sentAt }); const sig = JSON.stringify({ w: s.win, m: s.msgs, q: s.reqs, r: s.resps, tc: s.toolCalls, s: s.sending }); if (sig === lastSig) stable += 1; else { stable = 0; lastSig = sig; } if (stable >= 8) break; }
}
const net = await page.evaluate((from) => ({ req: window.__m32.req.slice(from), res: window.__m32.res }), beforeReqs).catch(() => ({ req: [], res: [] }));
const dom = await page.evaluate(() => ({
  chatWindow: Boolean(document.querySelector("[data-lelu-chat-window]")),
  messages: [...document.querySelectorAll(".lelu-cc-msg")].map((m) => (m.textContent || "").trim().slice(0, 700)),
  surfaces: [...new Set([...document.querySelectorAll("[data-lelu-surface]")].map((e) => e.getAttribute("data-lelu-surface")))],
  modules: [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => e.getAttribute("data-lelu-module-window") || e.id).slice(0, 15),
  bodyTail: (document.body.innerText || "").slice(-900),
  gate: Boolean(document.querySelector("[data-lelu-signin-gate]")),
})).catch((e) => ({ evalError: String(e).slice(0, 200) }));
await page.screenshot({ path: `${OUT}/shots/${tag}.png`, timeout: 12000 }).catch(() => {});
const result = { tag, at: new Date().toISOString(), prompt: promptText, cues, typedChars: typed.length, elapsedMs: Date.now() - sentAt, requests: net.req, responses: net.res, dom, samples: samples.map((s) => ({ t: s.t, win: s.win, msgs: s.msgs, reqs: s.reqs, resps: s.resps, toolCalls: s.toolCalls, sending: s.sending })), providerLog: consoleAll.filter((l) => /Trying |tool|environment|fallback|reduced|without tools|dispatch/i.test(l)).slice(-50), pageErrors, consoleErrors: consoleErrors.slice(0, 10) };
writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(result, null, 1));
await browser.close().catch(() => {});
console.log(JSON.stringify({ tag, elapsedMs: result.elapsedMs, reqs: net.req.length, resStatuses: net.res.map((r) => r.status), toolCallCount: net.res.reduce((n, r) => n + (r.toolCalls ? r.toolCalls.length : 0), 0), reqSummaries: net.req.map((r) => ({ model: r.model, bytes: r.bytes, tools: r.tools, msg: r.messages, stream: r.stream })), dom: { win: dom.chatWindow, msgs: (dom.messages || []).length, last: (dom.messages || []).slice(-1)[0], modules: dom.modules } }, null, 1));
