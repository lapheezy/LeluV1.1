/** MISSION 3.4: does the model's compose actually mount visible surfaces, and does mutate bump the revision? */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4";
const log = { startedAt: new Date().toISOString(), steps: [], turns: [], console: [] };
const save = () => writeFileSync(`${OUT}/verify-mount.json`, JSON.stringify(log, null, 1));
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile2", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.console.push("pageerror:" + String(e).slice(0, 160)));
page.on("console", (m) => { const t = m.text(); if (/Tool |interfaceFocus|genesis-show-surface/i.test(t)) { log.console.push(t.slice(0, 200)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected"), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 80) })) }; } catch (e) { engine = { error: String(e).slice(0, 120) }; }
  let focus = null;
  try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch (e) { focus = "err"; }
  return { label, focus, systemHost: Boolean(document.querySelector('[data-workspace="lelu-system"]')), domCount: views.length, views, engine };
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
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {});
    else await page.mouse.click(720, 450).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return null;
}
async function send(label, text) {
  const started = Date.now();
  try {
    const b = await box();
    if (!b) throw new Error("composer not found");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.type(text, { delay: 2 });
    const mark = log.console.length;
    await page.keyboard.press("Enter");
    let last = "", stable = 0;
    while (Date.now() - started < 70000) {
      await page.waitForTimeout(2000);
      const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 5000) break;
    }
    log.turns.push({ label, prompt: text, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)), state: await snap(label) });
  } catch (e) { log.turns.push({ label, prompt: text, error: String(e).slice(0, 160) }); }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
log.steps.push(await snap("boot")); save();
await send("turn1-compose", "Create an environment titled Field Lab with two surfaces: a workspace for notes and a research board.");
log.steps.push(await snap("after-compose")); save();
await page.screenshot({ path: `${OUT}/shots/v1-after-compose.png`, timeout: 12000 }).catch(() => {});
const target = (log.turns.at(-1)?.state.views || [])[0] || (log.turns.at(-1)?.state.engine?.views || []).find((v) => /Field|workspace|research/i.test(v.title));
log.target = target; save();
if (target) {
  // real pointer click on the mounted surface
  const clickAt = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + 16) }; }, target.id);
  log.clickAt = clickAt; save();
  if (clickAt) {
    await page.mouse.click(clickAt.x, clickAt.y).catch(() => {});
    await page.waitForTimeout(700);
    log.steps.push(await snap("after-pointer-click")); save();
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500);
  log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), w: Math.round(r.width), h: Math.round(r.height) }; }));
  await page.screenshot({ path: `${OUT}/shots/v2-mobile.png`, timeout: 12000 }).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1200); save();
  await page.waitForTimeout(20000);
  await send("turn2-mutate", `Update surface ${target.id} so its title is "Field Notes v2" and its text is "Revision two: the board now carries the experiment log."`);
  log.steps.push(await snap("after-mutate")); save();
  await page.screenshot({ path: `${OUT}/shots/v3-after-mutate.png`, timeout: 12000 }).catch(() => {});
}
log.finishedAt = new Date().toISOString(); save(); await ctx.close().catch(() => {});
const s = (l) => { const x = log.steps.find((k) => k.label === l); return x ? { focus: x.focus, host: x.systemHost, dom: x.domCount, engine: (x.engine?.views || []).map((v) => `${v.id}:r${v.revision}`) } : null; };
console.log(JSON.stringify({ boot: s("boot"), afterCompose: s("after-compose"), afterClick: s("after-pointer-click"), afterMutate: s("after-mutate"), target, clickAt: log.clickAt, turns: log.turns.map((t) => ({ label: t.label, ms: t.ms, tools: t.tools, err: t.error })), domDetail: (log.steps.find((k) => k.label === "after-compose")?.views || []), mobile: log.mobile, mutateDetail: (log.steps.find((k) => k.label === "after-mutate")?.views || []) }, null, 1));
