/** MISSION 3.4 chain: compose -> save(engine pathway) -> reload -> model restore+mutate -> revision/continuation. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4";
const T0 = Date.now(); const log = { startedAt: new Date().toISOString(), turns: [], steps: [], console: [] };
const save = () => writeFileSync(`${OUT}/chain2.json`, JSON.stringify(log, null, 1));
const el = () => Date.now() - T0;
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile5", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.console.push("pageerror:" + String(e).slice(0, 130)));
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |Groq failed|no usable/i.test(t)) { log.console.push(t.slice(0, 170)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected"), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { selectedId: st.selectedId, views: st.views.map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 60) })) }; } catch (e) { engine = { error: String(e).slice(0, 80) }; }
  let focus = null; try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch { focus = "err"; }
  const s = (() => { try { return JSON.parse(localStorage.getItem("lelu.environment.snapshots") || "[]"); } catch { return []; } })();
  return { label, focus, host: Boolean(document.querySelector('[data-workspace="lelu-system"]')), domCount: views.length, views, engine, snapshots: (Array.isArray(s) ? s : []).map((x) => ({ id: x.id, name: x.name, views: (x.workspaceSnapshot?.views || []).map((v) => ({ id: v.id, revision: v.revision })) })) };
}, label);
async function settle() {
  for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
async function box() {
  for (let i = 0; i < 4; i++) {
    const b = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); if (!ta) return null; const r = ta.getBoundingClientRect(); return r.width > 40 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; }).catch(() => null);
    if (b) return b;
    const nav = await page.evaluate(() => { const e = document.querySelector('[data-spatial-control="chat"]') || [...document.querySelectorAll("button")].find((b) => /^chat$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null);
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {}); else await page.mouse.click(720, 450).catch(() => {});
    await page.waitForTimeout(1400);
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
      await page.waitForTimeout(1600);
      const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 5000) break;
    }
    log.turns.push({ label, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)) });
    log.steps.push(await snap(label));
  } catch (e) { log.turns.push({ label, error: String(e).slice(0, 130) }); }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle(); log.steps.push(await snap("boot")); save();
await turn("t1-compose", "Use your environment tools: compose an environment titled Field Lab with two surfaces — a notes workspace and a research board.", 70000);
const composed = log.steps.at(-1);
const newIds = (composed?.engine?.views || []).filter((v) => !["view-executive", "view-providers", "view-memory"].includes(v.id));
const target = newIds[0]; log.target = target; save();
if (target) {
  const at = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 14) }; }, target.id);
  if (at) { await page.mouse.click(at.x, at.y); await page.waitForTimeout(900); log.steps.push(await snap("after-pointer-click")); save(); }
  await page.screenshot({ path: `${OUT}/shots/d1-composed.png`, timeout: 15000 }).catch(() => {});
}
const sv = await page.evaluate(async () => {
  const m = await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts");
  const E = m.default; const inst = (E && E.getInstance) ? E.getInstance() : (m.environmentOrchestrationEngine || new E());
  const out = { keys: Object.keys(m), methods: Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).filter((k) => /save|restore|snapshot/i.test(k)) };
  try { out.save = await inst.saveSnapshot({ name: "field-lab-v1", category: "mission" }); } catch (e) { out.err = String(e).slice(0, 140); }
  return out;
}).catch((e) => ({ err: String(e).slice(0, 140) }));
log.saveCall = { keys: sv.keys, methods: sv.methods, result: sv.save ? { id: sv.save.id, name: sv.save.name } : null, err: sv.err }; save();
log.steps.push(await snap("after-engine-save")); save();
const snapId = log.steps.at(-1)?.snapshots?.[0]?.id || sv.save?.id; log.snapshotId = snapId;
log.beforeReload = (log.steps.at(-1)?.engine?.views || []).map((v) => ({ id: v.id, revision: v.revision })); save();
if (snapId && el() < 175000) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }); await settle();
  log.steps.push(await snap("after-reload")); save();
  const gap = 62000 - (Date.now() - T0 - (log.turns[0]?.ms || 0) - 35000);
  if (gap > 0) await page.waitForTimeout(Math.min(gap, 70000));
  await turn("t2-restore-and-continue", `Restore the saved environment snapshot ${snapId}. Then update surface ${target.id} in it so its title becomes "Field Notes v2" and its text becomes "Revision two: the experiment log continues after restoration."`, 80000);
  log.steps.push(await snap("after-restore")); save();
  log.afterRestore = (log.steps.at(-1)?.engine?.views || []).map((v) => ({ id: v.id, revision: v.revision }));
  log.domAfterRestore = (log.steps.at(-1)?.views || []).map((v) => ({ id: v.id, rev: v.rev, visible: v.visible }));
  log.sameIds = JSON.stringify(log.afterRestore.map((v) => v.id)) === JSON.stringify(log.beforeReload.map((v) => v.id)); save();
  await page.screenshot({ path: `${OUT}/shots/d2-restored.png`, timeout: 15000 }).catch(() => {});
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(2000);
  log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), w: Math.round(r.width), h: Math.round(r.height) }; }));
  await page.screenshot({ path: `${OUT}/shots/d3-mobile-restored.png`, timeout: 15000 }).catch(() => {});
}
log.elapsedMs = el(); save(); await ctx.close().catch(() => {});
const g = (l) => log.steps.find((s) => s.label === l);
console.log(JSON.stringify({ ms: log.elapsedMs, turns: log.turns, boot: { f: g("boot")?.focus, d: g("boot")?.domCount }, compose: { f: g("t1-compose")?.focus, host: g("t1-compose")?.host, d: g("t1-compose")?.domCount, eng: g("t1-compose")?.engine?.views.map((v) => v.id + ":r" + v.revision), dom: g("t1-compose")?.views.map((v) => v.id + ":r" + v.rev) }, click: { dom: g("after-pointer-click")?.views.map((v) => v.id + ":sel=" + v.selected), engSel: g("after-pointer-click")?.engine?.selectedId }, saveCall: log.saveCall, snaps: g("after-engine-save")?.snapshots, reload: { f: g("after-reload")?.focus, d: g("after-reload")?.domCount, eng: g("after-reload")?.engine?.views.map((v) => v.id + ":r" + v.revision) }, restore: { f: g("after-restore")?.focus, host: g("after-restore")?.host, d: g("after-restore")?.domCount, eng: log.afterRestore, dom: log.domAfterRestore }, sameIds: log.sameIds, mobile: log.mobile, tail: log.console.slice(-4) }, null, 1));
