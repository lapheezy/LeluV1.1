/** Production-build timings in a real browser (software GL in this sandbox: pessimistic). */
import { launch, desktop, iphone, boot, seed, openUniverse, openSeededChat } from "./harness.mjs";
process.env.LELU_BASE = process.env.LELU_BASE || "http://127.0.0.1:4173/";
const browser = await launch();
// A returning user's device: the conversation is already in storage. Captured
// from the dev app after seeding through the real store, restored before boot.
let stored = {};
{
  const ctx = await desktop(browser); const page = await ctx.newPage();
  process.env.LELU_BASE_SAVED = process.env.LELU_BASE;
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await seed(page);
  await page.evaluate(async () => (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance().flush());
  stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /chat|conversation|lelu/i.test(k)).map((k) => [k, localStorage.getItem(k)])));
  await ctx.close();
}
for (const [label, mk] of [["desktop", () => desktop(browser)], ["iphone", () => iphone(browser)]]) {
  const ctx = await mk();
  await ctx.addInitScript((entries) => { if (!sessionStorage.getItem("seeded")) { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } }, stored);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(process.env.LELU_BASE, { waitUntil: "domcontentloaded" });
  const dcl = Date.now() - t0;
  await page.waitForSelector("[data-lelu-home], [data-lelu-signin-gate]", { timeout: 30000 });
  const home = Date.now() - t0;
  await boot(page); await openUniverse(page);
  let t = Date.now(); await openSeededChat(page); await page.waitForSelector(".lst-root"); const chatOpen = Date.now() - t;
  const stageMs = {};
  for (const [s, sel] of [["cinematic", ".lst-cine-chapter"], ["board", ".lbd-card"], ["spatial", "[data-lelu-env-view=\"scenes\"]"], ["gallery", ".lst-tile img"], ["document", "[data-lelu-env-view=\"document\"]"], ["research", "[data-lelu-env-view=\"research\"]"], ["data", "[data-lelu-env-view=\"data\"]"]]) {
    t = Date.now();
    await page.locator(`[data-lelu-stage="${s}"]`).first().click();
    await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {});
    stageMs[s] = Date.now() - t;
    await page.waitForTimeout(600);
  }
  // Frame rate while the steward animates a layout change (8 windows).
  await page.locator('[data-lelu-stage="conversation"]').first().click();
  const fps = await page.evaluate(() => new Promise((res) => { let f = 0; const s = performance.now(); const tick = () => { f++; if (performance.now() - s < 2000) requestAnimationFrame(tick); else res(Math.round(f / ((performance.now() - s) / 1000))); }; requestAnimationFrame(tick); }));
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
  console.log(JSON.stringify({ label, domContentLoadedMs: dcl, homeVisibleMs: home, openChatWindowMs: chatOpen, stageSwitchMs: stageMs, idleFps: fps, jsHeapMB: mem }));
  await ctx.close();
}
await browser.close();
