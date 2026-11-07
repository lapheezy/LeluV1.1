/**
 * One short session, one screenshot, hard-bounded.
 *
 * Used for the states that do not need a long interaction chain, so the
 * software-WebGL renderer in this container is never given time to trap.
 *
 *   node short-shot.mjs <w> <h> <name> [scene]
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..");
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const [W, H] = [Number(process.argv[2]), Number(process.argv[3])];
const NAME = process.argv[4];
const SCENE = process.argv[5] || "";
const MOBILE = W < 800;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    "--no-sandbox",
    "--headless=new",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  isMobile: MOBILE,
  hasTouch: MOBILE,
  reducedMotion: "reduce",
});
if (process.env.NOBLUR === "1") {
  /* SwiftShader mis-composites the app's frosted glass and blurs the whole
     frame. Disabling the filter changes no layout, text or colour; it is
     recorded in the metadata of every capture taken this way. */
  await context.addInitScript(() => {
    const install = () => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";
      document.head.appendChild(style);
    };
    if (document.head) install();
    else document.addEventListener("DOMContentLoaded", install, { once: true });
  });
}
const page = await context.newPage();
const tap = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no ${selector}`);
  if (MOBILE) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
try {
  await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-spatial-nav]", { timeout: 60000 });
  await page.waitForTimeout(3000);
  if (SCENE) {
    if (!(await page.locator(`[data-spatial-scene="${SCENE}"]`).count())) {
      await tap('[data-spatial-control="expand"]');
      await page.waitForSelector(`[data-spatial-scene="${SCENE}"]`, { timeout: 12000 });
    }
    await tap(`[data-spatial-scene="${SCENE}"]`);
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const s = await page.evaluate(() => {
        const st = window.__leluSpatial?.getState?.();
        return { c: st?.current, t: st?.transition?.kind ?? null };
      });
      if (!s.t && s.c === SCENE) break;
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1200);
  }
  const file = `${W}x${H}-${NAME}.png`;
  await page.screenshot({ path: join(OUT, file) });
  const meta = {
    file,
    viewport: `${W}x${H}`,
    pixels: await page.evaluate(() => `${innerWidth}x${innerHeight}`),
    scene: await page.evaluate(() => document.body.dataset.spatialScene || ""),
    canvases: await page.evaluate(() => document.querySelectorAll("canvas").length),
    backdropFilterDisabled: process.env.NOBLUR === "1",
    textLength: await page.evaluate(() => (document.body.innerText || "").length),
    portals: await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("lelu.lelu.spatial.portals.v1") || "[]").length;
      } catch {
        return -1;
      }
    }),
    at: new Date().toISOString(),
  };
  console.log(JSON.stringify(meta));
} catch (error) {
  console.log(JSON.stringify({ viewport: `${W}x${H}`, name: NAME, error: String(error).split("\n")[0].slice(0, 140) }));
} finally {
  await browser.close().catch(() => {});
}
