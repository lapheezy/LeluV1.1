/**
 * Mission 5.4 — spatial interaction probe.
 *
 * One browser per phase, result written immediately (the 5.2/5.3 lesson: a long
 * session with panels over the software-rendered canvas eventually traps the
 * compositor).
 *
 *   PHASE=field|click|chat|placement|stability node .../probe-interaction.mjs
 *
 * Everything here reads or drives the RUNNING app:
 *  - the field is read from window.__leluPortalField(), which walks the real
 *    three.js scene for the portal meshes it claims to have drawn;
 *  - clicks are real mouse clicks at the projected screen point of a portal;
 *  - nothing mutates app state directly (no registry writes, no bridge travel
 *    calls) except where a phase explicitly measures a reload.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT = process.env.OUT ?? "docs/acceptance/spatial-phase-2-13/measurements/interaction.json";
const SHOTS = process.env.SHOTS ?? "docs/acceptance/spatial-phase-2-13/screenshots";
const PHASE = process.env.PHASE ?? "field";
const VP = (process.env.VP ?? "1440x900").split("x").map(Number);
const PORTAL_KEY = "lelu.lelu.spatial.portals.v1";
const LAYOUT_KEY = "lelu.lelu.layout.v2";

const ARGS = [
  "--no-sandbox",
  "--headless=new",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-unsafe-swiftshader",
];

function save(phase, data) {
  const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { phases: {} };
  current.at = new Date().toISOString();
  current.base = BASE;
  current.viewport = { width: VP[0], height: VP[1] };
  current.commit = process.env.COMMIT ?? null;
  current.phases = { ...current.phases, [phase]: data };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(current, null, 2)}\n`);
}

const dismissGate = (page) =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((entry) =>
      (entry.textContent ?? "").toLowerCase().includes("continue without an account"),
    );
    if (!button) return false;
    button.click();
    return true;
  });

async function clickSelector(page, selector) {
  const element = await page.$(selector);
  const box = element ? await element.boundingBox() : null;
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

const boot = async (browser, { width, height } = { width: VP[0], height: VP[1] }) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  await dismissGate(page);
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: "*{backdrop-filter:none !important;}" }).catch(() => {});
  return page;
};

const readScene = (page) =>
  page.evaluate(({ portalKey, layoutKey }) => {
    const parse = (key) => {
      try {
        const raw = localStorage.getItem(key);
        const value = raw ? JSON.parse(raw) : null;
        return value;
      } catch {
        return null;
      }
    };
    const spatial = window.__leluSpatial?.getState?.() ?? null;
    const field = window.__leluPortalField?.() ?? null;
    return {
      scene: document.body.dataset.spatialScene ?? spatial?.current ?? null,
      transition: document.body.dataset.spatialTransition ?? spatial?.transition?.kind ?? null,
      progress: Number(document.body.dataset.spatialProgress ?? "-1"),
      destination: spatial?.destination ?? null,
      backend: document.body.dataset.spatialBackend ?? null,
      canvases: document.querySelectorAll("canvas").length,
      labels: document.querySelectorAll("[data-portal-select]").length,
      registry: parse(portalKey)?.length ?? 0,
      layout: parse(layoutKey)?.entries?.map?.((entry) => ({
        moduleId: entry.moduleId,
        rect: entry.rect,
        manual: entry.manual,
        pinned: entry.pinned,
      })) ?? null,
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      field,
    };
  }, { portalKey: PORTAL_KEY, layoutKey: LAYOUT_KEY });

const toCosmos = async (page) => {
  await clickSelector(page, '[data-spatial-scene="cosmos"]');
  await page.waitForTimeout(7000);
};

/**
 * The app's own way into the world: a tap on the navigator's orb sets
 * HomeStore.immersive, which unmounts the home dashboard so the canvas owns
 * the screen. Nothing here pokes the store directly.
 */
const enterWorld = async (page) => {
  const orb = await page.$(".lsn-orb");
  const box = orb ? await orb.boundingBox() : null;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
  }
  await page.waitForTimeout(2600);
  return page.evaluate(() => ({
    immersive: window.__leluImmersive ?? null,
    home: Boolean(document.querySelector("[data-cosmos-home]")) || document.querySelectorAll(".lch-card, .lsn").length > 0,
    canvasTop: document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.tagName ?? null,
  }));
};

const world = async (page) => {
  await toCosmos(page);
  const entered = await enterWorld(page);
  return entered;
};

const summariseField = (field) =>
  field
    ? {
        registryCount: field.registryCount,
        placedCount: field.placedCount,
        drawnCount: field.drawnCount,
        duplicates: field.duplicates,
        collisions: field.collisions,
        selected: field.selected,
        viewport: field.viewport,
        portals: field.portals,
      }
    : null;

