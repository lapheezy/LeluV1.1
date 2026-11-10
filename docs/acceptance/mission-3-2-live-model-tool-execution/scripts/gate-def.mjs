/** MISSION 3.2 Gates D/E/F: model-created environment visible, same-ID continuity, reload persistence. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-2-live-model-tool-execution";
const P1 = "Create a new interactive studio environment in my Cosmos. Include a central workspace, a research area, and a visual presentation area. Make the environment accessible for me to explore and modify.";
const P2 = "Inspect the studio you just created. Identify what is missing for a working research and presentation environment, then add a dedicated research board and connect it to the central workspace.";
const log = { at: new Date().toISOString(), steps: [], reqs: [], res: [], console: [], env: {}, errors: [] };
const save = () => writeFileSync(`${OUT}/gate-def.json`, JSON.stringify(log, null, 1));
const step = (name, data) => { log.steps.push({ t: Date.now(), name, ...(data || {}) }); save(); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log.errors.push("page:" + String(e).slice(0, 200)));
page.on("console", (m) => { const t = m.text(); if (/Tool |environment|ProviderResolver|failed/i.test(t)) log.console.push(`${m.type()}:${t}`.slice(0, 260)); });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
await page.addInitScript(() => {
  window.__m32 = { req: [], res: [] };
  const orig = window.fetch;
  window.fetch = async function (input, init) {
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    const body = init && init.body;
    const rec = { at: Date.now(), path: url.replace(location.origin, ""), bytes: typeof body === "string" ? body.length : null };
    if (typeof body === "string" && url.includes("/api/model/") && url.includes("chat/completions")) {
      try { const p = JSON.parse(body); rec.model = p.model; rec.tools = Array.isArray(p.tools) ? p.tools.length : 0; rec.toolNames = (p.tools || []).map((t) => t && t.function ? t.function.name : null); rec.msg = (p.messages || []).length; rec.stream = !!p.stream; } catch {}
    }
    window.__m32.req.push(rec);
    const res = await orig.apply(this, arguments);
    if (url.includes("/api/model/") && url.includes("chat/completions")) {
      res.clone().text().then((t) => { window.__m32.res.push({ at: Date.now(), path: rec.path, status: res.status, sseTool: /"tool_calls"/.test(t), names: [...new Set((t.match(/"name"\s*:\s*"([a-z_0-9]+)"/g) || []))].slice(0, 8), body4: t.slice(0, 4) }); }).catch(() => {});
    }
    return res;
  };
});
async function settle() {
  for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function openChat() {
  const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  await page.mouse.click(nav.x, nav.y);
  await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 20000 });
  await page.waitForTimeout(900);
  const box = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); const r = ta.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: ta.disabled }; });
  return box;
}
async function send(text) {
  const box = await openChat();
  await page.mouse.click(box.x, box.y);
  await page.keyboard.type(text, { delay: 2 });
  await page.keyboard.press("Enter");
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < 100000) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ tools: [...document.querySelectorAll("[data-lelu-module-window]")].length, body: (document.body.innerText || "").slice(-1200) }));
    const sig = s.body.length + "|" + s.tools;
    if (/tool used|tools used|Done|Nothing was repeated|I did the work/i.test(s.body) && sig === last) break;
    last = sig;
  }
  return Date.now() - t0;
}
const envState = () => page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const out = { keys, envs: [] };
  for (const k of keys) {
    if (!/environ/i.test(k)) continue;
    try { const v = JSON.parse(localStorage.getItem(k)); const arr = Array.isArray(v) ? v : (v && Array.isArray(v.environments) ? v.environments : null);
      if (arr) out.envs.push({ key: k, count: arr.length, ids: arr.map((e) => e && (e.id || e.environmentId)).slice(0, 6), titles: arr.map((e) => e && (e.title || e.name)).slice(0, 6), revisions: arr.map((e) => e && (e.revision || (e.meta && e.meta.revision))).slice(0, 6) });
      else out.envs.push({ key: k, shape: Object.keys(v || {}).slice(0, 8), sample: JSON.stringify(v).slice(0, 250) });
    } catch { out.envs.push({ key: k, raw: String(localStorage.getItem(k)).slice(0, 150) }); }
  }
  out.windows = [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => ({ id: e.getAttribute("data-lelu-module-window"), title: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 60), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) }));
  return out;
});
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
step("ready");
log.t1 = await send(P1);
step("turn1-sent", { ms: log.t1 });
log.env.afterCreate = await envState();
await page.screenshot({ path: `${OUT}/shots/d1-desktop-1440x900.png`, timeout: 12000 }).catch(() => {});
step("desktop-shot", { windows: log.env.afterCreate.windows.length });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1500);
log.env.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => ({ id: e.getAttribute("data-lelu-module-window"), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })));
await page.screenshot({ path: `${OUT}/shots/d2-mobile-390x844.png`, timeout: 12000 }).catch(() => {});
step("mobile-shot", { windows: log.env.mobile.length });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1500);
log.preReloadIds = (log.env.afterCreate.envs[0] || {}).ids || [];
await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(4000);
await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(3000);
log.env.afterReload = await envState();
await page.screenshot({ path: `${OUT}/shots/f1-after-reload.png`, timeout: 12000 }).catch(() => {});
step("reload", { ids: (log.env.afterReload.envs[0] || {}).ids });
await page.waitForTimeout(45000); // Groq TPM window
log.t2 = await send(P2);
step("turn2-sent", { ms: log.t2 });
log.env.afterModify = await envState();
await page.screenshot({ path: `${OUT}/shots/e1-after-modify.png`, timeout: 12000 }).catch(() => {});
step("modify-shot", {});
log.net = await page.evaluate(() => window.__m32).catch(() => ({ req: [], res: [] }));
save();
await browser.close().catch(() => {});
const brief = { t1: log.t1, t2: log.t2, envsAfterCreate: log.env.afterCreate.envs, windows: log.env.afterCreate.windows, afterReloadIds: (log.env.afterReload.envs[0] || {}).ids, afterModifyIds: (log.env.afterModify.envs[0] || {}).ids, reqs: (log.net.req || []).filter((r) => r.path.includes("chat")).map((r) => ({ model: r.model, tools: r.tools, bytes: r.bytes })), statuses: (log.net.res || []).map((r) => r.status), consoleTail: log.console.slice(-14) };
console.log(JSON.stringify(brief, null, 1));
