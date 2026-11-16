/**
 * Mission 5.3 — portal lifecycle, one short browser session per phase.
 *
 * The 5.2 lesson holds: a long session with a panel over the live canvas
 * eventually traps the software compositor. Each phase therefore boots its own
 * browser, does one experiment, and writes its result immediately, so a crash
 * costs one phase rather than the whole run.
 *
 *   PHASE=create|remove|chat|transitions node .../probe-lifecycle.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT = process.env.OUT ?? "docs/acceptance/spatial-phase-2-12/measurements/lifecycle.json";
const SHOTS = "docs/acceptance/spatial-phase-2-12/screenshots";
const KEY = "lelu.lelu.spatial.portals.v1";
const PHASE = process.env.PHASE ?? "create";

const ARGS = [
  "--no-sandbox",
  "--headless=new",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-unsafe-swiftshader",
];

const read = (page) =>
  page.evaluate(
    ({ key }) => {
      const raw = localStorage.getItem(key);
      let list = [];
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        list = [];
      }
      const probe = window.__leluSpatialProbe?.() ?? null;
      return {
        present: typeof raw === "string",
        count: list.length,
        portals: list.map((entry) => ({
          id: entry?.id,
          destination: entry?.destination,
          label: entry?.label,
          createdBy: entry?.createdBy,
        })),
        duplicates: list.length - new Set(list.map((entry) => entry?.id)).size,
        scene: document.body.dataset.spatialScene ?? null,
        canvases: document.querySelectorAll("canvas").length,
        nodes: probe?.nodes ?? null,
        heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    },
    { key: KEY },
  );

const dismissGate = (page) =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((entry) =>
      (entry.textContent ?? "").toLowerCase().includes("continue without an account"),
    );
    if (!button) return false;
    button.click();
    return true;
  });

async function clickControl(page, name) {
  const button = await page.$(`[data-spatial-control="${name}"]`);
  const box = button ? await button.boundingBox() : null;
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

const boot = async (browser) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
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

const toCosmos = async (page) => {
  await page.evaluate(() => {
    const button = document.querySelector('[data-spatial-scene="cosmos"]');
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(9000);
};

const openPanel = async (page) => {
  await clickControl(page, "portals");
  try {
    await page.waitForSelector("[data-portal-panel]", { timeout: 18000 });
    return true;
  } catch {
    return false;
  }
};

const createViaPanel = async (page, destination, name) => {
  await page.selectOption("[data-portal-destination]", destination);
  await page.fill("[data-portal-name]", name);
  await page.click("[data-portal-create]");
  await page.waitForTimeout(1200);
  return (await page.locator("[data-portal-notice]").textContent())?.slice(0, 200) ?? null;
};

function save(phase, data) {
  const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { phases: {} };
  current.at = new Date().toISOString();
  current.base = BASE;
  current.phases = { ...current.phases, [phase]: data };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(current, null, 2)}\n`);
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const result = { phase: PHASE, errors: [] };

try {
  const page = await boot(browser);
  page.on("pageerror", (error) => result.errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push(`console: ${message.text()}`.slice(0, 200));
  });

  if (PHASE === "create") {
    result.mount = await read(page);
    await toCosmos(page);
    result.atCosmos = await read(page);
    await page.screenshot({ path: `${SHOTS}/1440x900-01-ring-cosmos.png` }).catch(() => {});

    result.panelOpened = await openPanel(page);
    if (result.panelOpened) {
      await page.screenshot({ path: `${SHOTS}/1440x900-02-portal-panel.png` }).catch(() => {});
      result.notice = {
        first: await createViaPanel(page, "files", "Client files"),
        second: await createViaPanel(page, "projects", "Sprint board"),
      };
      result.afterCreate = await read(page);
      await page.screenshot({ path: `${SHOTS}/1440x900-03-created.png` }).catch(() => {});
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    result.afterReload = await read(page);
  }

  if (PHASE === "remove") {
    result.mount = await read(page);
    result.panelOpened = await openPanel(page);
    if (result.panelOpened) {
      result.notice = await createViaPanel(page, "media", "Cutting room");
      result.afterCreate = await read(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7000);
      result.afterReload = await read(page);
      await dismissGate(page);
      await page.waitForTimeout(2000);
      result.panelReopened = await openPanel(page);
      const target = result.afterReload?.portals?.find((entry) => entry.label === "Cutting room");
      result.removalTarget = target?.id ?? null;
      if (target) {
        await page.click(`[data-portal-remove="${target.id}"]`);
        await page.waitForTimeout(1200);
        result.removalNotice =
          (await page.locator("[data-portal-notice]").textContent())?.slice(0, 200) ?? null;
      }
      result.afterRemove = await read(page);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    result.afterRemoveReload = await read(page);
  }

  if (PHASE === "chat") {
    result.mount = await read(page);
    result.chatOpened = await clickControl(page, "chat");
    await page.waitForTimeout(3500);
    result.chat = await page.evaluate(() => {
      const candidates = [
        "[data-lelu-chat-window]",
        "[data-lelu-surface]",
        "[data-lelu-dialogue-scroll]",
        "[data-lelu-composer]",
      ];
      const selector = candidates.find((entry) => document.querySelector(entry)) ?? null;
      if (!selector) return { selector: null };
      const element = document.querySelector(selector);
      element.dataset.phase12tag = "kept";
      return {
        selector,
        tag: element.dataset.phase12tag,
        text: (element.textContent ?? "").slice(0, 120),
      };
    });
    await page.screenshot({ path: `${SHOTS}/1440x900-05-chat.png` }).catch(() => {});
    await page.evaluate(() => window.__leluSpatial?.travel?.("files"));
    await page.waitForTimeout(7000);
    result.afterTravel = await read(page);
    await page.evaluate(() => window.__leluSpatial?.travel?.("core"));
    await page.waitForTimeout(8000);
    result.afterReturn = await read(page);
    result.chatAfterReturn = await page.evaluate((selector) => {
      if (!selector) return { selector: null };
      const element = document.querySelector(selector);
      return {
        selector,
        present: Boolean(element),
        sameNode: element?.dataset.phase12tag === "kept",
        text: (element?.textContent ?? "").slice(0, 120),
      };
    }, result.chat.selector);
  }

  if (PHASE === "transitions") {
    result.mount = await read(page);
    const heapBefore = result.mount.heapMb;
    const destinations = ["cosmos", "studio", "files", "projects", "cosmos", "studio", "media", "agents", "core", "cosmos"];
    const series = [];
    for (const destination of destinations) {
      await page.evaluate((target) => window.__leluSpatial?.travel?.(target), destination);
      await page.waitForTimeout(1500);
      series.push(await read(page));
    }
    await page.evaluate(() => window.__leluSpatial?.travel?.("core"));
    await page.waitForTimeout(4000);
    const finalState = await read(page);
    result.transitions = {
      count: series.length,
      maxCanvases: Math.max(...series.map((entry) => entry.canvases)),
      minCanvases: Math.min(...series.map((entry) => entry.canvases)),
      maxNodes: Math.max(...series.map((entry) => entry.nodes ?? 0)),
      portalCounts: [...new Set(series.map((entry) => entry.count))],
      maxDuplicates: Math.max(...series.map((entry) => entry.duplicates)),
      heapBeforeMb: heapBefore,
      heapAfterMb: finalState.heapMb,
      final: { scene: finalState.scene, canvases: finalState.canvases, count: finalState.count },
    };
  }
} catch (error) {
  result.failure = String(error).slice(0, 300);
}

save(PHASE, result);
console.log(JSON.stringify(result, null, 1).slice(0, 3000));
await browser.close();
