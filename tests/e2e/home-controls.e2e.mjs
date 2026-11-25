/**
 * ==========================================================
 * LÉLU — HOME CONTROLS DO WHAT THEY SAY (browser regression, Mission 3.7)
 *
 *   node tests/e2e/home-controls.e2e.mjs <base-url> <out-dir>
 *
 * MEASURED: tapping every Home control in the real app (real touch events)
 * found two that looked tappable and did nothing:
 *   - Search in the bottom bar sends ⌘K, but the command palette (and its
 *     listener) was mounted only in the top chrome, which Home and a
 *     full-screen chat do not render;
 *   - Weather kept "Use my location" after a refused location (always the
 *     case over plain http in Safari), and did nothing once a forecast showed.
 *
 * Checks at iPhone SE, iPhone 15, iPhone 15 Pro Max and a desktop window:
 *   1. Search opens the palette, with its input focused;
 *   2. a palette command runs (Open Settings opens Settings);
 *   3. exactly one palette opens (on Home and, on desktop, inside a panel);
 *   4. tapping Weather with location refused shows the reason.
 * Exit code 1 if any check fails. Writes report.json and screenshots.
 * ==========================================================
 */

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LAUNCH = process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {};
const BASE = process.argv[2] ?? "http://127.0.0.1:4173";
const OUT = path.resolve(process.argv[3] ?? "home-controls-e2e");
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: "iphone-se", device: devices["iPhone SE"] },
  { name: "iphone-15", device: devices["iPhone 15"] ?? { ...devices["iPhone 13"], viewport: { width: 393, height: 659 } } },
  { name: "iphone-15-pro-max", device: devices["iPhone 15 Pro Max"] ?? { ...devices["iPhone 13"], viewport: { width: 430, height: 739 } } },
  { name: "desktop", device: { viewport: { width: 1440, height: 900 } } },
];
const PALETTE = 'input[placeholder="Type a command or workspace…"]';

const checks = [];
const record = (view, name, ok, detail = "") => {
  checks.push({ view, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${view}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function tap(page, locator, touch) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function home(browser, device) {
  const ctx = await browser.newContext({ ...device, permissions: [] }); // location refused, as over http
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector("[data-lelu-home]", { timeout: 30_000 });
  await page.waitForTimeout(4_000);
  return { ctx, page };
}

const browser = await chromium.launch(LAUNCH);
try {
  for (const { name, device } of VIEWS) {
    const touch = Boolean(device.hasTouch);

    // 1–3: Search → palette → command
    let { ctx, page } = await home(browser, device);
    const search = page.getByRole("button", { name: "Search (⌘K)" });
    if (await search.count()) {
      await tap(page, search, touch);
      await page.waitForTimeout(800);
      const open = await page.locator(PALETTE).count();
      const focused = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), PALETTE);
      record(name, "Search opens the command palette", open === 1, `${open} palette(s)`);
      record(name, "the palette's input has focus", focused);
      await page.keyboard.type("Open Settings");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);
      const panel = await page.evaluate(() => document.querySelector("[data-testid=lelu-companion]")?.dataset.panel);
      record(name, "a palette command runs (Open Settings)", panel === "settings", `panel=${panel}`);
      await page.screenshot({ path: path.join(OUT, `${name}-palette-command.png`) });
    } else {
      record(name, "Search is in the bottom bar", false, "no Search button on Home");
    }
    await ctx.close();

    if (!touch) {
      ({ ctx, page } = await home(browser, device));
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(700);
      record(name, "⌘K on Home opens exactly one palette", (await page.locator(PALETTE).count()) === 1);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await tap(page, page.getByRole("button", { name: "Settings", exact: true }).first(), false);
      await page.waitForTimeout(1_500);
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(700);
      record(name, "⌘K inside a panel opens exactly one palette", (await page.locator(PALETTE).count()) === 1);
      await ctx.close();
    }

    // 4: Weather explains a refused location
    ({ ctx, page } = await home(browser, device));
    const weather = page.locator(".lch-weather").first();
    if (await weather.count()) {
      const before = (await weather.innerText()).replace(/\s+/g, " ");
      await tap(page, weather, touch);
      await page.waitForTimeout(1_500);
      const after = (await weather.innerText()).replace(/\s+/g, " ");
      const answered = after !== before || !/Use my location/.test(after);
      record(name, "tapping Weather visibly answers", answered, `"${before}" → "${after}"`);
    } else {
      record(name, "Weather tile on Home", false, "not rendered");
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, checks, failed: failed.length }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
