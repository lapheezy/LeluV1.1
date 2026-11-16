/**
 * Mission 5.4B.1 — does a click travel to the portal it was aimed at?
 *
 * For every on-screen portal this records the chain the mission asks for:
 * registry id → drawn mesh → hit-surface mesh → screen point → the real mouse
 * click on the canvas → the portal the runtime says was selected → the
 * destination it resolved → the scene that became active.
 *
 * A click that starts any transition is not enough here; `matches` is true only
 * when the scene that became active is the destination of the portal under the
 * pointer. Points are resolved through the renderer's own raycaster and must be
 * bare canvas: a click on a label chip proves the DOM control, not the mesh.
 *
 * Env: LIMIT (how many portals this run covers), OFFSET (which one to start
 * at), VP (viewport), FULL=1 (also rapid + conflict + reload).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const DIR = "docs/acceptance/spatial-phase-2-13/measurements";
const SHOTS = "docs/acceptance/spatial-phase-2-13/screenshots";
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const LIMIT = Number(process.env.LIMIT ?? 11);
const OFFSET = Number(process.env.OFFSET ?? 0);
const FULL = process.env.FULL === "1";
const OUT = `${DIR}/portal-targets-${VP[0]}x${VP[1]}${OFFSET ? `-${OFFSET}` : ""}.json`;

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
  const box = await (await page.$(selector))?.boundingBox();
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
      overlappingMouths: field?.overlappingMouths ?? null,
      canvases: document.querySelectorAll("canvas").length,
      field,
    };
  });

const idle = async (page, budget = 30) => {
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const state = await read(page);
    if (!state.transition) return state;
    await page.waitForTimeout(350);
  }
  return read(page);
};

/**
 * Into the world ONCE. The navigator's orb is a toggle, and the earlier probe
 * tapped it on every settle — so every other attempt was clicking a canvas the
 * dashboard was covering, which reads exactly like a targeting failure.
 */
/**
 * The orb is a toggle and the app publishes its real state (HomeStore writes
 * `window.__leluImmersive`). Press it only when the state says the dashboard is
 * up — the earlier harness pressed it blindly on every settle, which turned the
 * world OFF on alternate attempts and looked exactly like a targeting failure.
 */
/**
 * The state is published on the control itself (SpatialNav renders
 * `data-immersive` from HomeStore). `window.__leluImmersive` is NOT set in this
 * build, so trusting it made the harness press the toggle on every attempt.
 */
const immersive = (page) =>
  page.evaluate(
    () => document.querySelector(".lsn-orb")?.getAttribute("data-immersive") === "true",
  );

const ensureImmersive = async (page) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await immersive(page)) return true;
    const box = await (await page.$(".lsn-orb"))?.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(2000);
  }
  return immersive(page);
};

/** Wait until the camera has stopped moving: two consecutive reads agree. */
const settleStable = async (page, budget = 26) => {
  let previous = null;
  let state = await idle(page);
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const screens = (state.field?.portals ?? []).map((portal) => `${portal.screen.x},${portal.screen.y}`);
    if (previous && screens.length === previous.length) {
      const moved = screens.reduce((max, entry, index) => {
        const [x, y] = entry.split(",").map(Number);
        const [px, py] = previous[index].split(",").map(Number);
        return Math.max(max, Math.hypot(x - px, y - py));
      }, 0);
      if (moved < 2 && !state.transition) return state;
    }
    previous = screens;
    await page.waitForTimeout(350);
    state = await idle(page);
  }
  return state;
};

const enterWorld = async (page) => {
  await clickSelector(page, '[data-spatial-control="core"]');
  await page.waitForTimeout(3000);
  const inWorld = await ensureImmersive(page);
  await page.waitForTimeout(1500);
  const state = await settleStable(page);
  return {
    ...state,
    immersive: inWorld,
    onScreen: (state.field?.portals ?? []).filter((portal) => portal.onScreen).length,
  };
};

/** Return to the Core without touching the immersive toggle. */
const settleCore = async (page) => {
  await clickSelector(page, '[data-spatial-control="core"]');
  await page.waitForTimeout(2200);
  // A flight can drop the dashboard back up; the next click must still meet the
  // canvas, so re-enter the world if the app says it is not immersive.
  await ensureImmersive(page);
  return settleStable(page);
};

