/** MISSION 3.3 — after reload: model restores the saved snapshot and continues working on it. */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-3-live-continuity";
const prior = JSON.parse(readFileSync(`${OUT}/continuity-full.json`, "utf8")).checkpoints;
const log = { startedAt: new Date().toISOString(), expected: { idsBeforeReload: prior.idsBeforeReload, snapshotId: prior.snapshotId }, turns: [], console: [], checkpoints: {}, errors: [] };
const save = () => writeFileSync(`${OUT}/restore-continue.json`, JSON.stringify(log, null, 1));
const ctx = await chromium.launchPersistentContext("/tmp/m33-profile2", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |environment\.|Groq failed|no usable/i.test(t)) { log.console.push(t.slice(0, 240)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snapshotState = () => page.evaluate(async () => {
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => ({ id: v.id, title: v.title, kind: v.kind, revision: v.revision, text: (v.text || "").slice(0, 140) })) }; } catch (e) { engine = { error: String(e).slice(0, 140) }; }
  const p = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const snaps = p("lelu.environment.snapshots") || [];
  const revs = p("lelu.environment.revisions") || [];
  return { engine, dom: [...document.querySelectorAll("[data-workspace-view]")].map((e) => ({ id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected") })), snapshots: (Array.isArray(snaps) ? snaps : []).map((s) => ({ id: s.id, name: s.name, views: (s.workspaceSnapshot?.views || []).map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 80) })) })), revisions: (Array.isArray(revs) ? revs : []).slice(-6).map((r) => ({ summary: r.summary, viewsAffected: r.viewsAffected })) };
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
      const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 5000) break;
    }
    log.turns.push({ label, prompt: text, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)), state: await snapshotState().catch((e) => ({ error: String(e).slice(0, 120) })) });
  } catch (e) { log.turns.push({ label, prompt: text, error: String(e).slice(0, 180) }); }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
log.checkpoints.afterFreshBoot = await snapshotState().catch(() => null);
log.checkpoints.persistedSnapshots = (log.checkpoints.afterFreshBoot?.snapshots || []).map((s) => ({ id: s.id, name: s.name, viewCount: (s.views || []).length }));
save();
const snapId = (log.checkpoints.afterFreshBoot?.snapshots || []).find((s) => s.name === "studio-v1")?.id ?? (log.checkpoints.afterFreshBoot?.snapshots || [])[0]?.id;
log.checkpoints.snapshotUsed = snapId; save();
if (snapId) {
  await send("turn4-restore", `Restore the saved environment snapshot ${snapId}.`);
  log.checkpoints.afterRestore = await snapshotState().catch(() => null);
  log.checkpoints.idsAfterRestore = (log.checkpoints.afterRestore?.engine?.views || []).map((v) => v.id);
  log.checkpoints.sameIdsRestored = JSON.stringify(log.checkpoints.idsAfterRestore) === JSON.stringify(log.expected.idsBeforeReload);
  log.checkpoints.restoredRevisions = (log.checkpoints.afterRestore?.engine?.views || []).map((v) => ({ id: v.id, title: v.title, revision: v.revision }));
  await page.screenshot({ path: `${OUT}/shots/r1-restored.png`, timeout: 12000 }).catch(() => {});
  save();
  const board = (log.checkpoints.restoredRevisions || []).find((v) => /Research Board|Research Area|Central/i.test(v.title));
  if (board) {
    await page.waitForTimeout(22000);
    await send("turn5-continue", `In the restored environment, update surface ${board.id} ("${board.title}") with the text "Continuation: sources list added after restore." and title "Research Board v2".`);
    log.checkpoints.afterContinue = await snapshotState().catch(() => null);
    log.checkpoints.continuedRevisions = (log.checkpoints.afterContinue?.engine?.views || []).map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: v.text?.slice(0, 60) }));
    await page.screenshot({ path: `${OUT}/shots/r2-continued.png`, timeout: 12000 }).catch(() => {});
  }
}
log.finishedAt = new Date().toISOString(); save(); await ctx.close().catch(() => {});
console.log(JSON.stringify({ bootViews: (log.checkpoints.afterFreshBoot?.engine?.views || []).map((v) => v.id), persistedSnapshots: log.checkpoints.persistedSnapshots, snapshotUsed: snapId, turns: log.turns.map((t) => ({ label: t.label, ms: t.ms, tools: t.tools, err: t.error })), idsAfterRestore: log.checkpoints.idsAfterRestore, sameIdsRestored: log.checkpoints.sameIdsRestored, restoredRevisions: log.checkpoints.restoredRevisions, continuedRevisions: log.checkpoints.continuedRevisions }, null, 1));
