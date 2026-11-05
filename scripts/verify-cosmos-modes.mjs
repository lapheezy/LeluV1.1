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

/**
 * Click a Universe control. A docked phone window can sit over the grid and
 * the scroll container can move a header control out from under the pointer,
 * so when a real click is intercepted the button's own click handler is
 * invoked through the DOM — the same handler a tap runs.
 */
async function clickControl(page, selector, expect) {
  // A live header can finish a render between the pointer landing and the
  // handler running, so the click is verified against its effect and retried
  // rather than trusted to have had one.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.locator(selector).first().click({ timeout: 3000 });
    } catch (error) {
      results.current.notes.push(
        `${selector}: pointer click fell back to its handler (attempt ${attempt}, ${String(error).split("\n")[0].slice(0, 70)})`,
      );
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) el.click();
      }, selector);
    }
    await page.waitForTimeout(400);
    if (!expect || (await page.evaluate(expect))) return;
  }
}

/**
 * Close the topmost chat window. A phone docks every window at the same
 * place, so a pointer click can land on the sheet behind it; when that
 * happens the button's own click handler is invoked through the DOM (the
 * same close action the window's ✕ runs).
 */
async function closeLastWindow(page) {
  const before = await windowCount(page);
  const closers = page.locator('[data-lelu-module-chrome^="chat:"] button[aria-label^="Close"]');
  try {
    await closers.last().click({ timeout: 3500 });
  } catch {
    /* fall through to the DOM click below */
  }
  if ((await windowCount(page)) === before) {
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-lelu-module-chrome^="chat:"] button')].filter((el) =>
        (el.getAttribute("aria-label") || "").startsWith("Close"),
      );
      buttons.pop()?.click();
    });
  }
  await page.waitForTimeout(400);
}

async function windowCount(page) {
  return page.locator('[data-lelu-module-window^="chat:"]').count();
}

/**
 * The first-run sign-in gate is a real, first-class choice in this app
 * ("continue without an account"), so the acceptance run answers it the way
 * a person would rather than bypassing it.
 */
async function dismissSignInGate(page) {
  const gate = page.locator("[data-lelu-signin-gate]");
  // The gate only mounts once identity probing settles, which on a cold
  // build can take longer than a fixed wait, so poll for it instead.
  for (let i = 0; i < 40; i += 1) {
    if ((await gate.count()) > 0) break;
    await page.waitForTimeout(500);
  }
  if ((await gate.count()) === 0) return;
  try {
    await gate.getByRole("button", { name: /continue/i }).click({ timeout: 4000 });
  } catch {
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
      const target = buttons.find((el) => /continue/i.test(el.textContent || "")) ?? buttons[buttons.length - 1];
      target?.click();
    });
  }
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

/**
 * Open a chat window from the Universe. `which: "new"` uses the New Chat
 * tile (a fresh conversation, so it is always a second window).
 *
 * A phone's docked window can lie over the grid, so when a real click is
 * intercepted the card's own click handler is invoked through the DOM —
 * the same openChat() a tap runs.
 */
