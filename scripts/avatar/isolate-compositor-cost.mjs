/**
 * M15.3 §4 — isolates where the phone-sheet frame cost comes from (her drawing
 * vs the compositor): live, her element hidden, filters off, transform off,
 * and a plain 2D canvas in her place. Chromium + SwiftShader.
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__r = 0; const t = () => { window.__r++; requestAnimationFrame(t); }; requestAnimationFrame(t); });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/");
for (let i = 0; i < 60; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true }); if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true")) break; await p.waitForTimeout(500); }
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForTimeout(5000);
const m = async (label) => {
  const a = await p.evaluate(() => [window.__r, Number(document.querySelector('[data-testid="lelu-companion-character"]').dataset.frames || 0), performance.now()]);
  await p.waitForTimeout(4000);
  const z = await p.evaluate(() => [window.__r, Number(document.querySelector('[data-testid="lelu-companion-character"]').dataset.frames || 0), performance.now()]);
  const s = (z[2] - a[2]) / 1000;
  console.log(`${label.padEnd(34)} page ${((z[0] - a[0]) / s).toFixed(1)} fps, avatar ${((z[1] - a[1]) / s).toFixed(1)} fps`);
};
await m("live (as shipped)");
await p.evaluate(() => { const c = document.querySelector('[data-testid="lelu-companion"]'); c.dataset.t = c.style.transform; c.style.transform = "none"; c.style.transition = "none"; c.style.left = "280px"; c.style.top = "600px"; });
await m("no transform/transition");
await p.evaluate(() => { const c = document.querySelector('[data-testid="lelu-companion"]'); c.style.display = "none"; const cv = document.createElement("canvas"); cv.width = 101; cv.height = 139; cv.style.cssText = "position:fixed;right:10px;bottom:120px;z-index:99999"; document.body.appendChild(cv); const g = cv.getContext("2d"); let k = 0; setInterval(() => { g.clearRect(0, 0, 101, 139); g.fillStyle = `hsl(${k++ * 20},80%,60%)`; g.fillRect(10, 10, 80, 110); }, 250); });
await m("2D canvas updating 4/s instead");
await b.close();
