/**
 * Mission 5.4 — direct 3D portal interaction, measured on a settled camera.
 *
 * The wider probe reads the field while the Cosmos camera is still flying, so
 * projections and clicks disagreed. Here every attempt first returns to the
 * Core, waits for the runtime to report no transition, and only then reads the
 * field, resolves a click point through the renderer's own raycaster
 * (`__leluPortalPick`), and clicks it with a real mouse.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT = "docs/acceptance/spatial-phase-2-13/measurements/portal-click.json";
const SHOTS = "docs/acceptance/spatial-phase-2-13/screenshots";
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);

const launch = () =>
  chromium.launch({
    executablePath: CHROME,
    args: [
      "--no-sandbox",
      "--headless=new",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
      "--enable-unsafe-swiftshader",
    ],
  });

const dismissGate = (page) =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((entry) =>
      (entry.textContent ?? "").toLowerCase().includes("continue without an account"),
    );
    if (!button) return false;
    button.click();
    return true;
  });

const clickSelector = async (page, selector) => {
  const element = await page.$(selector);
  const box = element ? await element.boundingBox() : null;
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
};

const read = (page) =>
  page.evaluate(() => {
    const spatial = window.__leluSpatial?.getState?.() ?? null;
    const field = window.__leluPortalField?.() ?? null;
    return {
      scene: document.body.dataset.spatialScene ?? spatial?.current ?? null,
      transition: document.body.dataset.spatialTransition ?? spatial?.transition?.kind ?? "",
      destination: spatial?.destination ?? null,
      selected: field?.selected ?? null,
      canvases: document.querySelectorAll("canvas").length,
      drawnCount: field?.drawnCount ?? null,
      registry: field?.registryCount ?? null,
      duplicates: field?.duplicates ?? null,
      field,
    };
  });

const idle = async (page) => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await read(page);
    if (!state.transition) return state;
    await page.waitForTimeout(400);
  }
  return read(page);
};

const settleCore = async (page) => {
  await clickSelector(page, '[data-spatial-control="core"]');
  await page.waitForTimeout(3500);
  // The navigator's orb is the app's own way into the world (immersive), so
  // the canvas — not the home dashboard — is what the pointer meets.
  const orb = await page.$(".lsn-orb");
  const box = orb ? await orb.boundingBox() : null;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
  }
  await page.waitForTimeout(2200);
  return idle(page);
};

/** A screen point the renderer attributes to this portal, scanned around its centre. */
const resolvePoint = (page, portal) =>
  page.evaluate(
    ({ x0, y0, id }) => {
      const field = window.__leluPortalField?.();
      const width = field?.viewport?.width ?? window.innerWidth;
      const height = field?.viewport?.height ?? window.innerHeight;
      let blocked = null;
      for (let r = 0; r <= 120; r += 6) {
        for (const [dx, dy] of [
          [0, 0],
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
          [r, r],
          [-r, -r],
          [r, -r],
          [-r, r],
        ]) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 2 || y < 2 || x > width - 2 || y > height - 2) continue;
          const pick = window.__leluPortalPick?.(x, y);
          if (pick && pick.portalId === id) {
            const element = document.elementFromPoint(x, y);
            const tag = element?.tagName ?? null;
            // Only a point the pointer meets on the CANVAS is a mesh click. A
            // label chip over the same portal would go through the same
            // handler, but it is DOM, and this measurement is about the 3D
            // object, so keep scanning for a bare canvas point.
            if (tag === "CANVAS") return { x, y, pick, tag };
            blocked = { x, y, pick, tag };
          }
        }
      }
      return blocked ? { ...blocked, blockedBy: blocked.tag } : null;
    },
    { x0: portal.screen.x, y0: portal.screen.y, id: portal.id },
  );