/** A bare-canvas point the renderer attributes to exactly this portal. */
const resolvePoint = (page, portal) =>
  page.evaluate(
    ({ x0, y0, id }) => {
      const field = window.__leluPortalField?.();
      const width = field?.viewport?.width ?? window.innerWidth;
      const height = field?.viewport?.height ?? window.innerHeight;
      let blocked = null;
      for (let r = 0; r <= 140; r += 5) {
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
          const x = Math.round(x0 + dx);
          const y = Math.round(y0 + dy);
          if (x < 2 || y < 2 || x > width - 2 || y > height - 2) continue;
          const pick = window.__leluPortalPick?.(x, y);
          if (pick && pick.portalId === id) {
            const element = document.elementFromPoint(x, y);
            const tag = element?.tagName ?? null;
            // The pointer must meet the canvas that DRAWS the field: the page
            // has several canvases, and a click on any other one proves nothing.
            const drawn = field?.canvas?.selector ? document.querySelector(field.canvas.selector) : null;
            const onGenesis = Boolean(drawn && element === drawn);
            if (tag === "CANVAS" && onGenesis) return { x, y, pick, tag, onGenesis };
            blocked = { x, y, pick, tag, onGenesis };
          }
        }
      }
      return blocked ? { ...blocked, blockedBy: blocked.tag } : null;
    },
    { x0: portal.screen.x, y0: portal.screen.y, id: portal.id },
  );

const attempt = async (page, portal, label) => {
  const point = await resolvePoint(page, portal);
  if (!point || point.tag !== "CANVAS") {
    return {
      id: portal.id,
      destination: portal.destination,
      meshName: portal.meshName,
      hitMeshName: portal.hitMeshName,
      screen: portal.screen,
      error: "no bare-canvas point resolves to this portal",
      point,
      matches: false,
    };
  }
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(900);
  const during = await read(page);
  const landed = await idle(page);
  if (label) await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-${label}.png` }).catch(() => {});
  return {
    id: portal.id,
    destination: portal.destination,
    meshName: portal.meshName,
    hitMeshName: portal.hitMeshName,
    screen: portal.screen,
    clickPoint: { x: point.x, y: point.y },
    hitMeshReportedByRaycaster: point.pick?.name ?? null,
    selectedAfterClick: during.selected,
    resolvedDestination: during.destination,
    transition: during.transition,
    landed,
    matches: landed === portal.destination && during.destination === portal.destination,
  };
};

mkdirSync(SHOTS, { recursive: true });
const browser = await launch();
const result = {
  mission: "5.4B.1",
  viewport: { width: VP[0], height: VP[1] },
  device: "Chromium headless, SwiftShader software compositor (NOT real-device performance)",
  base: BASE,
  offset: OFFSET,
  errors: [],
};
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
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: "*{backdrop-filter:none !important;}" }).catch(() => {});

  const base = await enterWorld(page);
  result.canvases = base.canvases;
  result.onScreen = base.onScreen;
  result.field = {
    registryCount: base.field?.registryCount,
    placedCount: base.field?.placedCount,
    drawnCount: base.field?.drawnCount,
    duplicates: base.field?.duplicates,
    collisions: base.field?.collisions,
    overlappingMouths: base.field?.overlappingMouths,
    onScreen: (base.field?.portals ?? []).filter((portal) => portal.onScreen).length,
  };
  result.portals = (base.field?.portals ?? []).map((portal) => ({
    id: portal.id,
    destination: portal.destination,
    builtin: portal.builtin,
    meshName: portal.meshName,
    hitMeshName: portal.hitMeshName,
    hitRadius: portal.hitRadius,
    screen: portal.screen,
    onScreen: portal.onScreen,
    drawn: portal.drawn,
    hitDrawn: portal.hitDrawn,
  }));
  await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-targets-field.png` }).catch(() => {});

  const targets = (base.field?.portals ?? []).filter((portal) => portal.onScreen);
  const slice = targets.slice(OFFSET, OFFSET + LIMIT);
  result.attempts = [];
  for (const portal of slice) {
    const label = portal.destination === "files" || portal.destination === "studio" ? `target-${portal.destination}` : null;
    result.attempts.push(await attempt(page, portal, label));
    await settleCore(page);
  }

  if (FULL) {
    // Rapid repeat on one portal: the second click must not open a second flight
    // or land somewhere else.
    const rapidBase = await settleCore(page);
    const first = (rapidBase.field?.portals ?? []).find((portal) => portal.onScreen);
    const point = first ? await resolvePoint(page, first) : null;
    if (first && point?.tag === "CANVAS") {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(60);
      await page.mouse.click(point.x, point.y);
      const during = await read(page);
      const after = await idle(page);
      result.rapid = {
        id: first.id,
        destination: first.destination,
        during: { transition: during.transition, destination: during.destination },
        landed: after.scene,
        matches: after.scene === first.destination,
        canvases: after.canvases,
      };
    }

    // Selection while a transition is already running: refused, not rebased.
    const conflictBase = await settleCore(page);
    const running = (conflictBase.field?.portals ?? []).filter((portal) => portal.onScreen);
    if (running.length >= 2) {
      const a = await resolvePoint(page, running[0]);
      const other = running.find((portal) => portal.destination !== running[0].destination);
      const b = other ? await resolvePoint(page, other) : null;
      if (a?.tag === "CANVAS" && b?.tag === "CANVAS") {
        await page.mouse.click(a.x, a.y);
        await page.waitForTimeout(120);
        const inFlight = await read(page);
        await page.mouse.click(b.x, b.y);
        const after = await idle(page);
        result.conflict = {
          first: running[0].destination,
          second: other.destination,
          inFlight: { transition: inFlight.transition, destination: inFlight.destination },
          landed: after.scene,
          keptFirst: after.scene === running[0].destination,
        };
      }
    }

    // Reload: the same identity must still be where it was, and still aimable.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6500);
    await dismissGate(page);
    await page.waitForTimeout(2000);
    const reloaded = await settleCore(page);
    const before = targets.find((portal) => portal.destination === "files");
    const now = (reloaded.field?.portals ?? []).find((portal) => portal.destination === "files");
    result.reload = {
      before: before ? { id: before.id, screen: before.screen } : null,
      after: now ? { id: now.id, screen: now.screen } : null,
      sameIdentity: Boolean(before && now && before.id === now.id),
      screenDelta: before && now ? Math.hypot(before.screen.x - now.screen.x, before.screen.y - now.screen.y) : null,
      attempts: now ? [await attempt(page, now, "target-after-reload")] : [],
    };
  }
} catch (error) {
  result.failure = String(error).slice(0, 400);
}
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

