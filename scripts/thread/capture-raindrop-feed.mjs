import { launch, desktop } from "../evolution/harness.mjs";
const OUT = process.env.FRAMES ?? "docs/missions/mission-44-9/feedframes";
import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const b = await launch(); const ctx = await desktop(b); const page = await ctx.newPage();
async function boot() { await page.goto("http://127.0.0.1:5173/"); for (let i=0;i<60;i++){ if (await page.locator("[data-lelu-signin-gate]").count()) await page.evaluate(()=>{const x=[...document.querySelectorAll("[data-lelu-signin-gate] button")];(x.find(e=>/continue/i.test(e.textContent||""))??x.at(-1))?.click();}); if (await page.locator("[data-lelu-home]").count()) break; await page.waitForTimeout(500);} await page.waitForTimeout(2000); }
async function openThread() { await page.waitForTimeout(1500); if (await page.locator("[data-raindrop-feed]").count()) { await page.waitForTimeout(1200); return; } await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))); await page.waitForSelector("[aria-label='Chat Universe']"); if (!(await page.locator("[data-lelu-universe-window]").count())) await page.click('button[aria-label="Open Rain feed demo"]'); await page.waitForTimeout(900); await page.click('[data-lelu-universe-window] [data-lelu-stage="thread"]'); await page.waitForSelector("[data-raindrop-feed]"); await page.waitForTimeout(1500); }
await boot();
const id = await page.evaluate(async () => {
  const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const T = await import("/src/core/thread/ThreadObjects.ts");
  const c = MC.create("Rain feed demo"); const t0 = Date.now() - 60000;
  for (let i = 1; i <= 6; i++) MC.addMessage(c.id, { id: `rf-${i}`, role: i % 2 ? "user" : "assistant", text: `Drop ${i}: ${i % 2 ? "a question about knowledge graphs" : "LÉLU answers with her map"}`, timestamp: t0 + i * 1000, source: "local" });
  T.setVariant(c.id, "raindrop");
  return c.id;
});
await openThread();
const state = () => page.evaluate(() => { const f = document.querySelector("[data-raindrop-feed]"); return { total: f.dataset.feedTotal, start: f.dataset.feedStart, end: f.dataset.feedEnd, following: f.dataset.following, places: [...document.querySelectorAll("[data-drop]")].map(d => `${d.dataset.drop}:${d.dataset.place}`) }; });
const shots = [];
const snap = async (name) => { const p = `${OUT}/${String(shots.length).padStart(2,"0")}-${name}.png`; await page.screenshot({ path: p, clip: { x: 0, y: 180, width: 1440, height: 600 } }); shots.push(p); };
await snap("before"); const before = await state();
await page.evaluate(async (cid) => { const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); MC.addMessage(cid, { id: "rf-7", role: "user", text: "Drop 7: a NEW message arrives", timestamp: Date.now(), source: "local" }); }, id);
for (const ms of [60, 250, 450, 700, 1000, 1500]) { await page.waitForTimeout(ms === 60 ? 60 : 200); await snap(`arrive-${ms}`); }
const afterArrive = await state();
// scrub back with the side scrollbar
await page.locator("[data-feed-scroll]").fill("3");
for (let i = 0; i < 4; i++) { await page.waitForTimeout(280); await snap(`scrub-back-${i}`); }
const afterScrub = await state();
await page.reload(); await boot(); await openThread();
const afterReload = await state();
await snap("after-reload");
console.log(JSON.stringify({ before, afterArrive, afterScrub, afterReload }));
await b.close();