const attempt = async (page, destination, label) => {
  const before = await settleCore(page);
  const portals = before.field?.portals ?? [];
  const portal =
    portals.find((entry) => entry.destination === destination && entry.onScreen) ??
    portals.find((entry) => entry.onScreen) ??
    null;
  if (!portal) {
    return { destination, error: "no on-screen portal", onScreen: portals.filter((p) => p.onScreen).length };
  }
  const point = await resolvePoint(page, portal);
  if (!point || point.tag !== "CANVAS") {
    return { destination, portal: { id: portal.id, screen: portal.screen }, error: "no canvas point", point };
  }
  const beforeClick = { scene: before.scene, selected: before.selected };
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(1300);
  const during = await read(page);
  await page.waitForTimeout(5200);
  const after = await idle(page);
  await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-${label}.png` }).catch(() => {});
  return {
    destination,
    beforeClick,
    clicked: { id: portal.id, screen: portal.screen },
    point,
    during: { scene: during.scene, transition: during.transition, destination: during.destination, selected: during.selected },
    landed: after.scene,
    matches: after.scene === destination,
    selectedAfter: after.selected,
  };
};

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const result = { viewport: { width: VP[0], height: VP[1] }, base: BASE, errors: [] };
try {
  const context = await browser.newContext({
    viewport: { width: VP[0], height: VP[1] },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 160)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  await dismissGate(page);
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: "*{backdrop-filter:none !important;}" }).catch(() => {});

  result.core = await settleCore(page);
  result.coreScreens = (result.core.field?.portals ?? []).map((portal) => ({
    destination: portal.destination,
    screen: portal.screen,
    onScreen: portal.onScreen,
    drawn: portal.drawn,
    hitDrawn: portal.hitDrawn,
  }));
  await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-core-field.png` }).catch(() => {});

  const FULL = process.env.FULL === "1";
  result.attempts = [await attempt(page, "files", "click-files")];
  if (FULL) result.attempts.push(await attempt(page, "projects", "click-projects"));

  // Rapid repeated selection of one portal.
  const rapidBase = await settleCore(page);
  const rapids = (rapidBase.field?.portals ?? []).filter((portal) => portal.onScreen);
  if (rapids[0]) {
    const point = await resolvePoint(page, rapids[0]);
    if (point && point.tag === "CANVAS") {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(80);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(1200);
      const during = await read(page);
      await page.waitForTimeout(4500);
      const after = await idle(page);
      result.rapid = {
        portal: rapids[0].id,
        during: { transition: during.transition, destination: during.destination },
        landed: after.scene,
        matches: after.scene === rapids[0].destination,
        canvases: after.canvases,
      };
    }
  }

  // Selection while another transition is already running.
  if (FULL) {
  const conflictBase = await settleCore(page);
  const flight = (conflictBase.field?.portals ?? []).filter((portal) => portal.onScreen);
  if (flight.length >= 2) {
    const first = await resolvePoint(page, flight[0]);
    const second = flight.find((portal) => portal.destination !== flight[0].destination);
    const secondPoint = second ? await resolvePoint(page, second) : null;
    if (first && secondPoint) {
      await page.mouse.click(first.x, first.y);
      await page.waitForTimeout(150);
      const inFlight = await read(page);
      await page.mouse.click(secondPoint.x, secondPoint.y);
      await page.waitForTimeout(5200);
      const after = await idle(page);
      result.conflict = {
        first: flight[0].destination,
        second: second.destination,
        inFlight: { transition: inFlight.transition, destination: inFlight.destination },
        landed: after.scene,
        keptFirst: after.scene === flight[0].destination && flight[0].destination !== second.destination,
        canvases: after.canvases,
      };
    }
  }

  }

  // Travel after a reload.
  if (FULL) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await dismissGate(page);
    await page.waitForTimeout(2500);
    result.afterReload = await attempt(page, "files", "click-after-reload");
  }
} catch (error) {
  result.failure = String(error).slice(0, 400);
}
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 1).slice(0, 5000));
await browser.close();
