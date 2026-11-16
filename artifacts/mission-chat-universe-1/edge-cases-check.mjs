/**
 * Mission Chat Universe Reinforcement 1 — safe-area and keyboard checks.
 *
 * The phone harness proves the sheet clears the Universe header. This one
 * covers the two conditions the fix depends on but a plain headless run never
 * produces:
 *   - a non-zero top safe area (notched device, `viewport-fit=cover`);
 *   - a shrunken visual viewport (on-screen keyboard);
 * plus close/reopen and the composer still taking input afterwards.
 *
 * The safe area is injected through CDP `Emulation.setSafeAreaInsetsOverride`,
 * which is what makes `env(safe-area-inset-top)` resolve inside the page.
 * The keyboard is approximated by shrinking the viewport, because headless
 * Chromium cannot raise a real system keyboard; both shrink
 * `visualViewport.height`, which is what the sheet sizes itself from.
 *
 * Usage: node artifacts/mission-chat-universe-1/edge-cases-check.mjs [url]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(() => {
  try {
    window.localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
  } catch {
    /* storage blocked */
  }
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console ${message.text().slice(0, 160)}`);
});

const cdp = await context.newCDPSession(page);

const metrics = () =>
  page.evaluate(() => {
    document.querySelector(".lcu-main")?.scrollTo({ top: 0 });
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const visible = (el) => Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
    const universe = [...document.querySelectorAll(".lcu")].find(visible) ?? null;
    const head = universe?.querySelector(".lcu-head") ?? null;
    const sheet = [...document.querySelectorAll('[data-lelu-module-window^="chat:"]')].find((el) => el.getAttribute("data-lelu-fullscreen") !== null) ?? null;
    const composer = sheet?.querySelector("textarea") ?? null;
    const headBox = box(head);
    // The header's own centre: elementFromPoint(x, y), not (y, y).
    const hit = headBox ? document.elementFromPoint(headBox.x + headBox.w / 2, headBox.top + headBox.h / 2) : null;
    return {
      universe: Boolean(universe),
      head: headBox,
      sheet: box(sheet),
      composer: box(composer),
      headHit: hit ? hit.tagName.toLowerCase() : null,
      headHitInHead: hit ? Boolean(hit.closest(".lcu-head")) : null,
      headHitInSheet: hit ? Boolean(hit.closest('[data-lelu-module-window^="chat:"]')) : null,
      vv: { w: innerWidth, h: innerHeight, hh: Math.round(visualViewport?.height ?? innerHeight) },
    };
  });

const openUniverse = async () => {
  const shown = await page.evaluate(() => Boolean([...document.querySelectorAll(".lcu")].find((el) => el.getClientRects().length)));
  if (shown) return;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector(".lcu", { state: "visible", timeout: 15000 });
  await page.waitForTimeout(350);
};
const closeSheet = async () => {
  const close = page.locator('[data-lelu-module-window^="chat:"] button[aria-label^="Close"]').first();
  if (await close.count()) {
    await close.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
};
const openCard = async (index) => {
  await page.locator(".lcu-card:not(.lcu-card-new)").nth(index).click({ timeout: 8000 });
  await page.waitForSelector('[data-lelu-module-window^="chat:"][data-lelu-fullscreen]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-lelu-dock], .lcu", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await openUniverse();

  if ((await page.locator(".lcu-card:not(.lcu-card-new)").count()) === 0) {
    await page.click('button[aria-label="New chat"]', { timeout: 8000 });
    await page.waitForTimeout(800);
    await closeSheet();
    await openUniverse();
  }
  await openCard(0);

  // A. Baseline: no safe area, full height.
  const base = await metrics();
  record(
    "baseline: header clear of the sheet",
    base.head && base.sheet && base.sheet.top === 88 && base.head.bottom === 80,
    `head ${base.head?.top}..${base.head?.bottom} sheet ${base.sheet?.top}..${base.sheet?.bottom}`,
  );

  // B. Notched device: 47px top safe area, 34px bottom.
  let safeAreaSupported = true;
  try {
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 47, left: 0, bottom: 34, right: 0 },
    });
  } catch (error) {
    safeAreaSupported = false;
    record("safe area override available", false, String(error).slice(0, 120));
  }
  await page.waitForTimeout(600);
  if (safeAreaSupported) {
    const safe = await metrics();
    await page.screenshot({ path: join(SHOTS, "review-safe-area-390x844.png") });
    record(
      "safe area moves the Universe header down, not under the sheet",
      Boolean(safe.head && safe.head.top === 10 + 47 && safe.head.bottom === 80 + 47),
      safe.head ? `head ${safe.head.top}..${safe.head.bottom}` : "no header",
    );
    record(
      "sheet starts below the header with a top safe area",
      Boolean(safe.sheet && safe.sheet.top === 88 + 47),
      safe.sheet ? `sheet top=${safe.sheet.top} (expected ${88 + 47})` : "no sheet",
    );
    record(
      "header stays hit-testable with a top safe area",
      safe.headHitInHead === true && safe.headHitInSheet === false,
      `hit <${safe.headHit}> inHead=${safe.headHitInHead} inSheet=${safe.headHitInSheet}`,
    );
    record(
      "composer still reachable above a bottom safe area",
      Boolean(safe.composer && safe.composer.h > 0 && safe.composer.bottom <= safe.vv.hh + 1),
      safe.composer ? `composer ${safe.composer.top}..${safe.composer.bottom} of ${safe.vv.hh}` : "no composer",
    );
  }

  // C. Keyboard: shrink the visual viewport, as an on-screen keyboard does.
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0 } }).catch(() => {});
  await page.setViewportSize({ width: 390, height: 480 });
  await page.waitForTimeout(700);
  const kbd = await metrics();
  await page.screenshot({ path: join(SHOTS, "review-keyboard-390x480.png") });
  record(
    "keyboard: sheet follows the shrunken visual viewport",
    Boolean(kbd.sheet && kbd.sheet.bottom === 480 && kbd.sheet.top === 88),
    kbd.sheet ? `sheet ${kbd.sheet.top}..${kbd.sheet.bottom} of ${kbd.vv.hh}` : "no sheet",
  );
  record(
    "keyboard: header still on screen",
    Boolean(kbd.head && kbd.head.top === 10 && kbd.head.bottom === 80),
    kbd.head ? `head ${kbd.head.top}..${kbd.head.bottom}` : "no header",
  );
  record(
    "keyboard: composer stays above the keyboard edge",
    Boolean(kbd.composer && kbd.composer.h > 0 && kbd.composer.bottom <= kbd.vv.hh + 1),
    kbd.composer ? `composer ${kbd.composer.top}..${kbd.composer.bottom} of ${kbd.vv.hh}` : "no composer",
  );

  // D. Short landscape-with-keyboard style viewport.
  await page.setViewportSize({ width: 390, height: 380 });
  await page.waitForTimeout(700);
  const tight = await metrics();
  record(
    "very short viewport: sheet and composer stay on screen",
    Boolean(tight.sheet && tight.sheet.bottom === 380 && tight.composer && tight.composer.bottom <= 381),
    tight.sheet ? `sheet ${tight.sheet.top}..${tight.sheet.bottom} composer ${tight.composer?.top}..${tight.composer?.bottom}` : "no sheet",
  );

  // E. Restore the phone, close and reopen: the clearance must survive.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await closeSheet();
  const closed = await metrics();
  record("close: conversation sheet is gone", !closed.sheet, closed.sheet ? `sheet ${closed.sheet.top}..${closed.sheet.bottom}` : "no sheet");
  record(
    "close: Universe header still in place",
    Boolean(closed.head && closed.head.top === 10 && closed.head.bottom === 80),
    closed.head ? `head ${closed.head.top}..${closed.head.bottom}` : "no header",
  );
  await openUniverse();
  await openCard(0);
  const reopened = await metrics();
  record(
    "reopen: sheet clears the header again",
    Boolean(reopened.head && reopened.sheet && reopened.sheet.top === 88 && reopened.head.bottom === 80),
    reopened.sheet ? `head ${reopened.head?.top}..${reopened.head?.bottom} sheet ${reopened.sheet.top}..${reopened.sheet.bottom}` : "no sheet",
  );

  // F. The composer still takes input on the inset sheet.
  const input = page.locator('[data-lelu-module-window^="chat:"] textarea').first();
  let typed = "";
  if (await input.count()) {
    await input.click({ timeout: 5000 }).catch(() => {});
    await input.fill("mission review check", { timeout: 5000 }).catch(() => {});
    typed = await input.inputValue().catch(() => "");
    await input.fill("", { timeout: 5000 }).catch(() => {});
  }
  const afterTyping = await metrics();
  record("composer accepts input", typed === "mission review check", `value="${typed}"`);
  record(
    "typing does not move the header or the sheet",
    Boolean(afterTyping.head && afterTyping.sheet && afterTyping.head.bottom === 80 && afterTyping.sheet.top === 88),
    `head ${afterTyping.head?.bottom} sheet ${afterTyping.sheet?.top}`,
  );
  await page.screenshot({ path: join(SHOTS, "review-after-typing-390x844.png") });
} catch (error) {
  record("harness completed without throwing", false, String(error).slice(0, 240));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const summary = {
  ranAt: new Date().toISOString(),
  base: BASE,
  passed,
  total: results.length,
  results,
  errors,
};
writeFileSync(join(HERE, "review-edge-cases.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${passed}/${results.length} checks passed`);
if (errors.length) {
  console.log("\nconsole/page errors:");
  for (const error of new Set(errors)) console.log(`  - ${error}`);
}
if (passed !== results.length) process.exitCode = 1;
