/** MISSION 3.4 probe: is the surface layer reachable through the real nav control? */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-4";
const log = { startedAt: new Date().toISOString(), steps: [], console: [] };
const save = () => writeFileSync(`${OUT}/probe-system-scene.json`, JSON.stringify(log, null, 1));
const ctx = await chromium.launchPersistentContext("/tmp/m34-profile", { headless: true, viewport: { width: 1440, height: 900 }, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => { const t = m.text(); if (/Tool |interfaceFocus|workspace|mount/i.test(t)) log.console.push(t.slice(0, 200)); });
await page.addInitScript(() => { globalThis.__LELU_GROQ_MODEL__ = "openai/gpt-oss-20b"; });
const snap = (label) => page.evaluate(async (label) => {
  const views = [...document.querySelectorAll("[data-workspace-view]")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-workspace-view"), rev: Number(e.getAttribute("data-revision")), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, selected: e.getAttribute("data-selected") }; });
  let engine = null;
  try { const m = await import("/src/core/workspace/WorkspaceEngine.ts"); const st = m.default.getInstance().getState(); engine = { layout: st.layout, focusId: st.focusId, views: st.views.map((v) => v.id) }; } catch (e) { engine = { error: String(e).slice(0, 100) }; }
  let focus = null;
  try { const v = await import("/src/core/visual/VisualEngine.ts"); focus = v.default.getInstance().getState().interfaceFocus; } catch (e) { focus = "err:" + String(e).slice(0, 60); }
  return { label, focus, workspaceHost: Boolean(document.querySelector("[data-workspace=\"lelu-system\"]")), cosmosRendered: (() => { const el = document.querySelector("[data-lelu-surface=\"chat\"], [role=\"dialog\"][aria-label=\"Chat Universe\"]"); return Boolean(el); })(), domViewCount: views.length, views, engine };
}, label);
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 80; i++) { const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent || "")) : false; }).catch(() => false); if (ok) break; await page.waitForTimeout(400); }
await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...((g && g.querySelectorAll("button")) || [])].find((b) => /without an account/i.test(b.textContent || ""))?.click(); }).catch(() => {});
await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
await page.waitForSelector("[data-lelu-home]", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2500);
log.steps.push(await snap("boot")); save();
// find the real control that toggles the System scene, and click it with real pointer input
const controls = await page.evaluate(() => [...document.querySelectorAll("button, [role=button], [data-spatial-control]")].map((e) => { const r = e.getBoundingClientRect(); return { label: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 60), control: e.getAttribute("data-spatial-control"), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) }; }).filter((c) => c.w > 0));
log.controls = controls.slice(0, 40); save();
const pick = controls.find((c) => /system|visual|core|environment/i.test(c.label + " " + (c.control ?? "")));
log.pickedControl = pick; save();
if (pick) { await page.mouse.click(pick.x, pick.y); await page.waitForTimeout(2500); }
log.steps.push(await snap("after-system-click")); save();
await page.screenshot({ path: `${OUT}/shots/probe-system.png`, timeout: 12000 }).catch(() => {});
log.finishedAt = new Date().toISOString(); save(); await ctx.close().catch(() => {});
console.log(JSON.stringify({ controls: log.controls.filter((c) => /system|visual|core|environment|chat|home/i.test(c.label + " " + (c.control ?? ""))).slice(0, 12), picked: pick, steps: log.steps.map((s) => ({ label: s.label, focus: s.focus, host: s.workspaceHost, domViewCount: s.domViewCount, engineCount: (s.engine?.views || []).length, views: s.views.slice(0, 4) })) }, null, 1));
