/**
 * Mission 16.3 WP02 — camera/pick diagnostic.
 *
 * Prints what the creative layer believes: the live camera it rays from, the
 * object's world point, its NDC and pixel position, and what element is on top
 * at that pixel. Used to explain a pick that misses; not an acceptance test.
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
    await page.waitForTimeout(1200);
  }
  const build = page.locator('[data-lelu-action="build-chair"]');
  await build.waitFor({ state: "visible", timeout: 120_000 });
  await build.click();

  // Ask the app's own camera bus for a framing we computed ourselves, then see
  // whether the camera actually lands there and whether the object projects
  // into the frame. This separates "bus does nothing" from "dock math wrong".
  const posed = await page.evaluate(async () => {
    const first = window.__leluCreativeScreen?.()[0] ?? null;
    if (!first) return { error: "no object" };
    const [ox, oy, oz] = first.world;
    const eye = { x: ox + 0.05, y: oy + 0.25, z: oz + 1.2 };
    const bus = window.__cosmosCamera;
    bus?.navigateTo?.(eye, { x: ox, y: oy, z: oz });
    return { eye, lookAt: { x: ox, y: oy, z: oz }, hadBus: Boolean(bus?.navigateTo) };
  });
  console.log(JSON.stringify({ posed }));
  await page.waitForTimeout(2500);
  console.log(
    JSON.stringify({
      afterPose: await page.evaluate(() => ({
        camera: window.__leluCreativeCamera?.() ?? null,
        first: window.__leluCreativeScreen?.()[0] ?? null,
      })),
    }),
  );

  for (const wait of [1500, 3000, 6000]) {
    await page.waitForTimeout(wait === 1500 ? 1500 : 1500);
    const snapshot = await page.evaluate(() => {
      const screen = window.__leluCreativeScreen ? window.__leluCreativeScreen() : [];
      const camera = window.__leluCreativeCamera ? window.__leluCreativeCamera() : null;
      const first = screen[0] ?? null;
      const top = first && first.onScreen ? document.elementFromPoint(first.x, first.y) : null;
      return {
        camera,
        first,
        cameraDataset: document.querySelector("[data-lelu-creative]")?.getAttribute("data-lelu-creative-camera") ?? null,
        topElement: top ? `${top.tagName.toLowerCase()}${top.dataset?.leluAction ? `[action=${top.dataset.leluAction}]` : ""}` : null,
      };
    });
    console.log(JSON.stringify({ wait, ...snapshot }));
  }
} catch (error) {
  console.log("ERROR", error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