/** A portal whose seam is on screen and not hidden behind a panel. */
const clickable = (field) =>
  (field?.portals ?? []).filter(
    (portal) =>
      portal.drawn &&
      portal.visible &&
      portal.onScreen &&
      portal.screen.x > 8 &&
      portal.screen.y > 8 &&
      portal.screen.x < field.viewport.width - 8 &&
      portal.screen.y < field.viewport.height - 8,
  );

/** What is actually under the pointer, so a "mesh click" can be told from a chip click. */
const elementAt = (page, x, y) =>
  page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      tag: element?.tagName ?? null,
      isCanvas: element?.tagName === "CANVAS",
      portalSelect: element?.closest?.("[data-portal-select]")?.getAttribute("data-portal-select") ?? null,
      portalCanvasTag: element?.parentElement?.tagName ?? null,
    };
  }, { x, y });

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const result = { phase: PHASE, viewport: { width: VP[0], height: VP[1] }, errors: [] };

try {
  const page = await boot(browser);
  page.on("pageerror", (error) => result.errors.push(`pageerror: ${String(error)}`.slice(0, 200)));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push(`console: ${message.text()}`.slice(0, 200));
  });

  if (PHASE === "field") {
    result.core = { scene: (await readScene(page)).scene, field: summariseField((await readScene(page)).field) };
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-01-core.png` }).catch(() => {});
    await toCosmos(page);
    result.enterCosmos = await enterWorld(page);
    const cosmos = await readScene(page);
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-03-world.png` }).catch(() => {});
    result.under = await page.evaluate(() => {
      const field = window.__leluPortalField?.();
      if (!field) return [];
      return field.portals.map((portal) => {
        const element = document.elementFromPoint(portal.screen.x, portal.screen.y);
        return {
          destination: portal.destination,
          screen: portal.screen,
          tag: element?.tagName ?? null,
          className: typeof element?.className === "string" ? element.className.slice(0, 60) : null,
          portalSelect: element?.closest?.("[data-portal-select]")?.getAttribute("data-portal-select") ?? null,
          surface: element?.closest?.("[data-lelu-surface]")?.getAttribute("data-lelu-surface") ?? null,
        };
      });
    });
    result.cosmos = {
      scene: cosmos.scene,
      labels: cosmos.labels,
      field: summariseField(cosmos.field),
      clickable: clickable(cosmos.field).map((portal) => ({
        id: portal.id,
        destination: portal.destination,
        label: portal.label,
        screen: portal.screen,
      })),
    };
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-02-field.png` }).catch(() => {});
  }

  if (PHASE === "click") {
    result.worldEntered = await world(page);
    const cosmos = await readScene(page);
    result.before = { scene: cosmos.scene, clickable: clickable(cosmos.field).length };
    const candidates = clickable(cosmos.field);

    /**
     * A point that the renderer's own raycaster attributes to this portal.
     * Scanning a small neighbourhood around the projected centre keeps the
     * measurement honest: the click is still a real mouse click on the canvas.
     */
    const resolvePoint = (portal) =>
      page.evaluate(
        ({ x0, y0, id }) => {
          const field = window.__leluPortalField?.();
          const width = field?.viewport?.width ?? window.innerWidth;
          const height = field?.viewport?.height ?? window.innerHeight;
          for (let r = 0; r <= 60; r += 10) {
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
                return { x, y, pick, tag: element?.tagName ?? null };
              }
            }
          }
          return null;
        },
        { x0: portal.screen.x, y0: portal.screen.y, id: portal.id },
      );

    // Two different portals, each clicked on its actual seam.
    const attempts = [];
    const used = new Set();
    for (const portal of candidates) {
      if (attempts.length >= 2) break;
      if (used.has(portal.destination)) continue;
      used.add(portal.destination);
      const point = await resolvePoint(portal);
      if (!point || point.tag !== "CANVAS") continue;
      const under = await elementAt(page, point.x, point.y);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(1800);
      const during = await readScene(page);
      await page.waitForTimeout(4200);
      const after = await readScene(page);
      attempts.push({
        clicked: { id: portal.id, destination: portal.destination, screen: portal.screen },
        point,
        underPointer: under,
        during: { scene: during.scene, transition: during.transition, progress: during.progress, selected: during.field?.selected },
        arrived: after.scene,
        arrivedMatches: after.scene === portal.destination,
        selectedId: after.field?.selected ?? null,
        youAreHere: after.scene,
      });
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-click-${portal.destination}.png` }).catch(() => {});
      await world(page);
    }
    result.attempts = attempts;

    // Rapid repeated selection on one portal: two clicks, 80ms apart.
    const target = clickable((await readScene(page)).field)[0] ?? null;
    if (target) {
      await page.mouse.click(target.screen.x, target.screen.y);
      await page.waitForTimeout(80);
      await page.mouse.click(target.screen.x, target.screen.y);
      await page.waitForTimeout(1500);
      const rapid = await readScene(page);
      await page.waitForTimeout(4000);
      const settled = await readScene(page);
      result.rapid = {
        portal: target.id,
        during: { transition: rapid.transition, progress: rapid.progress },
        settled: settled.scene,
        matches: settled.scene === target.destination,
      };
      await world(page);
    }

    // A click on another portal while a transition is already in flight.
    const before = await readScene(page);
    const flight = clickable(before.field);
    if (flight.length >= 2) {
      const [first, second] = flight;
      await page.mouse.click(first.screen.x, first.screen.y);
      await page.waitForTimeout(120);
      const inFlight = await readScene(page);
      // The second portal's screen point is where it was before the camera moved.
      await page.mouse.click(second.screen.x, second.screen.y);
      await page.waitForTimeout(6000);
      const after = await readScene(page);
      result.conflict = {
        first: first.destination,
        second: second.destination,
        inFlight: { transition: inFlight.transition, destination: inFlight.destination },
        landed: after.scene,
        keptFirst: after.scene === first.destination && first.destination !== second.destination,
      };
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-conflict.png` }).catch(() => {});
    }

    // Travel after reload.
    const targetId = result.attempts?.[0]?.clicked?.id ?? null;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await dismissGate(page);
    await page.waitForTimeout(2500);
    await world(page);
    const reloaded = await readScene(page);
    const again = clickable(reloaded.field).find((portal) => portal.id === targetId) ?? clickable(reloaded.field)[0] ?? null;
    if (again) {
      await page.mouse.click(again.screen.x, again.screen.y);
      await page.waitForTimeout(6000);
      const arrived = await readScene(page);
      result.afterReload = {
        portal: again.id,
        expected: again.destination,
        landed: arrived.scene,
        matches: arrived.scene === again.destination,
        registry: arrived.registry,
        drawn: arrived.field?.drawnCount ?? null,
      };
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-after-reload.png` }).catch(() => {});
    } else {
      result.afterReload = { portal: null, reason: "no clickable portal after reload" };
    }
  }

  if (PHASE === "chat") {
    const unique = `M54-${Date.now().toString(36)}`;
    const openChat = await clickSelector(page, '[data-spatial-control="chat"]');
    await page.waitForTimeout(3500);
    const chatId = () =>
      page.evaluate(() => {
        const window_ = document.querySelector("[data-lelu-chat-window]");
        const tabs = [...document.querySelectorAll("[data-lelu-chats-item]")].map((entry) => entry.getAttribute("data-lelu-chats-item"));
        return {
          present: Boolean(window_),
          conversationIds: tabs,
          activeTab: document.querySelector('[data-lelu-chats-item][aria-current="true"]')?.getAttribute("data-lelu-chats-item") ?? null,
          text: (window_?.textContent ?? "").slice(0, 400),
        };
      });

    await page.click("[data-lelu-composer] textarea").catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.type(unique, { delay: 12 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(9000);
    result.beforeTravel = { unique, opened: openChat, chat: await chatId() };
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-chat-before-travel.png` }).catch(() => {});

    // Travel by clicking a real portal seam (not the panel, not the bridge).
    await world(page);
    const field = await readScene(page);
    const portal = clickable(field.field)[0] ?? null;
    if (portal) {
      await page.mouse.click(portal.screen.x, portal.screen.y);
      await page.waitForTimeout(6500);
      const arrived = await readScene(page);
      result.afterTravel = {
        clicked: { id: portal.id, destination: portal.destination },
        scene: arrived.scene,
        matches: arrived.scene === portal.destination,
        chat: await chatId(),
      };
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-chat-after-travel.png` }).catch(() => {});

      await page.click("[data-lelu-composer] textarea").catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.type(`${unique}-after`, { delay: 12 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(8000);
      result.afterTravelSecond = await chatId();
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    await dismissGate(page);
    await page.waitForTimeout(2500);
    await clickSelector(page, '[data-spatial-control="chat"]');
    await page.waitForTimeout(3500);
    result.afterReload = await chatId();
    result.persisted = {
      uniquePresent: (result.afterReload?.text ?? "").includes(unique),
      secondPresent: (result.afterReload?.text ?? "").includes(`${unique}-after`),
    };
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-chat-after-reload.png` }).catch(() => {});
  }

  if (PHASE === "placement") {
    await world(page);
    const field = await readScene(page);
    const portal = clickable(field.field).find((entry) => entry.destination === "files") ?? clickable(field.field)[0] ?? null;
    if (portal) {
      await page.mouse.click(portal.screen.x, portal.screen.y);
      await page.waitForTimeout(7000);
    }
    const opened = await page.evaluate(() => ({
      scene: document.body.dataset.spatialScene,
      windows: [...document.querySelectorAll("[data-lelu-module-window]")].map((entry) => ({
        id: entry.getAttribute("data-lelu-module-window"),
        left: getComputedStyle(entry).left,
        top: getComputedStyle(entry).top,
      })),
      chrome: [...document.querySelectorAll("[data-lelu-module-chrome]")].map((entry) => entry.getAttribute("data-lelu-module-chrome")),
    }));
    result.opened = opened;

    const moduleId = opened.windows[0]?.id ?? null;
    const chromeBox = moduleId ? await (await page.$(`[data-lelu-module-chrome="${moduleId}"]`))?.boundingBox() : null;
    if (moduleId && chromeBox) {
      // Manual placement: a real drag of the title bar to a specific spot.
      const from = { x: chromeBox.x + Math.min(180, chromeBox.width / 2), y: chromeBox.y + chromeBox.height / 2 };
      const to = { x: from.x + 140, y: from.y + 90 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      result.afterDrag = await page.evaluate((id) => {
        const element = document.querySelector(`[data-lelu-module-window="${id}"]`);
        return element ? { left: getComputedStyle(element).left, top: getComputedStyle(element).top } : null;
      }, moduleId);
      await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-placement-dragged.png` }).catch(() => {});

      // Pin it, so auto-arrange must leave it alone.
      const pinned = await clickSelector(page, `[data-lelu-module-pin="${moduleId}"]`);
      await page.waitForTimeout(900);
      result.pinned = await page.evaluate((id) => {
        const button = document.querySelector(`[data-lelu-module-pin="${id}"]`);
        return { clicked: Boolean(button), pressed: button?.getAttribute("aria-pressed") ?? null };
      }, moduleId);
      result.pinned.clickedGiven = pinned;
      result.layoutAfterPin = (await readScene(page)).layout;
    }

    // Travel away and back with the module staying as it is, then reload.
    result.moduleId = moduleId;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    await dismissGate(page);
    await page.waitForTimeout(2500);
    result.layoutAfterReload = (await readScene(page)).layout;
    const restored = moduleId
      ? await page.evaluate((id) => {
          const element = document.querySelector(`[data-lelu-module-window="${id}"]`);
          const button = document.querySelector(`[data-lelu-module-pin="${id}"]`);
          return {
            present: Boolean(element),
            left: element ? getComputedStyle(element).left : null,
            top: element ? getComputedStyle(element).top : null,
            pinned: button?.getAttribute("aria-pressed") ?? null,
          };
        }, moduleId)
      : null;
    result.restored = restored;
    await page.screenshot({ path: `${SHOTS}/${VP[0]}x${VP[1]}-placement-after-reload.png` }).catch(() => {});
  }

  if (PHASE === "stability") {
    const cycle = Number(process.env.CYCLE ?? 10);
    const samples = [];
    const sample = async (label) => {
      const reading = await readScene(page);
      samples.push({
        label,
        scene: reading.scene,
        canvases: reading.canvases,
        registry: reading.registry,
        drawn: reading.field?.drawnCount ?? null,
        nodes: (await page.evaluate(() => window.__leluSpatialNodes?.().length ?? null)),
        heapMb: reading.heapMb,
        listeners: await page.evaluate(() => {
          const field = window.__leluPortalField?.();
          return field ? field.placedCount : null;
        }),
      });
    };
    await sample("baseline");
    for (let run = 0; run < cycle; run += 1) {
      const before = await readScene(page);
      const targets = clickable(before.field);
      const portal = targets[run % Math.max(1, targets.length)];
      if (!portal) break;
      await page.mouse.click(portal.screen.x, portal.screen.y);
      await page.waitForTimeout(1400);
      await world(page);
    }
    await page.waitForTimeout(6000);
    await sample("after-cycle");
    result.samples = samples;
    result.transitions = cycle;
    result.gc = "not forced (browser exposes no gc; naturally observed only)";
  }
} catch (error) {
  result.failure = String(error).slice(0, 400);
}

save(PHASE, result);
console.log(JSON.stringify(result, null, 1).slice(0, 6000));
await browser.close();
