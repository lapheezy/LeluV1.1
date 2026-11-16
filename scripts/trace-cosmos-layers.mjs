/**
 * Mission 16.3 WP02 — DOM layer trace.
 *
 * Answers one question with evidence: which element actually receives a press
 * aimed at the world, and what is its ancestor chain? Not an acceptance test;
 * a diagnostic used to design the event-routing contract.
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const URL = process.env.LÉLU_URL ?? "http://localhost:3003/?perf-world";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = {};

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const inImmersive = async () => (await page.locator('[aria-label^="Back to the workspace"]').count()) > 0;
  if (!(await inImmersive())) {
    await page.locator('button[aria-label^="Look at the Cosmos"]').first().click({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const build = page.locator('[data-lelu-action="build-chair"]');
  await build.waitFor({ state: "visible", timeout: 120_000 });
  await build.click();
  await page.waitForTimeout(2500);

  // Every element that paints over the canvas region, plus the canvas stack.
  out.canvases = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return {
        size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        topLeft: [Math.round(rect.left), Math.round(rect.top)],
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        creative: canvas.dataset.leluCreative ?? null,
        parent: canvas.parentElement?.tagName ?? null,
      };
    }),
  );

  // What sits under a few world points, and the ancestor chain of each.
  const probes = [[640, 400], [860, 300], [300, 240], [1150, 620]];
  out.probes = await page.evaluate((points) => {
    const describe = (el) =>
      el
        ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute?.("role") ? `[role=${el.getAttribute("role")}]` : ""}` +
          `${el.getAttribute?.("aria-label") ? `[aria=${el.getAttribute("aria-label").slice(0, 24)}]` : ""}` +
          `${el.dataset?.leluAction ? `[action=${el.dataset.leluAction}]` : ""}` +
          `${el.dataset?.leluCreative ? "[creative]" : ""}`
        : null;
    return points.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const chain = [];
      let node = el;
      while (node && chain.length < 8) {
        chain.push(describe(node));
        node = node.parentElement;
      }
      return { at: [x, y], top: describe(el), chain };
    });
  }, probes);

  out.pointerEventsMap = await page.evaluate(() => {
    const all = [...document.querySelectorAll("body *")];
    const covering = [];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < window.innerWidth * window.innerHeight * 0.45) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      covering.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        creative: el.dataset?.leluCreative ?? null,
        action: el.dataset?.leluAction ?? null,
      });
    }
    return covering.slice(0, 25);
  });

  await writeFile("artifacts/m16-3/wp02-layers.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} catch (error) {
  console.log("ERROR", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
