/** MISSION 3.4 full chain: compose -> click -> mutate(revision) -> save -> reload -> model restore -> re-mount. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4";
const T0 = Date.now();
const log = { startedAt: new Date().toISOString(), turns: [], steps: [], console: [] };
const save = () => writeFileSync(`${OUT}/full-chain.json`, JSON.stringify(log, null, 1));
const left = () => 250000 - (Date.now() - T0);
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile4", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log.console.push("pageerror:" + String(e).slice(0, 130)));
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |Groq failed|no usable/i.test(t)) { log.console.push(t.slice(0, 180)); save(); } });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected"), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { focusId: st.focusId, selectedId: st.selectedId, views: st.views.map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 70) })) }; } catch (e) { engine = { error: String(e).slice(0, 90) }; }
  let focus = null; try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch { focus = "err"; }
  const p = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const snaps = p("lelu.environment.snapshots") || [];
  return { label, focus, host: Boolean(document.querySelector('[data-workspace="lelu-system"]')), domCount: views.length, views, engine, snapshots: (Array.isArray(snaps) ? snaps : []).map((s) => ({ id: s.id, name: s.name, views: (s.workspaceSnapshot?.views || []).map((v) => ({ id: v.id, revision: v.revision })) })) };
}, label);
async function settle() {
  for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1800);
}
async function box() {
  for (let i = 0; i < 4; i++) {
    const b = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); if (!ta) return null; const r = ta.getBoundingClientRect(); return r.width > 40 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; }).catch(() => null);
    if (b) return b;
    const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]') || [...document.querySelectorAll("button")].find((b) => /^chat$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null);
    if (nav) await page.mouse.click(nav.x, nav.y).catch(() => {}); else await page.mouse.click(720, 450).catch(() => {});
    await page.waitForTimeout(1400);
  }
  return null;
}
async function turn(label, text, cap = 55000) {
  const started = Date.now();
  try {
    const b = await box();
    if (!b) throw new Error("no composer");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.type(text, { delay: 2 });
    const mark = log.console.length;
    await page.keyboard.press("Enter");
    let last = "", stable = 0;
    while (Date.now() - started < cap) {
      await page.waitForTimeout(1800);
      const sig = `${log.console.length}|${await page.evaluate(() => document.body.innerText.length).catch(() => 0)}`;
      if (sig === last) stable++; else { stable = 0; last = sig; }
      if (stable >= 3 && Date.now() - started > 4000) break;
    }
    log.turns.push({ label, prompt: text, ms: Date.now() - started, tools: log.console.slice(mark).filter((t) => /Tool /.test(t)), state: await snap(label) });
  } catch (e) { log.turns.push({ label, prompt: text, error: String(e).slice(0, 140) }); }
  save();
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settle();
log.steps.push(await snap("boot")); save();
await turn("t1-compose", "Use your environment tools: compose an environment titled Field Lab with two surfaces — a notes workspace and a research board.");
log.steps.push(await snap("after-compose")); save();
const newViews = (log.steps.at(-1)?.engine?.views || []).filter((v) => !["view-executive", "view-providers", "view-memory"].includes(v.id));
log.newViews = newViews; save();
const target = newViews[0];
if (target) {
  const at = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + 16) }; }, target.id);
  if (at) {
    await page.mouse.click(at.x, at.y).catch(() => {});
    await page.waitForTimeout(700);
    log.steps.push(await snap("after-real-click")); save();
  }
  await page.screenshot({ path: `${OUT}/shots/c1-composed.png`, timeout: 10000 }).catch(() => {});
  if (left() > 140000) { await page.waitForTimeout(12000); await turn("t2-mutate", `Update surface ${target.id} so its title is "Field Notes v2" and its text is "Revision two: the experiment log is recorded here."`); log.steps.push(await snap("after-mutate")); save(); }
  if (left() > 90000) { await page.waitForTimeout(8000); await turn("t3-save", "Save the current environment state as a snapshot named field-lab-v1.", 40000); log.steps.push(await snap("after-save")); save(); }
  const snapId = (log.steps.at(-1)?.snapshots || [])[0]?.id;
  log.snapshotId = snapId; log.idsBeforeReload = (log.steps.at(-1)?.engine?.views || []).map((v) => ({ id: v.id, revision: v.revision })); save();
  if (snapId && left() > 70000) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await settle();
    log.steps.push(await snap("after-reload")); save();
    await turn("t4-restore", `Restore the saved environment snapshot ${snapId}.`, 45000);
    log.steps.push(await snap("after-restore")); save();
    log.idsAfterRestore = (log.steps.at(-1)?.engine?.views || []).map((v) => ({ id: v.id, revision: v.revision }));
    log.sameIds = JSON.stringify(log.idsAfterRestore) === JSON.stringify(log.idsBeforeReload);
    await page.screenshot({ path: `${OUT}/shots/c2-restored.png`, timeout: 10000 }).catch(() => {});
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1800);
    log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), w: Math.round(r.width), h: Math.round(r.height) }; }));
    await page.screenshot({ path: `${OUT}/shots/c3-mobile-restored.png`, timeout: 10000 }).catch(() => {});
  }
}
log.elapsedMs = Date.now() - T0; log.finishedAt = new Date().toISOString(); save(); await ctx.close().catch(() => {});
const g = (l) => log.steps.find((s) => s.label === l);
console.log(JSON.stringify({ elapsedMs: log.elapsedMs, turns: log.turns.map((t) => ({ l: t.label, ms: t.ms, tools: t.tools, err: t.error })), boot: { focus: g("boot")?.focus, dom: g("boot")?.domCount }, compose: { focus: g("after-compose")?.focus, host: g("after-compose")?.host, dom: g("after-compose")?.domCount, engine: g("after-compose")?.engine?.views.map((v) => `${v.id}:r${v.revision}`) }, afterClick: g("after-real-click")?.views.map((v) => `${v.id}:sel=${v.selected}`), mutate: { engine: g("after-mutate")?.engine?.views.map((v) => `${v.id}:r${v.revision}`), dom: g("after-mutate")?.views.map((v) => `${v.id}:r${v.rev}`) }, snapshotId: log.snapshotId, afterReload: { focus: g("after-reload")?.focus, dom: g("after-reload")?.domCount, engine: g("after-reload")?.engine?.views.map((v) => v.id) }, afterRestore: { focus: g("after-restore")?.focus, host: g("after-restore")?.host, dom: g("after-restore")?.domCount, engine: g("after-restore")?.engine?.views.map((v) => `${v.id}:r${v.revision}`), domDetail: g("after-restore")?.views.map((v) => `${v.id}:r${v.rev}:${v.visible}`) }, sameIds: log.sameIds, mobile: log.mobile, tail: log.console.slice(-5) }, null, 1));