// A merged summary across slices keeps the acceptance matrix readable.
const mergedPath = `${DIR}/portal-targets-summary.json`;
const merged = existsSync(mergedPath) ? JSON.parse(readFileSync(mergedPath, "utf8")) : { runs: [] };
merged.runs = merged.runs.filter((run) => run.output !== OUT);
merged.runs.push({
  output: OUT,
  viewport: result.viewport,
  field: result.field,
  attempts: (result.attempts ?? []).map((entry) => ({
    id: entry.id,
    destination: entry.destination,
    selectedAfterClick: entry.selectedAfterClick,
    resolvedDestination: entry.resolvedDestination,
    landed: entry.landed,
    matches: entry.matches,
  })),
  rapid: result.rapid ?? null,
  conflict: result.conflict ?? null,
  reload: result.reload ? { sameIdentity: result.reload.sameIdentity, screenDelta: result.reload.screenDelta, matches: result.reload.attempts?.[0]?.matches ?? null } : null,
});
writeFileSync(mergedPath, `${JSON.stringify(merged, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      out: OUT,
      field: result.field,
      attempts: (result.attempts ?? []).map((entry) => ({
        destination: entry.destination,
        selected: entry.selectedAfterClick,
        resolved: entry.resolvedDestination,
        landed: entry.landed,
        matches: entry.matches,
        error: entry.error,
      })),
      rapid: result.rapid,
      conflict: result.conflict,
      reload: result.reload ? { sameIdentity: result.reload.sameIdentity, delta: result.reload.screenDelta } : null,
      failure: result.failure,
    },
    null,
    1,
  ),
);
await browser.close();
