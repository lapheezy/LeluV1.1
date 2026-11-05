/**
 * Phase 1 acceptance — Cosmos modes + chat windows as module windows.
 *
 * Drives the real production build over HTTP with a real browser, at the two
 * phone sizes the plan names (390×844, 430×932) and one desktop size
 * (1440×900), and records what it saw:
 *
 *   1. home (before opening the Universe)
 *   2. workspace mode: opaque Cosmos, chat windows open through the host
 *   3. drag + resize a chat window (desktop), z-order, second window, close one
 *   4. floating mode: the live scene shows through (`.lcu-cosmos` removed)
 *   5. closing the Universe keeps the windows
 *   6. reopening it finds them again
 *   7. reload: the mode and the windows come back
 *
 * Writes screenshots + results.json into the output directory and exits
 * non-zero when a step fails or when any pageerror was raised.
 *
 * Usage: node scripts/verify-cosmos-modes.mjs [baseUrl] [outDir]
 */

import { chromium } from "playwright";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT = process.argv[3] ?? process.env.OUT_DIR ?? "docs/acceptance/session-1/phase-1";

const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "430x932", width: 430, height: 932, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
];

const results = { base: BASE, startedAt: new Date().toISOString(), sizes: {}, pageerrors: [], consoleErrors: [] };
const failures = [];

function check(name, ok, detail) {
  results.current.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures.push(`${results.current.size} / ${name}: ${detail ?? "failed"}`);
  return Boolean(ok);
}

async function shot(page, index, label) {
  const file = path.join(OUT, `${results.current.size}_${index}_${label}.png`);
  await page.screenshot({ path: file });
  results.current.screenshots.push(path.basename(file));
  return file;
}