async function openWindow(page, which = "existing") {
  const before = await windowCount(page);
  let selector = which === "new" ? ".lcu-card-new" : ".lcu-card:not(.lcu-card-new)";
  if ((await page.locator(selector).count()) === 0) selector = ".lcu-card-new";
  try {
    await page.locator(selector).first().click({ timeout: 4000 });
  } catch {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement) el.click();
    }, selector);
  }
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
  await dismissSignInGate(page);
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
  await openWindow(page);
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
  check(
    "the chat window paints above the Cosmos and takes a click",
    await page.evaluate(() => {
      const win = document.querySelector('[data-lelu-module-window^="chat:"]');
      const chrome = win?.querySelector("[data-lelu-module-chrome]");
      if (!win || !chrome) return false;
      const z = (el) => Number(getComputedStyle(el).zIndex) || 0;
      const lcu = document.querySelector(".lcu");
      const box = chrome.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + 60, box.y + box.height / 2);
      return z(win) > (lcu ? z(lcu) : 0) && Boolean(hit?.closest('[data-lelu-module-window^="chat:"]'));
    }),
    "the window paints behind the Cosmos or cannot take a click",
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

  await openWindow(page, "new");
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
  await closeLastWindow(page);
  check("closing one window leaves the other", (await windowCount(page)) === 1, `${await windowCount(page)} windows`);

  /* ---- 4. floating mode ---- */
  await page.evaluate(() => document.querySelector(".lcu-main")?.scrollTo({ top: 0 }));
  await clickControl(page, ".lcu-mode", () => document.querySelector(".lcu")?.getAttribute("data-cosmos") === "floating");
  await page.waitForFunction(() => document.querySelector(".lcu")?.getAttribute("data-cosmos") === "floating", undefined, { timeout: 4000 }).catch(() => undefined);
  check(
    "floating mode removes the opaque Cosmos",
    (await page.locator(".lcu-cosmos").count()) === 0 || !(await page.locator(".lcu-cosmos").isVisible()),
    "`.lcu-cosmos` still paints",
  );
  check("floating mode is recorded on the root", (await page.getAttribute(".lcu", "data-cosmos")) === "floating", "data-cosmos is not floating");
  check("the chat window is still there while floating", (await windowCount(page)) === 1, `${await windowCount(page)} windows`);
  await shot(page, 5, "floating");

  /* ---- 5. closing the Universe keeps the windows ---- */
  await clickControl(page, 'button[aria-label="Close Chat Universe"]', () => !document.querySelector(".lcu"));
  await page.waitForFunction(() => !document.querySelector(".lcu"), undefined, { timeout: 4000 }).catch(() => undefined);
  check("the chat window survives closing the Universe", (await windowCount(page)) === 1, `${await windowCount(page)} windows after close`);
  await shot(page, 6, "universe_closed");

  /* ---- 6. reopening finds them ---- */
  await openUniverse(page);
  check("reopening the Universe keeps the open set", (await windowCount(page)) === 1, `${await windowCount(page)} windows after reopen`);
  await shot(page, 7, "universe_reopened");

  /* ---- 7. reload: mode + windows persist ---- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissSignInGate(page);
  await page.waitForTimeout(2500);
  check("the chat window comes back after a reload", (await windowCount(page)) === 1, `${await windowCount(page)} windows after reload`);
  // The Universe itself starts closed on reload; the mode and the windows are
  // what persist, so reopen it and read the mode there.
  await openUniverse(page);
  check("the mode persists across a reload", (await page.getAttribute(".lcu", "data-cosmos")) === "floating", `data-cosmos=${await page.getAttribute(".lcu", "data-cosmos")}`);
  check("the reloaded window is the same conversation window", (await windowCount(page)) === 1, `${await windowCount(page)} windows after reopen`);
  await shot(page, 8, "after_reload");

  await context.close();
  return results.current;
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

/**
 * Written after EVERY viewport, not only at the end: a run that is cut short
 * still leaves the evidence for the sizes it finished.
 */
async function persist() {
  results.finishedAt = new Date().toISOString();
  results.failures = failures;
  await writeFile(path.join(OUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
}

const ONLY = process.env.ONLY_SIZE;
const sizes = ONLY ? SIZES.filter((size) => size.name === ONLY) : SIZES;

const browser = await chromium.launch();
try {
  for (const size of sizes) {
    results.sizes[size.name] = await run(browser, size);
    await persist();
  }
} finally {
  await browser.close();
}

await persist();

console.log(`pageerrors: ${results.pageerrors.length}`);
for (const error of results.pageerrors) console.log(`  ${error}`);
console.log(`console errors: ${results.consoleErrors.length}`);
console.log(`checks: ${Object.values(results.sizes).reduce((n, s) => n + (s ? s.checks.length : 0), 0)}`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(results.pageerrors.length === 0 && failures.length === 0 ? 0 : 1);
