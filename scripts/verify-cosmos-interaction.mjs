/**
 * Mission 16.3 WP02 — creation interaction acceptance.
 *
 * Proves, with REAL pointer input against the running app:
 *   - a world tap on a creation's visible geometry selects it (canonical id)
 *   - a dock press never changes the selection (controls protected)
 *   - an empty-space drag orbits the camera and leaves the object alone
 *   - a drag on the object moves it and commits the canonical transform
 *   - the committed position survives a reload
 *
 * Usage:
 *   node scripts/verify-cosmos-interaction.mjs --kind chair|gown|pendant [--mobile]
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const URL = process.env.LÉLU_URL ?? "http://localhost:3003/?perf-world";
const OUT = "artifacts/m16-3/wp02";
const MOBILE = process.argv.includes("--mobile");
const kindArg = process.argv.indexOf("--kind");
const KIND = kindArg > -1 ? process.argv[kindArg + 1] : "chair";
const NAME = { chair: /chair/i, gown: /gown/i, pendant: /pendant/i }[KIND] ?? /./;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const context = await browser.newContext(
  MOBILE
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } },
);
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

const report = { url: URL, kind: KIND, mobile: MOBILE, steps: [], errors, ok: false };
const tag = `${MOBILE ? "m" : "d"}-${KIND}`;
const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });

const ensureImmersive = async () => {
  const immersive = async () => (await page.locator('[aria-label^="Back to the workspace"]').count()) > 0;
  if (!(await immersive())) {
    await page.locator('button[aria-label^="Look at the Cosmos"]').first().click({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  return immersive();
};

const selection = () =>
  page.evaluate(() =>
    document.querySelector("[data-lelu-creative-selection]")?.getAttribute("data-lelu-creative-selection") ?? null,
  );

const screenOf = (id) =>
  page.evaluate(
    (objectId) => (window.__leluCreativeScreen ? window.__leluCreativeScreen() : []).find((entry) => entry.id === objectId) ?? null,
    id,
  );

const positions = () => page.evaluate(() => window.__leluCreativeDebug?.positions ?? null);
const cameraPosition = () => page.evaluate(() => window.__leluCreativeCamera?.()?.position ?? null);

/** Re-aim, then press the object's visible geometry at once (the camera flies). */
const selectByPointer = async (objectId) => {
  const trail = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.locator('[data-lelu-action="focus"]').first().click().catch(() => {});
    await page.waitForTimeout(700);
    const point = await screenOf(objectId);
    trail.push(point ? { x: Math.round(point.x), y: Math.round(point.y), onScreen: point.onScreen } : null);
    if (!point?.onScreen) continue;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
    const selected = await selection();
    const gesture = await page.evaluate(() => window.__leluCreativeLastGesture ?? null);
    if (selected === objectId) return { selected, gesture, point, attempts: attempt + 1, trail };
  }
  return { selected: await selection(), gesture: null, point: null, attempts: 6, trail };
};

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  report.steps.push("loaded");
  report.immersive = await ensureImmersive();
  report.sceneRoot = await page.evaluate(() => {
    const el = document.querySelector("[data-lelu-scene-root]");
    return el ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0]}` : null;
  });

  const build = page.locator(`[data-lelu-action="build-${KIND}"]`);
  await build.waitFor({ state: "visible", timeout: 120_000 });
  await build.click();
  await page.waitForTimeout(2400);
  report.build = await page.evaluate(() => ({
    notice: document.querySelector("[data-lelu-creative-notice]")?.textContent ?? null,
  }));

  // The creative id is the one selection reports; the dock's notice names the
  // SPATIAL id it mirrored into cosmos-core, which is a different object.
  const objectId = await page.evaluate(
    (pattern) => {
      const source = pattern.replace(/^\/|\/[a-z]*$/g, "");
      const entries = window.__leluCreativeScreen ? window.__leluCreativeScreen() : [];
      const match = entries.find((entry) => new RegExp(source, "i").test(entry.name ?? ""));
      return match ? match.id : null;
    },
    String(NAME),
  );
  report.objectId = objectId;
  report.objects = await page.evaluate(() => window.__leluCreativeScreen?.().map((e) => e.name) ?? null);

  // ---- 1. press the visible geometry ----
  report.select = await selectByPointer(objectId);
  await shot("01-selected");

  // ---- 2. a dock press must not change the selection ----
  const beforeControl = await selection();
  await page.locator('[data-lelu-action="tool-select"]').first().click();
  await page.waitForTimeout(300);
  report.controlPress = { before: beforeControl, after: await selection() };

  // ---- 3. empty-space drag orbits the camera, not the object ----
  const empty = { x: Math.round((MOBILE ? 390 : 1280) * 0.12), y: Math.round((MOBILE ? 844 : 800) * 0.82) };
  const cameraBefore = await cameraPosition();
  const positionBeforeOrbit = await positions();
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(empty.x + (70 * step) / 8, empty.y - (40 * step) / 8);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const cameraAfter = await cameraPosition();
  const positionAfterOrbit = await positions();
  report.orbit = {
    cameraBefore,
    cameraAfter,
    cameraMoved: JSON.stringify(cameraBefore) !== JSON.stringify(cameraAfter),
    objectMoved: JSON.stringify(positionBeforeOrbit) !== JSON.stringify(positionAfterOrbit),
  };
  await shot("02-orbited");

  // ---- 4. drag the object and commit ----
  await page.locator('[data-lelu-action="tool-move"]').first().click();
  await page.waitForTimeout(300);
  const positionBefore = await positions();

  let drag = { committed: null, positionBefore, positionAfter: positionBefore };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('[data-lelu-action="focus"]').first().click().catch(() => {});
    await page.waitForTimeout(600);
    const point = await screenOf(objectId);
    if (!point?.onScreen) continue;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const pressGesture = await page.evaluate(() => window.__leluCreativeLastGesture ?? null);
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(point.x + (140 * step) / 6, point.y - (60 * step) / 6);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);
    const committed = await page.evaluate(() => window.__leluCreativeLastCommit ?? null);
    const positionAfter = await positions();
    drag = { committed, pressGesture, positionBefore, positionAfter, attempts: attempt + 1 };
    if (committed && JSON.stringify(positionBefore) !== JSON.stringify(positionAfter)) break;
    await page.waitForTimeout(500);
  }
  report.drag = drag;
  await shot("03-dragged");

  // ---- 5. reload: the committed position must survive ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await ensureImmersive();
  await page.waitForTimeout(900);
  report.afterReload = { positions: await positions() };

  report.ok =
    Boolean(objectId) &&
    report.select.selected === objectId &&
    Boolean(report.drag.committed) &&
    JSON.stringify(report.drag.positionBefore) !== JSON.stringify(report.drag.positionAfter) &&
    JSON.stringify(report.afterReload.positions?.[0]) === JSON.stringify(report.drag.positionAfter?.[0]) &&
    report.orbit.cameraMoved &&
    !report.orbit.objectMoved &&
    report.controlPress.before === report.controlPress.after;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(`${OUT}/${tag}-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      kind: KIND,
      mobile: MOBILE,
      ok: report.ok,
      objectId: report.objectId,
      select: report.select,
      controlPress: report.controlPress,
      orbit: report.orbit,
      drag: report.drag,
      afterReload: report.afterReload,
      error: report.error,
    },
    null,
    2,
  ),
);
process.exit(report.ok ? 0 : 1);
