/** MISSION 3.3 — full live chain in ONE session: create → mutate → save → reload → restore → continue. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-3-live-continuity";
const log = { startedAt: new Date().toISOString(), turns: [], console: [], errors: [], checkpoints: {} };
const save = () => writeFileSync(`${OUT}/continuity-full.json`, JSON.stringify(log, null, 1));
const T0 = Date.now();
const ctx = await chromium.launchPersistentContext("/tmp/m33-profile2", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => { log.errors.push(String(e).slice(0, 200)); });
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |environment\.|Groq failed|no usable/i.test(t)) { log.console.push(t.slice(0, 240)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snapshotState = () => page.evaluate(async () => {
  const dom = [...document.querySelectorAll("[data-workspace-view]")].map((e) => ({ id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected"), kind: e.getAttribute("data-kind") }));
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => ({ id: v.id, title: v.title, kind: v.kind, revision: v.revision, text: (v.text || "").slice(0, 120) })) }; } catch (e) { engine = { error: String(e).slice(0, 120) }; }
  const p = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const snaps = p("lelu.environment.snapshots") || [];
  const revs = p("lelu.environment.revisions") || [];
  return { dom, engine, snapshots: (Array.isArray(snaps) ? snaps : []).map((s) => ({ id: s.id, name: s.name, views: (s.workspaceSnapshot?.views || []).map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 80) })) })), revisions: (Array.isArray(revs) ? revs : []).slice(-8).map((r) => ({ summary: r.summary, viewsAffected: r.viewsAffected })) };
});
async function settle() {
  for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
async function box() {
  for (let i = 0; i < 3; i++) {
    const b = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); if (!ta) return null; const r = ta.getBoundingClientRect(); return r.width > 40 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; }).catch(() => null);
    if (b) return b;
    const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null);
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {});
    await page.waitForTimeout(1200);
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
      const sig = `${log.console.length}|${(await page.evaluate(() => document.body.innerText.length).catch(() => 0))}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 5000) break;
    }
    const st = await snapshotState().catch((e) => ({ error: String(e).slice(0, 150) }));
    log.turns.push({ label, prompt: text, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)), state: st });
  } catch (e) {
    log.turns.push({ label, prompt: text, ms: Date.now() - started, error: String(e).slice(0, 200) });
  }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
log.checkpoints.boot = await snapshotState().catch(() => null); save();
await send("turn1-create", "Create a studio environment titled Research Studio with three surfaces: a central workspace, a research area, and a presentation area.");
const created = (log.turns.at(-1)?.state.engine?.views || []).filter((v) => !["view-executive", "view-providers", "view-memory"].includes(v.id));
log.checkpoints.created = created; save();
const target = created[0];
await page.screenshot({ path: `${OUT}/shots/f-t1-create.png`, timeout: 12000 }).catch(() => {});
if (target) {
  const before = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); const r = e && e.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; }, target.id).catch(() => null);
  log.checkpoints.pointerBefore = before; save();
  if (before) {
    await page.mouse.click(before.x + Math.min(60, before.w / 2), before.y + 18).catch(() => {});
    await page.waitForTimeout(500);
    log.checkpoints.pointerClickSelected = await page.evaluate((id) => document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected"), target.id).catch(() => null);
    log.checkpoints.afterRealClick = await snapshotState().catch(() => null); save();
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200);
  log.checkpoints.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), w: Math.round(r.width), h: Math.round(r.height) }; })).catch(() => []);
  await page.screenshot({ path: `${OUT}/shots/f-t1-mobile.png`, timeout: 12000 }).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1200); save();
  await page.waitForTimeout(22000);
  await send("turn2-mutate", `Change the surface ${target.id} ("${target.title}") so its text reads "Research Board: sources, notes and open questions." and its title reads "Research Board".`);
  await page.screenshot({ path: `${OUT}/shots/f-t2-mutate.png`, timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(22000);
  await send("turn3-save", "Save the current environment state as a snapshot named studio-v1.");
  log.checkpoints.afterSave = await snapshotState().catch(() => null); save();
  await page.screenshot({ path: `${OUT}/shots/f-t3-save.png`, timeout: 12000 }).catch(() => {});
  const snapId = (log.checkpoints.afterSave?.snapshots || [])[0]?.id;
  log.checkpoints.snapshotId = snapId; log.checkpoints.idsBeforeReload = (log.checkpoints.afterSave?.engine?.views || []).map((v) => v.id); save();
  if (snapId && Date.now() - T0 < 200000) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await settle();
    log.checkpoints.afterReload = await snapshotState().catch(() => null);
    log.checkpoints.viewsAfterReload = (log.checkpoints.afterReload?.engine?.views || []).map((v) => v.id); save();
    await page.screenshot({ path: `${OUT}/shots/f-t4-reloaded.png`, timeout: 12000 }).catch(() => {});
    await send("turn4-restore", `Restore the saved environment snapshot ${snapId}.`);
    log.checkpoints.afterRestore = await snapshotState().catch(() => null);
    log.checkpoints.idsAfterRestore = (log.checkpoints.afterRestore?.engine?.views || []).map((v) => v.id);
    log.checkpoints.sameIdsRestored = JSON.stringify(log.checkpoints.idsAfterRestore) === JSON.stringify(log.checkpoints.idsBeforeReload); save();
    await page.screenshot({ path: `${OUT}/shots/f-t5-restored.png`, timeout: 12000 }).catch(() => {});
  }
}
log.elapsedMs = Date.now() - T0; log.finishedAt = new Date().toISOString(); save();
await ctx.close().catch(() => {});
console.log(JSON.stringify({ turns: log.turns.map((t) => ({ label: t.label, ms: t.ms, tools: t.tools, err: t.error })), created: log.checkpoints.created, pointerClickSelected: log.checkpoints.pointerClickSelected, mobile: log.checkpoints.mobile, snapshotId: log.checkpoints.snapshotId, idsBeforeReload: log.checkpoints.idsBeforeReload, viewsAfterReload: log.checkpoints.viewsAfterReload, idsAfterRestore: log.checkpoints.idsAfterRestore, sameIdsRestored: log.checkpoints.sameIdsRestored, revisions: log.checkpoints.afterRestore?.revisions, elapsedMs: log.elapsedMs }, null, 1));
