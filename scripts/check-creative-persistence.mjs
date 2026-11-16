/**
 * Reads the creative store's own persisted state after a fresh page load and
 * prints it, so a committed drag can be checked against what the app restored.
 */

import { chromium } from "playwright";

const URL = process.env.LÉLU_URL ?? "http://localhost:3003/?perf-world";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const immersive = async () => (await page.locator('[aria-label^="Back to the workspace"]').count()) > 0;
  if (!(await immersive())) {
    await page.locator('button[aria-label^="Look at the Cosmos"]').first().click({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.locator('[data-lelu-action="build-chair"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1500);
  console.log(
    JSON.stringify({
      positions: await page.evaluate(() => window.__leluCreativeDebug?.positions ?? null),
      objects: await page.evaluate(() => window.__leluCreativeScreen?.().map((e) => ({ id: e.id, name: e.name })) ?? null),
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
} finally {
  await browser.close();
}
