/** MISSION 3.4: one directive compose turn, with one retry if the model answers in prose. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4";
const log = { startedAt: new Date().toISOString(), turns: [], steps: [], console: [] };
const save = () => writeFileSync(`${OUT}/retry-compose.json`, JSON.stringify(log, null, 1));
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile3", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.console.push("pageerror:" + String(e).slice(0, 140)));
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] (Tool|Trying)|Groq failed|no usable|offline/i.test(t)) { log.console.push(t.slice(0, 190)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => ({ id: v.id, title: v.title, revision: v.revision })) }; } catch (e) { engine = { error: String(e).slice(0, 100) }; }
  let focus = null;
  try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch { focus = "err"; }
  return { label, focus, host: Boolean(document.querySelector('[data-workspace="lelu-system"]')), domCount: views.length, views, engine };
}, label);
async function settle() {
  for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
async function box() {
  for (let i = 0; i < 4; i++) {
    const b = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); if (!ta) return null; const r = ta.getBoundingClientRect(); return r.width > 40 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; }).catch(() => null);
    if (b) return b;
    const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]') || [...document.querySelectorAll("button")].find((b) => /^chat$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null);
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {}); else await page.mouse.click(720, 450).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return null;
}
async function turn(label, text) {
  const started = Date.now();
  const b = await box();
  if (!b) { log.turns.push({ label, error: "no composer" }); save(); return false; }
  await page.mouse.click(b.x, b.y);
  await page.keyboard.type(text, { delay: 2 });
  const mark = log.console.length;
  await page.keyboard.press("Enter");
  let last = "", stable = 0;
  while (Date.now() - started < 65000) {
    await page.waitForTimeout(2000);
    const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
    if (sig === last) stable++; else { stable = 0; last = sig; }
    if (stable >= 3 && Date.now() - started > 4000) break;
  }
  const tools = log.console.slice(mark).filter((t) => /Tool /.test(t));
  log.turns.push({ label, prompt: text, ms: Date.now() - started, tools, state: await snap(label) });
  save();
  return tools.length > 0;
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
log.steps.push(await snap("boot")); save();
let ok = await turn("compose-1", "Use your environment tools: compose a new environment titled Field Lab with two surfaces — a notes workspace and a research board.");
if (!ok) { log.retry = true; save(); await page.waitForTimeout(25000); ok = await turn("compose-2", "Call environment_compose now with title Field Lab and two surfaces."); }
log.steps.push(await snap("after-compose")); save();
await page.screenshot({ path: `${OUT}/shots/r1-compose.png`, timeout: 12000 }).catch(() => {});
const st = log.steps.find((s) => s.label === "after-compose");
const target = (st?.views || [])[0];
if (target) {
  const at = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + 16) }; }, target.id);
  if (at) { await page.mouse.click(at.x, at.y).catch(() => {}); await page.waitForTimeout(700); log.steps.push(await snap("after-click")); save(); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500);
  log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), w: Math.round(r.width), h: Math.round(r.height) }; }));
  await page.screenshot({ path: `${OUT}/shots/r2-mobile.png`, timeout: 12000 }).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1200); save();
}
log.finishedAt = new Date().toISOString(); save(); await ctx.close().catch(() => {});
console.log(JSON.stringify({ turns: log.turns.map((t) => ({ l: t.label, ms: t.ms, tools: t.tools, err: t.error })), boot: log.steps.find((s) => s.label === "boot") && { focus: log.steps[0].focus, dom: log.steps[0].domCount }, afterCompose: { focus: st?.focus, host: st?.host, dom: st?.domCount, views: st?.views, engine: st?.engine?.views }, afterClick: log.steps.find((s) => s.label === "after-click")?.views, mobile: log.mobile, tail: log.console.slice(-8) }, null, 1));
