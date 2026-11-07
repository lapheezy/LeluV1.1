/**
 * Mission 5.4B.2 — settled-frame portal targeting experiment.
 *
 * Two questions, one measurement:
 *   A. did R3F deliver the portal the pointer was aimed at?
 *   B. were the coordinates and the camera taken from the same frame?
 *
 * So nothing is clicked until the app itself reports a settled camera (a run of
 * consecutive frames with no position or rotation change) AND no transition is
 * running. The click is then placed on the portal's own projected centre, the
 * real handler records what it received (`__leluPortalEvents`), and the landed
 * scene is read after the flight.
 *
 * Classification:
 *   delivered portal ≠ aimed portal  → A/D (hit identity, incl. screen overlap)
 *   delivered portal = aimed portal, scene ≠ destination → B (resolution)
 *   settle.stableFrames < threshold at click time → C (harness synchronization)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const DIR = "docs/acceptance/spatial-phase-2-13/measurements";
const SHOTS = "docs/acceptance/spatial-phase-2-13/screenshots";
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const REPS = Number(process.env.REPS ?? 5);
const DESTINATIONS = (process.env.DESTS ?? "files,studio").split(",");
const SETTLED_FRAMES = Number(process.env.SETTLED ?? 30);

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

const state = (page) =>
  page.evaluate(() => {
    const spatial = window.__leluSpatial?.getState?.() ?? null;
    const field = window.__leluPortalField?.() ?? null;
    return {
      scene: document.body.dataset.spatialScene ?? spatial?.current ?? null,
      transition: document.body.dataset.spatialTransition ?? spatial?.transition?.kind ?? "",
      destination: spatial?.destination ?? null,
      settle: window.__leluCameraSettle ?? null,
      immersive: document.querySelector(".lsn-orb")?.getAttribute("data-immersive") ?? null,
      field,
      canvases: document.querySelectorAll("canvas").length,
    };
  });

/** Wait for a settled camera AND no flight. Never a fixed sleep. */
const settle = async (page, label = "") => {
  const deadline = Date.now() + 12000;
  let last = null;
  while (Date.now() < deadline) {
    last = await state(page);
    const stable = last.settle?.stableFrames ?? 0;
    if (!last.transition && stable >= SETTLED_FRAMES) {
      return { ...last, ok: true, settleMet: true, label };
    }
    await page.waitForTimeout(120);
  }
  /*
   * The Core camera orbits continuously (measured: deltaPosition 0,
   * deltaRotation ~0.006 per frame), so an absolute "settled" state may never
   * arrive. Do not pretend it did: proceed with no flight running, record that
   * settlement was NOT met, and let the delivered-identity trace decide whether
   * the failure is identity or coordinates.
   */
  return {
    ...last,
    ok: !last.transition,
    settleMet: false,
    label,
    reason: last.transition ? "transition still running" : undefined,
  };
};

const enterWorld = async (page) => {
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((entry) => (entry.textContent ?? "").toLowerCase().includes("continue without an account"))
      ?.click();
  });
  await page.waitForTimeout(1200);
  const core = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
  if (core) await page.mouse.click(core.x + core.width / 2, core.y + core.height / 2);
  await page.waitForTimeout(1500);
  // Inspect the published state; press the orb only when the world is closed.
  // The page can hold several `.lsn-orb` nodes (some hidden), so press the
  // VISIBLE one through its own click handler rather than guessing a point.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const info = await state(page);
    if (info.immersive === "true") break;
    const pressed = await page.evaluate(() => {
      const orbs = [...document.querySelectorAll(".lsn-orb")];
      const visible = orbs.find((orb) => {
        const rect = orb.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(orb).visibility !== "hidden";
      });
      if (!visible) return { pressed: false, count: orbs.length };
      visible.click();
      return { pressed: true, count: orbs.length, before: visible.getAttribute("data-immersive") };
    });
    result.entry = { ...(result.entry ?? {}), orb: pressed };
    if (!pressed.pressed) break;
    await page.waitForTimeout(1800);
  }
  return settle(page, "enter");
};

/** The portal's own projected centre, if it is inside the viewport. */
const aim = (page, destination) =>
  page.evaluate(
    ({ destination, margin }) => {
      const field = window.__leluPortalField?.();
      const portal = (field?.portals ?? []).find((entry) => entry.destination === destination);
      if (!portal) return { error: "destination not in the field" };
      const { width, height } = field.viewport;
      const inside =
        portal.screen.x >= margin &&
        portal.screen.y >= margin &&
        portal.screen.x <= width - margin &&
        portal.screen.y <= height - margin;
      const canvas = document.querySelector('[data-spatial-canvas="genesis"]');
      const elements = document
        .elementsFromPoint(portal.screen.x, portal.screen.y)
        .slice(0, 4)
        .map((element) => element.tagName);
      return {
        id: portal.id,
        destination: portal.destination,
        screen: portal.screen,
        hitRadius: portal.hitRadius,
        onScreen: portal.onScreen,
        insideViewport: inside,
        viewport: { width, height },
        topElement: elements[0] ?? null,
        elements,
        canvasOnTop: Boolean(canvas && document.elementFromPoint(portal.screen.x, portal.screen.y) === canvas),
        pickAtCentre: window.__leluPortalPick?.(portal.screen.x, portal.screen.y) ?? null,
      };
    },
    { destination, margin: 6 },
  );

mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const result = {
  mission: "5.4B.2",
  viewport: { width: VP[0], height: VP[1] },
  device: "Chromium headless + SwiftShader software compositor (NOT real-device performance)",
  settledFramesRequired: SETTLED_FRAMES,
  reps: REPS,
  errors: [],
  attempts: [],
};
try {
  const context = await browser.newContext({
    viewport: { width: VP[0], height: VP[1] },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: "*{backdrop-filter:none !important;}" }).catch(() => {});
  const entered = await enterWorld(page);
  result.entry = {
    ok: entered.ok,
    reason: entered.reason ?? null,
    immersive: entered.immersive,
    scene: entered.scene,
    settle: entered.settle,
    canvases: entered.canvases,
    field: entered.field
      ? {
          registry: entered.field.registryCount,
          drawn: entered.field.drawnCount,
          onScreen: entered.field.portals.filter((portal) => portal.onScreen).length,
          overlappingMouths: entered.field.overlappingMouths,
        }
      : null,
  };
  await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-settled-field.png` }).catch(() => {});

  for (const destination of DESTINATIONS) {
    for (let rep = 1; rep <= REPS; rep += 1) {
      const before = await settle(page, `${destination}#${rep}`);
      if (!before.ok) {
        result.attempts.push({ destination, rep, aborted: before.reason, matches: false });
        continue;
      }
      const target = await aim(page, destination);
      if (!target || target.error || !target.insideViewport) {
        result.attempts.push({ destination, rep, aborted: target?.error ?? "portal not inside viewport", aim: target, matches: false });
        continue;
      }
      // Aim exactly at the portal's projected centre: the aim is the experiment.
      await page.mouse.click(target.screen.x, target.screen.y);
      await page.waitForTimeout(700);
      const delivered = await page.evaluate(
        () => window.__leluPortalEvents?.[window.__leluPortalEvents.length - 1] ?? null,
      );
      const during = await state(page);
      const deadline = Date.now() + 16000;
      let after = during;
      while (Date.now() < deadline) {
        after = await state(page);
        if (!after.transition) break;
        await page.waitForTimeout(300);
      }
      const label = `${destination}-rep${rep}`;
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-settled-${label}.png` }).catch(() => {});
      result.attempts.push({
        destination,
        rep,
        aim: target,
        clickPoint: { x: target.screen.x, y: target.screen.y },
        deliveredPortalId: delivered?.delivered?.portalId ?? null,
        deliveredDestination: delivered?.delivered?.destination ?? null,
        intersections: delivered?.intersections ?? null,
        settleAtClick: delivered?.settle ?? null,
        projectedCentreAtClick: delivered?.projectedCentre ?? null,
        transitionDestination: during.destination,
        transitionKind: during.transition,
        landed: after.scene,
        deliveredMatchesAim: delivered?.delivered?.portalId === target.id,
        sceneMatchesDestination: after.scene === destination,
        matches: delivered?.delivered?.portalId === target.id && after.scene === destination,
      });
      if (after.scene !== "core") {
        await page.evaluate(() => document.querySelector('[data-spatial-control="core"]')?.click());
        await page.waitForTimeout(1200);
      }
    }
  }
  result.summary = {
    attempts: result.attempts.length,
    deliveredMatchesAim: result.attempts.filter((attempt) => attempt.deliveredMatchesAim).length,
    sceneMatchesDestination: result.attempts.filter((attempt) => attempt.sceneMatchesDestination).length,
    fullyMatched: result.attempts.filter((attempt) => attempt.matches).length,
    aborted: result.attempts.filter((attempt) => attempt.aborted).length,
  };
} catch (error) {
  result.failure = String(error).slice(0, 400);
}
const out = `${DIR}/portal-settled-${VP[0]}x${VP[1]}.json`;
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      out,
      entry: result.entry,
      summary: result.summary ?? null,
      failure: result.failure ?? null,
      attempts: result.attempts.map((attempt) => ({
        destination: attempt.destination,
        rep: attempt.rep,
        aimScreen: attempt.aim?.screen ?? null,
        delivered: attempt.deliveredPortalId,
        deliveredDestination: attempt.deliveredDestination,
        settledFrames: attempt.settleAtClick?.stableFrames ?? null,
        landed: attempt.landed,
        deliveredMatchesAim: attempt.deliveredMatchesAim,
        sceneMatchesDestination: attempt.sceneMatchesDestination,
        aborted: attempt.aborted ?? null,
      })),
    },
    null,
    1,
  ),
);
await browser.close();
