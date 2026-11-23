/**
 * Cosmos rendering probe (production server). Headless Chromium has no GPU:
 * WebGL runs on SwiftShader, which the render governor refuses to animate by
 * design. `?perf-world` lifts that refusal so the real scene can be drawn and
 * timed here; numbers from this container are NOT device FPS.
 *   node docs/acceptance/workforce-consolidation/cosmos-probe.mjs
 */
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/workforce-consolidation";
const browser = await chromium.launch({ ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}), args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const results = {};
for (const [name, opts, q] of [["desktop-default", { viewport: { width: 1440, height: 900 } }, ""], ["desktop-perf-world", { viewport: { width: 1440, height: 900 } }, "?perf-world"], ["iphone-perf-world", { ...devices["iPhone 13"], deviceScaleFactor: 1 }, "?perf-world"]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:4173/${q}`, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(async () => {
    const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height, cls: c.className.slice(0, 40) }));
    const gl = document.createElement("canvas").getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    // rAF rate over 3 s (page-level; not GPU FPS on a device)
    const frames = await new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); });
    return { canvases, renderer, rafPerSecond: Math.round(frames), heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  });
  await page.screenshot({ path: `${OUT}/screenshots/cosmos-${name}.png` });
  results[name] = { ...info, pageErrors: errors };
  console.log(name, JSON.stringify(results[name]));
  await ctx.close();
}
writeFileSync(`${OUT}/cosmos-probe.json`, JSON.stringify(results, null, 2));
await browser.close();
