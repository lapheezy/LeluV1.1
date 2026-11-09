/**
 * Mission 5.4B.3 — the first click that actually reaches the field.
 *
 * The centre of a portal is covered by interface chrome. This probe does not
 * assume the centre is usable: inside each portal's own mouth it searches for a
 * pixel where (a) the top element IS the Genesis canvas and (b) the raycast at
 * that pixel returns the aimed portal. Only such a pixel is clicked, with real
 * pointer input, and the identity the R3F handler delivered is read back.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const OUT = `docs/acceptance/spatial-phase-2-13/measurements/first-real-click-${VP[0]}x${VP[1]}.json`;
const DESTINATIONS = (process.env.DESTS ?? "files,studio").split(",");

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: VP[0], height: VP[1] } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((button) => (button.textContent ?? "").toLowerCase().includes("continue without an account"))
    ?.click();
});
await page.waitForTimeout(2500);

const result = { viewport: { width: VP[0], height: VP[1] }, entry: null, attempts: [], errors };

// Entry through the app's own control, then let the flight decay.
const cosmos = await (await page.$(".lch-cosmos"))?.boundingBox();
if (cosmos) await page.mouse.click(cosmos.x + cosmos.width / 2, cosmos.y + cosmos.height / 2);
await page.waitForTimeout(7000);
result.entry = await page.evaluate(() => ({
  immersive: window.__leluImmersive ?? null,
  dataImmersive: document.querySelector(".lsn-orb")?.getAttribute("data-immersive") ?? null,
  settle: window.__leluCameraSettle ?? null,
}));

/** A pixel inside the mouth where the canvas owns the pointer and the pick agrees. */
const findPixel = (destination) =>
  page.evaluate((wanted) => {
    const field = window.__leluPortalField?.();
    const portal = (field?.portals ?? []).find((entry) => entry.destination === wanted);
    if (!portal) return { error: "not in field" };
    const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
    const radius = Math.max(6, Math.round(portal.screenRadius ?? 18));
    const centre = portal.screen;
    const tried = [];
    for (let ring = 0; ring <= 3; ring += 1) {
      const step = Math.max(2, Math.round(radius / 3)) * ring;
      for (let dx = -step; dx <= step; dx += Math.max(2, Math.round(radius / 3))) {
        for (let dy = -step; dy <= step; dy += Math.max(2, Math.round(radius / 3))) {
          const x = Math.round(centre.x + dx);
          const y = Math.round(centre.y + dy);
          if (x < 2 || y < 2 || x > field.viewport.width - 2 || y > field.viewport.height - 2) continue;
          const top = document.elementFromPoint(x, y);
          const pick = window.__leluPortalPick?.(x, y);
          tried.push({ x, y, top: top?.tagName ?? null, pick: pick?.portalId ?? null });
          if (top === canvas && pick?.portalId === portal.id) {
            return { found: { x, y }, centre, radius, tried: tried.length, id: portal.id };
          }
        }
      }
    }
    return { found: null, centre, radius, id: portal.id, tried: tried.length, sample: tried.slice(0, 6) };
  }, destination);

for (const destination of DESTINATIONS) {
  const aim = await findPixel(destination);
  if (!aim.found) {
    result.attempts.push({ destination, aim, clicked: false });
    continue;
  }
  const before = await page.evaluate(() => ({
    scene: document.body.dataset.spatialScene ?? null,
    events: window.__leluPortalEvents?.length ?? 0,
  }));
  await page.mouse.click(aim.found.x, aim.found.y);
  await page.waitForTimeout(900);
  const trace = await page.evaluate(() => window.__leluPortalEvents?.at(-1) ?? null);
  let after = before;
  for (let index = 0; index < 40; index += 1) {
    after = await page.evaluate(() => ({
      scene: document.body.dataset.spatialScene ?? null,
      transition: document.body.dataset.spatialTransition ?? null,
      events: window.__leluPortalEvents?.length ?? 0,
    }));
    if (!after.transition) break;
    await page.waitForTimeout(300);
  }
  result.attempts.push({
    destination,
    aim,
    eventsBefore: before.events,
    deliveredPortalId: trace?.delivered?.portalId ?? null,
    deliveredDestination: trace?.delivered?.destination ?? null,
    clickPoint: trace?.client ?? aim.found,
    projectedCentreAtClick: trace?.projectedCentre ?? null,
    intersections: trace?.intersections ?? null,
    settleAtClick: trace?.settle ?? null,
    landed: after.scene,
    deliveredMatches: trace?.delivered?.portalId === aim.id,
    sceneMatches: after.scene === destination,
  });
  const core = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
  if (core && after.scene !== "core") {
    await page.mouse.click(core.x + core.width / 2, core.y + core.height / 2);
    await page.waitForTimeout(1500);
  }
}

writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 1).slice(0, 5000));
await browser.close();
