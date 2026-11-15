import { launch, desktop } from "./harness.mjs";
const browser = await launch();
const fpsOf = (page) => page.evaluate(() => new Promise((res) => { let f = 0; const s = performance.now(); const tick = () => { f++; if (performance.now() - s < 3000) requestAnimationFrame(tick); else res(Math.round(f / ((performance.now() - s) / 1000))); }; requestAnimationFrame(tick); }));
for (const base of process.argv.slice(2)) {
  const ctx = await desktop(browser); const page = await ctx.newPage();
  await page.goto(base); await page.waitForTimeout(6000);
  const gate = page.locator("[data-lelu-signin-gate] button", { hasText: /continue/i });
  if (await gate.count()) { await gate.first().click(); await page.waitForTimeout(1500); }
  const home = await fpsOf(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))); await page.waitForTimeout(2500);
  const universe = await fpsOf(page);
  await page.locator(".lcu-card").first().click().catch(() => {}); await page.waitForTimeout(3000);
  const chat = await fpsOf(page);
  console.log(base, JSON.stringify({ home, universe, chatWindow: chat, canvases: await page.locator("canvas").count() }));
  await ctx.close();
}
await browser.close();