async function openUniverse(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector(".lcu", { state: "visible", timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function windowCount(page) {
  return page.locator('[data-lelu-module-window^="chat:"]').count();
}

async function openAWindow(page) {
  const before = await windowCount(page);
  const card = page.locator(".lcu-card:not(.lcu-card-new)").first();
  if ((await card.count()) > 0) await card.click();
  else await page.click(".lcu-card-new");
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-lelu-module-window^="chat:"]').length > n,
    before,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
}

async function run(browser, size) {
  results.current = { size: size.name, checks: [], screenshots: [], notes: [] };
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => results.pageerrors.push(`${size.name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") results.consoleErrors.push(`${size.name}: ${message.text().slice(0, 300)}`);
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-home]", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, 1, "home");

  /* ---- 2. workspace mode ---- */
  await openUniverse(page);
  const cosmosVisible = await page.locator(".lcu-cosmos").isVisible();
  check("workspace mode paints the opaque Cosmos", cosmosVisible, "`.lcu-cosmos` is not visible");
  check(
    "workspace mode covers the viewport",
    await page.evaluate(() => {
      const box = document.querySelector(".lcu")?.getBoundingClientRect();
      return Boolean(box && box.width >= window.innerWidth - 1 && box.height >= window.innerHeight - 1);
    }),
    "the Universe does not cover the screen",
  );
  check(
    "workspace mode is the persisted default",
    (await page.getAttribute(".lcu", "data-cosmos")) === "workspace",
    `data-cosmos=${await page.getAttribute(".lcu", "data-cosmos")}`,
  );
  await shot(page, 2, "workspace");

  /* ---- 3. chat windows are module windows ---- */
  await openAWindow(page);
  check("opening a chat opens a chat module window", (await windowCount(page)) === 1, `${await windowCount(page)} windows`);
  check(
    "the window uses the shared module chrome",
    (await page.locator("[data-lelu-module-chrome^=\"chat:\"]").count()) === 1,
    "no shared host chrome on the chat window",
  );
  check(
    "the window body is the shared window frame",
    (await page.locator("[data-lelu-module-window] .genesis-window-frame").count()) >= 1,
    "GenesisWindowFrame is not the window body",
  );
  check(
    "one title bar only (frame renders body-only inside the host)",
    (await page.locator("[data-lelu-module-window^=\"chat:\"] [data-lelu-panel-heading]").count()) === 1,
    "the frame drew its own header inside the host window",
  );
  await shot(page, 3, "chat_window");

  if (!size.touch) {
    const target = page.locator('[data-lelu-module-window^="chat:"]').first();
    const before = await target.boundingBox();
    const chrome = page.locator('[data-lelu-module-chrome^="chat:"]').first();
    const grip = await chrome.boundingBox();
    if (before && grip) {
      await page.mouse.move(grip.x + 80, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + 150, grip.y + grip.height / 2 + 50, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await target.boundingBox();
      check("dragging the title bar moves the window", after && (Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20), `moved ${before.x},${before.y} -> ${after?.x},${after?.y}`);
    }
    const handle = page.locator('[data-lelu-module-window^="chat:"] [title="Resize"]').first();
    const sizeBefore = await target.boundingBox();
    const hb = await handle.boundingBox();
    if (sizeBefore && hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x - 70, hb.y - 60, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const sizeAfter = await target.boundingBox();
      check("dragging the corner resizes the window", sizeAfter && (Math.abs(sizeAfter.width - sizeBefore.width) > 20 || Math.abs(sizeAfter.height - sizeBefore.height) > 20), `resized ${sizeBefore.width}x${sizeBefore.height} -> ${sizeAfter?.width}x${sizeAfter?.height}`);
    }
  } else {
    const box = await page.locator('[data-lelu-module-window^="chat:"]').first().boundingBox();
    results.current.notes.push(`phone window docks at ${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)} ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
    check("the chat window fits the phone viewport", Boolean(box && box.width <= size.width && box.x >= -1), "window overflows the phone viewport");
  }

  await openAWindow(page);
  check("a second chat opens a second window", (await windowCount(page)) === 2, `${await windowCount(page)} windows`);
  await page.locator('[data-lelu-module-chrome^="chat:"]').last().click();
  check(
    "clicking a window raises it (z-order)",
    await page.evaluate(() => {
      const wins = [...document.querySelectorAll('[data-lelu-module-window^="chat:"]')];
      const z = wins.map((el) => Number(getComputedStyle(el).zIndex) || 0);
      return z.length >= 2 && z[z.length - 1] >= Math.max(...z);
    }),
    "the last window is not the top one",
  );
  await shot(page, 4, "two_windows");
  await page.locator('[data-lelu-module-chrome^="chat:"] button[aria-label^="Close"]').last().click();
  await page.waitForTimeout(300);
  check("closing one window leaves the other", (await windowCount(page)) === 1, `${await windowCount(page)} windows`);

  /* ---- 4. floating mode ---- */
  await page.click(".lcu-mode");
  await page.waitForTimeout(300);
  check(
    "floating mode removes the opaque Cosmos",
    (await page.locator(".lcu-cosmos").count()) === 0 || !(await page.locator(".lcu-cosmos").isVisible()),
    "`.lcu-cosmos` still paints",
  );
  check("floating mode is recorded on the root", (await page.getAttribute(".lcu", "data-cosmos")) === "floating", "data-cosmos is not floating");
  check("the chat window is still there while floating", (await windowCount(page)) === 1, `${await windowCount(page)} windows`);
  await shot(page, 5, "floating");

  /* ---- 5. closing the Universe keeps the windows ---- */
  await page.click('button[aria-label="Close Chat Universe"]');
  await page.waitForTimeout(400);
  check("the chat window survives closing the Universe", (await windowCount(page)) === 1, `${await windowCount(page)} windows after close`);
  await shot(page, 6, "universe_closed");

  /* ---- 6. reopening finds them ---- */
  await openUniverse(page);
  check("reopening the Universe keeps the open set", (await windowCount(page)) === 1, `${await windowCount(page)} windows after reopen`);
  await shot(page, 7, "universe_reopened");

  /* ---- 7. reload: mode + windows persist ---- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check("the mode persists across a reload", (await page.getAttribute(".lcu", "data-cosmos")) === "floating", `data-cosmos=${await page.getAttribute(".lcu", "data-cosmos")}`);
  check("the chat window comes back after a reload", (await windowCount(page)) === 1, `${await windowCount(page)} windows after reload`);
  await shot(page, 8, "after_reload");

  await context.close();
}

await mkdir(OUT, { recursive: true });

/* The before set is the Phase 0 baseline at this branch's HEAD-1: copy it in
   so the phase directory holds both halves of the comparison. */
const beforeDir = path.join(OUT, "before");
const phase0 = path.join(path.dirname(OUT), "phase-0");
await mkdir(beforeDir, { recursive: true });
try {
  for (const file of await readdir(phase0)) {
    if (file.endsWith(".png")) await copyFile(path.join(phase0, file), path.join(beforeDir, file));
  }
} catch (error) {
  results.notes = [`could not copy the Phase 0 baseline: ${error.message}`];
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    results.sizes[size.name] = await run(browser, size);
  }
} finally {
  await browser.close();
}

results.finishedAt = new Date().toISOString();
results.failures = failures;
await writeFile(path.join(OUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);

console.log(`pageerrors: ${results.pageerrors.length}`);
for (const error of results.pageerrors) console.log(`  ${error}`);
console.log(`console errors: ${results.consoleErrors.length}`);
console.log(`checks: ${Object.values(results.sizes).reduce((n, s) => n + s.checks.length, 0)}`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(results.pageerrors.length === 0 && failures.length === 0 ? 0 : 1);
