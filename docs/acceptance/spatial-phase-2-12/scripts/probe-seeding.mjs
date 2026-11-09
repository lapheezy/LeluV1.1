/**
 * Mission 5.3 — why is the built-in ring never persisted?
 *
 * probe-persistence.mjs showed storage is writable and a created portal
 * survives a reload, yet after mount the portal key is absent. So `seedRing`
 * (which is supposed to write one record per built-in destination) either
 * never mounts or never reaches storage.
 *
 * This probe walks the real surface — dismiss the identity gate, travel to the
 * world view where the portal field lives — and reads storage at each step.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT = process.env.OUT ?? "docs/acceptance/spatial-phase-2-12/measurements/seeding-probe.json";
const KEY = "lelu.lelu.spatial.portals.v1";

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
      let list = null;
      try {
        list = raw ? JSON.parse(raw) : null;
      } catch {
        list = "unparsable";
      }
      return {
        present: typeof raw === "string",
        count: Array.isArray(list) ? list.length : 0,
        ids: Array.isArray(list) ? list.map((entry) => entry?.id) : [],
        scene: document.body.dataset.spatialScene ?? null,
        canvases: document.querySelectorAll("canvas").length,
        navButtons: document.querySelectorAll("[data-spatial-scene]").length,
        sceneControls: document.querySelectorAll('[data-spatial-control="core"]').length,
      };
    },
    { key: KEY },
  );

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    errors.push(`${message.type()}: ${message.text()}`);
  }
});

const steps = {};
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
steps.after_mount = await read(page);

// The identity gate covers the world until it is dismissed.
const dismissed = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  const target = buttons.find((button) =>
    (button.textContent ?? "").toLowerCase().includes("continue without an account"),
  );
  if (!target) return false;
  target.click();
  return true;
});
steps.gate_dismissed = dismissed;
await page.waitForTimeout(7000);
steps.after_gate = await read(page);

// Open the rail and travel to the world view the portal field belongs to.
const navigated = await page.evaluate(() => {
  const cosmos = document.querySelector('[data-spatial-scene="cosmos"]');
  if (!cosmos) return "no-cosmos-button";
  cosmos.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return "clicked";
});
steps.cosmos_click = navigated;
await page.waitForTimeout(9000);
steps.after_cosmos = await read(page);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
steps.after_reload = await read(page);

const payload = { at: new Date().toISOString(), base: BASE, key: KEY, steps, errors: errors.slice(0, 25) };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
for (const [name, value] of Object.entries(steps)) {
  console.log(`${name}: ${JSON.stringify(value)}`);
}
console.log(`errors: ${JSON.stringify(errors.slice(0, 8))}`);
console.log(`wrote: ${OUT}`);

await browser.close();
