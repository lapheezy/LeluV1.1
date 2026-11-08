/**
 * Mission 5.4B.5 — reliable portal selection, five attempts per destination.
 *
 * Every attempt runs on a fresh page load and enters the world through the app's
 * own control. The target is measured once, in the page, and the press is then
 * dispatched through the browser input protocol as a single burst (moved →
 * pressed → released) so the gap between measuring and delivering is as small as
 * the browser allows. Nothing is called directly: the canvas hit test, the R3F
 * raycast and the app's own travel call are the only path to a destination.
 *
 * A canvas-level pointer counter proves whether the press reached the canvas at
 * all, which separates "input never arrived" from "raycast rejected it".
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const LOADS = Number(process.env.LOADS ?? 5);
const MODE = process.env.MODE ?? "burst"; // burst | hold | playwright
const OUT = `docs/acceptance/spatial-phase-2-13/measurements/reliable-clicks-${VP[0]}x${VP[1]}-${MODE}.json`;
const DESTS = ["files", "studio"];
mkdirSync("docs/acceptance/spatial-phase-2-13/screenshots", { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const attempts = [];

/*
 * Ready gate: a press is only meaningful once the app is not already flying and
 * the camera has held still for a few frames. This is test setup, not a retry —
 * an attempt that fails after the gate is recorded as a failure.
 */
const waitReady = async (page, budgetMs = 10000) => {
  const end = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < end) {
    last = await poll(page);
    if (!last.transition && (last.settle?.stableFrames ?? 0) >= 8) return { ok: true, ...last };
    await page.waitForTimeout(120);
  }
  return { ok: false, ...(last ?? {}) };
};

const poll = (page) =>
  page.evaluate(() => {
    const s = window.__leluSpatial?.getState?.();
    return {
      current: s?.current ?? null,
      transition: s?.transition ? s.transition.kind : null,
      progress: s?.transition ? Math.round(s.transition.progress * 100) : 100,
      dataset: document.body.dataset.spatialScene ?? null,
      settle: window.__leluCameraSettle ?? null,
    };
  });

for (let load = 1; load <= LOADS; load += 1) {
  const context = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").toLowerCase().includes("continue without an account"))
      ?.click();
  });
  await page.waitForTimeout(1800);
  const cosmos = await (await page.$(".lch-cosmos"))?.boundingBox();
  if (cosmos) await page.mouse.click(cosmos.x + cosmos.width / 2, cosmos.y + cosmos.height / 2);
  await page.waitForTimeout(5200);
  const entry = await page.evaluate(() => ({ immersive: window.__leluImmersive ?? null }));
  const entryReady = await waitReady(page, 12000);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
    window.__leluCanvasPointers = { down: 0, up: 0 };
    if (canvas) {
      canvas.addEventListener("pointerdown", () => { window.__leluCanvasPointers.down += 1; }, true);
      canvas.addEventListener("pointerup", () => { window.__leluCanvasPointers.up += 1; }, true);
    }
  });

  for (const destination of DESTS) {
    const ready = await waitReady(page);
    const measure = await page.evaluate((wanted) => {
      const field = window.__leluPortalField?.();
      const portal = (field?.portals ?? []).find((p) => p.destination === wanted);
      if (!portal) return { error: "not in field" };
      const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
      const radius = 26;
      for (let ring = 0; ring <= 2; ring += 1) {
        const step = ring * 9;
        for (let dx = -step; dx <= step; dx += 9) {
          for (let dy = -step; dy <= step; dy += 9) {
            const x = Math.round(portal.screen.x + dx);
            const y = Math.round(portal.screen.y + dy);
            if (x < 4 || y < 4 || x > field.viewport.width - 4 || y > field.viewport.height - 4) continue;
            const pick = window.__leluPortalPick?.(x, y);
            if (document.elementFromPoint(x, y) === canvas && pick?.portalId === portal.id) {
              return { x, y, id: portal.id, centre: { x: Math.round(portal.screen.x), y: Math.round(portal.screen.y) }, radius, tried: ring, fieldCamera: field.camera ?? null };
            }
          }
        }
      }
      return { error: "no reachable pixel", id: portal.id, centre: { x: Math.round(portal.screen.x), y: Math.round(portal.screen.y) } };
    }, destination);

    if (measure.error) {
      attempts.push({ load, destination, measure, delivered: null, landed: null, matches: false });
      continue;
    }
    const before = await page.evaluate(() => ({ ...window.__leluCanvasPointers, events: window.__leluPortalEvents?.length ?? 0 }));
    if (MODE === "playwright") {
      await page.mouse.click(measure.x, measure.y);
    } else {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: measure.x, y: measure.y, button: "none", clickCount: 0 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: measure.x, y: measure.y, button: "left", clickCount: 1 });
      if (MODE === "hold") await page.waitForTimeout(110);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: measure.x, y: measure.y, button: "left", clickCount: 1 });
    }
    await page.waitForTimeout(700);
    const delivered = await page.evaluate(() => {
      const t = window.__leluPortalEvents?.at(-1) ?? null;
      return {
        trace: t ? { delivered: t.delivered, scene: t.scene, transition: t.transition, settle: t.settle, projectedCentre: t.projectedCentre } : null,
        pointers: window.__leluCanvasPointers,
        events: window.__leluPortalEvents?.length ?? 0,
      };
    });
    let after = await poll(page);
    for (let i = 0; i < 26; i += 1) {
      after = await poll(page);
      if (!after.transition) break;
      await page.waitForTimeout(280);
    }
    const landed = after.dataset ?? after.current;
    attempts.push({
      load,
      destination,
      ready,
      entryReady,
      measure,
      pointersBefore: before,
      pointersAfter: delivered.pointers,
      eventsBefore: before.events,
      eventsAfter: delivered.events,
      delivered: delivered.trace?.delivered?.portalId ?? null,
      deliveredDestination: delivered.trace?.delivered?.destination ?? null,
      settleAtClick: delivered.trace?.settle ?? null,
      projectedCentreAtClick: delivered.trace?.projectedCentre ?? null,
      landed,
      deliveredMatches: delivered.trace?.delivered?.portalId === measure.id,
      sceneMatches: landed === destination,
      matches: delivered.trace?.delivered?.portalId === measure.id && landed === destination,
    });
    if (landed !== "core") {
      const core = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
      if (core) await page.mouse.click(core.x + core.width / 2, core.y + core.height / 2);
      await page.waitForTimeout(1600);
    }
  }
  await context.close();
  console.error(`load ${load} done`);
}

const summary = {
  files: attempts.filter((a) => a.destination === "files" && a.matches).length,
  studio: attempts.filter((a) => a.destination === "studio" && a.matches).length,
  attempts: attempts.length,
  wrongDestination: attempts.filter((a) => a.sceneMatches === false && a.landed && a.landed !== "core").length,
  noEvent: attempts.filter((a) => a.delivered === null).length,
};
writeFileSync(OUT, `${JSON.stringify({ mission: "5.4B.5", mode: MODE, viewport: { width: VP[0], height: VP[1] }, summary, attempts }, null, 2)}\n`);
console.log(JSON.stringify({ out: OUT, summary, rows: attempts.map((a) => ({ load: a.load, dest: a.destination, point: [a.measure?.x, a.measure?.y], id: a.measure?.id, delivered: a.delivered, landed: a.landed, down: a.pointersAfter?.down, events: a.eventsAfter, matches: a.matches, err: a.measure?.error ?? null })) }, null, 1));
await browser.close();
