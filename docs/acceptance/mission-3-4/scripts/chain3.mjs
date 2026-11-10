/** MISSION 3.4: fresh boot -> model restore_state -> render -> model mutate (revision + continuation). */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4"; const T0 = Date.now();
const log = { startedAt: new Date().toISOString(), turns: [], steps: [], console: [] };
const save = () => writeFileSync(`${OUT}/chain3.json`, JSON.stringify(log, null, 1));
const el = () => Date.now() - T0;
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile5", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.console.push("pageerror:" + String(e).slice(0, 120)));
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |Groq failed|no usable/i.test(t)) { log.console.push(t.slice(0, 170)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), title: (e.querySelector("[data-surface-title]")?.textContent || e.textContent || "").trim().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { views: st.views.map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 70) })) }; } catch (e) { engine = { error: String(e).slice(0, 80) }; }
  let focus = null; try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch { focus = "err"; }
  return { label, focus, host: Boolean(document.querySelector('[data-workspace="lelu-system"]')), domCount: views.length, views, engine };
}, label);
async function settle() {
  for (let i = 0; i < 70; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 12000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function box() {
  for (let i = 0; i < 4; i++) {
    const b = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); if (!ta) return null; const r = ta.getBoundingClientRect(); return r.width > 40 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; }).catch(() => null);
    if (b) return b;
    const nav = await page.evaluate(() => { const e = document.querySelector('[data-spatial-control="chat"]') || [...document.querySelectorAll("button")].find((b) => /^chat$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null);
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {}); else await page.mouse.click(720, 450).catch(() => {});
    await page.waitForTimeout(1300);
  }
  return null;
}
async function turn(label, text, cap) {
  const started = Date.now();
  try {
    const b = await box(); if (!b) throw new Error("no composer");
    await page.mouse.click(b.x, b.y); await page.keyboard.type(text, { delay: 2 });
    const mark = log.console.length; await page.keyboard.press("Enter");
    let last = "", stable = 0;
    while (Date.now() - started < cap) {
      await page.waitForTimeout(1500);
      const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 4000) break;
    }
    log.turns.push({ label, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)) });
    log.steps.push(await snap(label));
  } catch (e) { log.turns.push({ label, error: String(e).slice(0, 130) }); }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 90000 });
await settle();
if (!log.console.length) await page.waitForTimeout(1500);
log.steps.push(await snap("fresh-boot")); save();
const SNAP = "snapshot-mw8ddug9";
await turn("t1-restore", `Call restore_state with snapshotId ${SNAP}. Restore that saved environment now.`, 60000);
log.steps.push(await snap("after-restore")); save();
const r = log.steps.at(-1); log.restore = { focus: r.focus, host: r.host, dom: r.domCount, engine: r.engine?.views, domViews: r.views };
await page.screenshot({ path: `${OUT}/shots/e1-restored.png`, timeout: 15000 }).catch(() => {});
const target = (r.engine?.views || []).find((v) => !["view-executive", "view-providers", "view-memory"].includes(v.id));
log.target = target; save();
if (target && el() < 210000) {
  const gap = 58000 - (el() - (log.turns[0]?.ms || 0) - 25000); if (gap > 3000) await page.waitForTimeout(Math.min(gap, 60000));
  await turn("t2-continue", `Update surface ${target.id} in the restored environment: set its title to "Field Notes v2" and its text to "Revision two: the experiment log continues after restoration."`, 60000);
  log.steps.push(await snap("after-mutate")); save();
  const m = log.steps.at(-1);
  log.mutate = { sameId: (m.engine?.views || []).some((v) => v.id === target.id), before: target.revision, engine: (m.engine?.views || []).map((v) => v.id + ":r" + v.revision), dom: (m.views || []).map((v) => v.id + ":r" + v.rev), title: (m.engine?.views || []).find((v) => v.id === target.id)?.title };
  await page.screenshot({ path: `${OUT}/shots/e2-mutated.png`, timeout: 15000 }).catch(() => {});
}
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(2200);
log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), w: Math.round(r.width), h: Math.round(r.height) }; }));
await page.screenshot({ path: `${OUT}/shots/e3-mobile.png`, timeout: 15000 }).catch(() => {});
log.elapsedMs = el(); save(); await ctx.close().catch(() => {});
const g = (l) => log.steps.find((s) => s.label === l);
console.log(JSON.stringify({ ms: log.elapsedMs, turns: log.turns, boot: { f: g("fresh-boot")?.focus, d: g("fresh-boot")?.domCount, eng: g("fresh-boot")?.engine?.views?.map((v) => v.id) }, restore: { f: g("after-restore")?.focus, host: g("after-restore")?.host, d: g("after-restore")?.domCount, eng: g("after-restore")?.engine?.views?.map((v) => v.id + ":r" + v.revision + ":" + v.title), dom: g("after-restore")?.views?.map((v) => v.id + ":r" + v.rev + ":" + v.visible) }, mutate: log.mutate, mobile: log.mobile, tail: log.console.slice(-3) }, null, 1));
