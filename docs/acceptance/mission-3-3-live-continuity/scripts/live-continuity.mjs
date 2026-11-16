/**
 * MISSION 3.3 — live model continuity.
 * Drives the REAL chat with a persistent Chromium profile, so the app's own
 * KvStore (localStorage `lelu.*`) survives between script runs exactly as a
 * reload does. Every tool call recorded here was selected by the model.
 *
 * phase "a": turn 1 compose -> turn 2 mutate the same surface -> turn 3 save_state
 * phase "b": fresh app boot -> turn 4 restore_state -> verify same view ids
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-3-live-continuity";
const FILE = `${OUT}/live-${process.argv[2]}.json`;
const PHASE = process.argv[2];
const MODEL = process.env.M32_MODEL ?? "openai/gpt-oss-20b";
const log = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { phase: PHASE, startedAt: new Date().toISOString(), turns: [], console: [], errors: [], states: [] };
const save = () => writeFileSync(FILE, JSON.stringify(log, null, 1));
const ctx = await chromium.launchPersistentContext("/tmp/m33-profile", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => { log.errors.push("page:" + String(e).slice(0, 220)); save(); });
page.on("console", (m) => { const t = m.text(); if (/\[ProviderResolver\] Tool |environment\.|Groq failed|no usable|offline/i.test(t)) { log.console.push(`${Date.now() % 1000000}:${t}`.slice(0, 300)); save(); } });
await page.addInitScript((m) => { globalThis.__LELU_GROQ_MODEL__ = m; }, MODEL);
const state = () => page.evaluate(async () => {
  const dom = [...document.querySelectorAll("[data-workspace-view]")].map((e) => ({ id: e.getAttribute("data-workspace-view"), kind: e.getAttribute("data-kind"), revision: Number(e.getAttribute("data-revision")), selected: e.getAttribute("data-selected"), text: (e.innerText || "").replace(/\s+/g, " ").slice(0, 160) }));
  let engine = null;
  try {
    const m = await import("/src/core/workspace/WorkspaceEngine.ts");
    const st = m.default.getInstance().getState();
    engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => ({ id: v.id, title: v.title, kind: v.kind, revision: v.revision, text: (v.text || "").slice(0, 140) })) };
  } catch (e) { engine = { error: String(e).slice(0, 160) }; }
  const parse = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const snaps = parse("lelu.environment.snapshots") || [];
  const revs = parse("lelu.environment.revisions") || [];
  return {
    dom,
    engine,
    snapshots: (Array.isArray(snaps) ? snaps : []).map((s) => ({ id: s.id, name: s.name, layout: s.workspaceSnapshot?.layout, views: (s.workspaceSnapshot?.views || []).map((v) => ({ id: v.id, title: v.title, revision: v.revision, text: (v.text || "").slice(0, 100) })) })),
    revisions: (Array.isArray(revs) ? revs : []).slice(-6).map((r) => ({ summary: r.summary, viewsAffected: r.viewsAffected })),
    chatTail: (document.body.innerText || "").slice(-500),
  };
});
async function settleGate() {
  for (let i = 0; i < 90; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
  await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20000 }).catch(() => {});
  await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
async function openChat() {
  if (await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="Chat Universe"]')))) return;
  const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  await page.mouse.click(nav.x, nav.y);
  await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 25000 });
  await page.waitForTimeout(900);
}
async function send(label, text) {
  await openChat();
  const box = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); const r = ta.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  await page.mouse.click(box.x, box.y);
  await page.keyboard.type(text, { delay: 2 });
  const marked = log.console.length;
  await page.keyboard.press("Enter");
  const t0 = Date.now(); let last = "", stable = 0;
  while (Date.now() - t0 < 75000) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ w: document.querySelectorAll("[data-workspace-view]").length, body: (document.body.innerText || "").slice(-600) }));
    const sig = `${s.w}|${s.body.length}|${log.console.length}`;
    if (sig === last) stable++; else { stable = 0; last = sig; }
    if (stable >= 3 && Date.now() - t0 > 6000) break;
  }
  const turn = { label, prompt: text, ms: Date.now() - t0, toolEvents: log.console.slice(marked), state: await state() };
  log.turns.push(turn); save();
  return turn;
}
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await settleGate();
log.states.push({ at: "after-boot", ...(await state()) }); save();
if (PHASE === "a") {
  await send("turn1-create", "Create a studio environment titled Research Studio with three surfaces: a central workspace, a research area, and a presentation area.");
  await page.screenshot({ path: `${OUT}/shots/t1-create.png`, timeout: 12000 }).catch(() => {});
  const first = (log.turns[0]?.state.engine?.views || [])[0] || (log.turns[0]?.state.dom || [])[0];
  const viewId = first?.id;
  log.targetViewId = viewId; save();
  // real pointer drag on the environment window's title area -> intended state change
  if (viewId) {
    const before = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }, viewId);
    if (before) {
      await page.mouse.move(before.x + 300, before.y + 14);
      await page.mouse.down();
      await page.mouse.move(before.x + 380, before.y + 60, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const after = await page.evaluate((id) => { const e = document.querySelector(`[data-workspace-view="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }, viewId);
      await page.waitForTimeout(500);
      const selected = await page.evaluate((id) => document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected") ?? null, viewId);
      log.pointer = { viewId, before, after, moved: Boolean(before && after && (before.x !== after.x || before.y !== after.y)), selectedAfterRealClick: selected }; save();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500);
  log.mobile = await page.evaluate(() => [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), w: Math.round(r.width), h: Math.round(r.height) }; }));
  await page.screenshot({ path: `${OUT}/shots/t1-mobile-390x844.png`, timeout: 12000 }).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1200); save();
  await page.waitForTimeout(30000);
  if (viewId) await send("turn2-mutate", `Update the surface with id ${viewId}: set its title to "Research Board" and its text to "Research Board: sources, notes and open questions."`);
  await page.screenshot({ path: `${OUT}/shots/t2-mutate.png`, timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(25000);
  await send("turn3-save", "Save the current environment state as a snapshot named studio-v1.");
  await page.screenshot({ path: `${OUT}/shots/t3-save.png`, timeout: 12000 }).catch(() => {});
} else {
  const snap = (await state()).snapshots[0];
  log.restoreTarget = snap ? snap.id : null; save();
  if (snap) await send("turn4-restore", `Restore the saved environment snapshot ${snap.id}.`);
  await page.screenshot({ path: `${OUT}/shots/t4-restore.png`, timeout: 12000 }).catch(() => {});
}
log.finishedAt = new Date().toISOString(); save();
await ctx.close().catch(() => {});
const summary = { phase: PHASE, turns: log.turns.map((t) => ({ label: t.label, ms: t.ms, tools: t.toolEvents.filter((e) => /Tool /.test(e)), windows: (t.state.windows || []).map((w) => w.id) })), finalViews: log.turns.at(-1)?.state.engine?.views, finalDom: log.turns.at(-1)?.state.dom, layouts: log.turns.at(-1)?.state.engine?.layout, snapshots: log.turns.at(-1)?.state.snapshots, revisions: log.turns.at(-1)?.state.revisions.slice(-4), pointer: log.pointer, mobile: log.mobile, keys: log.turns.at(-1)?.state.keys };
console.log(JSON.stringify(summary, null, 1));
