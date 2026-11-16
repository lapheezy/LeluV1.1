/**
 * Mission 16 — live Cosmos acceptance harness (pixels).
 *
 * Opens the running app in the immersive Cosmos, presses "Chair" in the
 * creative dock, and screenshots the actual rendered frame. It does not
 * introspect the scene graph to "prove" anything: the evidence is the PNG.
 *
 * This container has no GPU, so the app needs ?perf-world: its render governor
 * deliberately refuses to paint a software rasteriser.
 *
 * Usage: node scripts/verify-cosmos-creative.mjs
 * Exit 0 only when the dock reported the object placed and `frameloop` was not
 * stuck at "never".
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const URL = process.env.LÉLU_URL ?? "http://localhost:3003/?perf-world";
const OUT = "artifacts/m16-3";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`console: ${message.text().slice(0, 160)}`);
});

const result = { url: URL, steps: [], consoleErrors, ok: false };

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  result.steps.push("loaded");

  // The orb toggles, so ask the app where it is instead of clicking blind:
  // SpatialNav labels itself "Back to the workspace" exactly while immersive.
  const inImmersive = async () =>
    (await page.locator('[aria-label^="Back to the workspace"]').count()) > 0;

  if (!(await inImmersive())) {
    await page.locator('button[aria-label^="Look at the Cosmos"]').first().click({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  result.steps.push((await inImmersive()) ? "immersive" : "not-immersive");

  const build = page.locator('[data-lelu-action="build-chair"]');
  await build.waitFor({ state: "visible", timeout: 120_000 });
  result.steps.push("dock-visible");
  await page.waitForTimeout(2000);

  await build.click();
  await page.waitForTimeout(2500);

  // The Cosmos camera keeps flying, so a creation drifts out of frame within
  // seconds of being placed. Focus aims it back, and the shot is taken at once.
  const focus = page.locator('[data-lelu-action="focus"]');
  if (await focus.count()) {
    await focus.first().click();
    result.steps.push("focus");
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/30-chair-in-cosmos.png`, fullPage: false });

  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/31-chair-later.png`, fullPage: false });

  result.report = await page.evaluate(() => ({
    notice: document.querySelector("[data-lelu-creative-notice]")?.textContent ?? null,
    selection: document.querySelector("[data-lelu-creative-selection]")?.getAttribute("data-lelu-creative-selection") ?? null,
    frameloop: window.__leluCreativeDebug?.frameloop ?? null,
    objectCount: window.__leluCreativeDebug?.objectCount ?? null,
    screen: window.__leluCreativeScreen ? window.__leluCreativeScreen() : null,
  }));

  result.ok = Boolean(result.report.notice) && result.report.frameloop !== "never";
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(`${OUT}/30-report.json`, JSON.stringify(result, null, 2));
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
