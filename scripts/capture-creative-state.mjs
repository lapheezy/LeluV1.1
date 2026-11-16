/**
 * M16.3 WP04 — VISUAL capture of the persisted creative state.
 *
 * The chat screenshots from `verify-creative-live.mjs` show the conversation,
 * and the chat panel covers the scene. This opens the SAME origin after those
 * turns, enters the Cosmos so nothing is in front of the scene, and captures
 * what the renderer actually draws for the object the conversation worked on.
 *
 * It reads state as well as pixels: a screenshot alone cannot tell you a
 * rotation landed, and a store value alone cannot tell you the mesh moved.
 *
 *   node scripts/capture-creative-state.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const ORIGIN = process.env.LELU_ORIGIN ?? "http://127.0.0.1:3003";
const OUT = "artifacts/m16-3/wp04";
const ID = process.env.LELU_OBJECT ?? "obj-product-1";
mkdirSync(OUT, { recursive: true });

const report = { evidence: "VISUAL", origin: ORIGIN, object: ID, captured: [] };

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const transforms = () =>
  page.evaluate((id) => {
    const all = globalThis.__leluCreativeDebug?.transforms ?? [];
    const found = all.find((entry) => entry.id === id) ?? all[0] ?? null;
    return found;
  }, ID);

try {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const skip = page.locator('button:has-text("Continue without an account")').first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(800);

  // Enter the Cosmos so the scene is not behind the chat panel.
  const look = page.locator('button[aria-label^="Look at the Cosmos"]').first();
  if (await look.isVisible().catch(() => false)) {
    await look.click();
    await page.waitForTimeout(2600);
  }

  report.captured.push({ step: "scene", path: `${OUT}/scene-01-persisted.png`, object: await transforms() });
  await page.screenshot({ path: `${OUT}/scene-01-persisted.png` });

  // Orbit a little so the rotation reads in the pixels, not only the numbers.
  const box = await page.locator("canvas").first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.5, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  report.captured.push({ step: "orbited", path: `${OUT}/scene-02-orbited.png`, object: await transforms() });
  await page.screenshot({ path: `${OUT}/scene-02-orbited.png` });

  report.ok = report.captured.every((entry) => Boolean(entry.object));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(`${OUT}/visual-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
