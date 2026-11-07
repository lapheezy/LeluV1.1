/**
 * Mission 5.3 — the same lifecycle at every required viewport.
 *
 * For each size: a fresh browser context, mount, create through the documented
 * interface channel (the one the UI and the agent tool both use), reload,
 * confirm the identical identity returns, remove, reload, confirm it stays
 * gone — then capture the ring.
 *
 *   node docs/acceptance/spatial-phase-2-12/scripts/probe-viewports.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT = process.env.OUT ?? "docs/acceptance/spatial-phase-2-12/measurements/viewports.json";
const SHOTS = "docs/acceptance/spatial-phase-2-12/screenshots";
const KEY = "lelu.lelu.spatial.portals.v1";

const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "1440x900", width: 1440, height: 900, mobile: false },
  { name: "1920x1080", width: 1920, height: 1080, mobile: false },
];

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
      return {
        present: typeof raw === "string",
        count: list.length,
        mine: list.filter((entry) => entry?.createdBy === "user" && entry?.label === "Field notes"),
        duplicates: list.length - new Set(list.map((entry) => entry?.id)).size,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
        scene: document.body.dataset.spatialScene ?? null,
        canvases: document.querySelectorAll("canvas").length,
      };
    },
    { key: KEY },
  );

const channel = (page, event, reply, detail) =>
  page.evaluate(
    async ({ event, reply, detail }) => {
      const requestId = `vp-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve) => {
        const onReply = (incoming) => {
          if (incoming.detail?.requestId !== requestId) return;
          window.removeEventListener(reply, onReply);
          resolve(incoming.detail);
        };
        window.addEventListener(reply, onReply);
        window.dispatchEvent(new CustomEvent(event, { detail: { ...detail, requestId } }));
        setTimeout(() => resolve({ timeout: true }), 8000);
      });
    },
    { event, reply, detail },
  );

mkdirSync(SHOTS, { recursive: true });
const results = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

const flush = () => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2)}\n`);
};

for (const viewport of VIEWPORTS.filter((entry) => !only || only.includes(entry.name))) {
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`.slice(0, 200));
  });
  const record = { viewport: viewport.name, mobile: viewport.mobile, errors };
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(6000);
    record.mount = await read(page);

    record.create = await channel(page, "lelu-portal-create", "lelu-portal-created", {
      destination: "research",
      label: "Field notes",
      workspace: "default",
    });
    record.afterCreate = await read(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    record.afterReload = await read(page);

    if (record.create?.portal?.id) {
      record.remove = await channel(page, "lelu-portal-remove", "lelu-portal-removed", {
        id: record.create.portal.id,
      });
      record.afterRemove = await read(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      record.afterRemoveReload = await read(page);
    }

    // The ring lives in the world view.
    await page.evaluate(() => {
      const button = document.querySelector('[data-spatial-scene="cosmos"]');
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(9000);
    record.atCosmos = await read(page);
    await page.screenshot({ path: `${SHOTS}/${viewport.name}-01-ring-cosmos.png` });
  } catch (error) {
    record.failure = String(error).slice(0, 300);
  }
  results.push(record);
  flush();
  console.log(
    `${viewport.name}: dims=${record.mount?.innerWidth}x${record.mount?.innerHeight} builtin=${record.mount?.count} create_ok=${record.create?.ok} afterCreate=${record.afterCreate?.count ?? "?"} afterReload=${record.afterReload?.count ?? "?"} afterRemoveReload=${record.afterRemoveReload?.count ?? "?"} dup=${record.afterReload?.duplicates ?? "?"} ${record.failure ? `FAILURE ${record.failure}` : ""}`,
  );
  await context.close();
}

flush();
console.log(`wrote: ${OUT}`);
await browser.close();
