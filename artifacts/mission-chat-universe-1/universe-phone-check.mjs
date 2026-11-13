/**
 * Mission Chat Universe Reinforcement 1 — phone surface check.
 *
 * Drives the real app at phone viewports and measures, from the rendered page:
 *   - the Chat Universe header is on screen and hit-testable while a
 *     conversation opened from the Universe is showing;
 *   - the conversation sheet does not paint over that header;
 *   - the sheet still owns the rest of the visual viewport (composer on screen);
 *   - switching, closing and reopening conversations keeps the header clear.
 *
 * No AI provider is called: no turn is sent.
 *
 * Usage: node artifacts/mission-chat-universe-1/universe-phone-check.mjs [url]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
const TAG = process.env.RUN_TAG ?? "run";
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  ["iPhone portrait", 390, 844],
  ["small Android portrait", 360, 740],
  ["iPhone landscape", 844, 390],
];

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const allErrors = [];

for (const [label, width, height] of VIEWPORTS) {
  console.log(`\n== ${label} (${width}x${height}) ==`);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
    } catch {
      /* storage blocked; reported through the checks */
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console ${message.text().slice(0, 180)}`);
  });

  const metrics = () =>
    page.evaluate(() => {
      // The Universe's own column scrolls (header included); start it at the
      // top so this measures the sheet's placement, not a residual scroll.
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
      const headBox = box(head);
      const hit = headBox ? document.elementFromPoint(headBox.x + headBox.w / 2, headBox.y + headBox.h / 2) : null;
      const card = universe?.querySelector(".lcu-card");
      const cardBox = box(card);
      const cardHit = cardBox ? document.elementFromPoint(cardBox.x + cardBox.w / 2, cardBox.y + cardBox.h / 2) : null;
      return {
        universe: Boolean(universe),
        head: headBox,
        sheet: box(sheet),
        composer: box(sheet?.querySelector("textarea") ?? null),
        headHit: hit ? { tag: hit.tagName.toLowerCase(), inHead: Boolean(hit.closest(".lcu-head")), inSheet: Boolean(hit.closest('[data-lelu-module-window^="chat:"]')) } : null,
        cardHit: cardHit ? { inUniverse: Boolean(cardHit.closest(".lcu")), inSheet: Boolean(cardHit.closest('[data-lelu-module-window^="chat:"]')) } : null,
        closeBtn: Boolean(universe?.querySelector('button[aria-label="Close Chat Universe"]')),
        cards: document.querySelectorAll(".lcu-card:not(.lcu-card-new)").length,
        vv: { w: innerWidth, h: innerHeight, hh: visualViewport?.height ?? innerHeight },
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
    const cards = page.locator(".lcu-card:not(.lcu-card-new)");
    await cards.nth(index).click({ timeout: 8000 });
    await page.waitForSelector('[data-lelu-module-window^="chat:"][data-lelu-fullscreen]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  };

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-lelu-dock], .lcu", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await openUniverse();

    const opened = await metrics();
    record("Universe opens on the phone", opened.universe);

    // Create the first conversation only while nothing covers the Universe.
    if (opened.cards === 0) {
      await page.click('button[aria-label="New chat"]', { timeout: 8000 });
      await page.waitForSelector('[data-lelu-module-window^="chat:"]', { timeout: 10000 });
      await page.waitForTimeout(400);
      await closeSheet();
      await openUniverse();
      await page.click('button[aria-label="New chat"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      await closeSheet();
      await openUniverse();
    }

    const before = await metrics();
    record(
      "Universe header is on screen before opening a conversation",
      Boolean(before.head && before.head.h > 0),
      before.head ? `y=${before.head.y}..${before.head.bottom}` : "no header",
    );

    // 1. Open a conversation FROM the Universe.
    await openCard(0);
    const afterOpen = await metrics();
    await page.screenshot({ path: join(SHOTS, `${TAG}-${label.replace(/\s+/g, "-")}-opened.png`) });
    record("conversation sheet opens", Boolean(afterOpen.sheet), afterOpen.sheet ? `top=${afterOpen.sheet.top} h=${afterOpen.sheet.h}` : "no fullscreen chat sheet");
    record("Universe stays open behind the conversation", afterOpen.universe);
    record("Universe header remains visible", Boolean(afterOpen.head && afterOpen.head.h > 0 && afterOpen.head.top >= 0), afterOpen.head ? `y=${afterOpen.head.y}..${afterOpen.head.bottom}` : "header gone");
    const overlap = afterOpen.head && afterOpen.sheet ? afterOpen.head.bottom - afterOpen.sheet.top : null;
    record(
      "conversation sheet does not paint over the header",
      Boolean(afterOpen.head && afterOpen.sheet && afterOpen.sheet.top >= afterOpen.head.bottom - 1),
      `header bottom=${afterOpen.head?.bottom ?? "-"} sheet top=${afterOpen.sheet?.top ?? "-"} overlap=${overlap ?? "-"}px`,
    );
    record(
      "header controls are hit-testable (not covered)",
      Boolean(afterOpen.headHit && afterOpen.headHit.inHead && !afterOpen.headHit.inSheet),
      afterOpen.headHit ? `hit <${afterOpen.headHit.tag}> inHead=${afterOpen.headHit.inHead} inSheet=${afterOpen.headHit.inSheet}` : "no hit",
    );
    record("Universe close control stays reachable", afterOpen.closeBtn);
    record(
      "conversation still owns the rest of the screen (composer on screen)",
      Boolean(afterOpen.composer && afterOpen.composer.bottom <= afterOpen.vv.hh + 1 && afterOpen.composer.h > 0),
      afterOpen.composer ? `composer ${afterOpen.composer.y}..${afterOpen.composer.bottom} of ${afterOpen.vv.hh}` : "no composer",
    );

    // 2. Switch conversations: close, then open a second card (or a new chat).
    await closeSheet();
    await openUniverse();
    if ((await page.locator(".lcu-card:not(.lcu-card-new)").count()) < 2) {
      await page.click('button[aria-label="New chat"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      await closeSheet();
      await openUniverse();
    }
    const cardsNow = await page.locator(".lcu-card:not(.lcu-card-new)").count();
    if (cardsNow >= 2) await openCard(1);
    const switched = await metrics();
    record(
      "switching conversations keeps the header clear",
      Boolean(switched.head && switched.sheet && switched.sheet.top >= switched.head.bottom - 1),
      `header bottom=${switched.head?.bottom ?? "-"} sheet top=${switched.sheet?.top ?? "-"} cards=${cardsNow}`,
    );

    // 3. Close the conversation, return to the Universe, reopen the same one.
    await closeSheet();
    const closed = await metrics();
    record("closing the conversation returns to the Universe", closed.universe && !closed.sheet, `universe=${closed.universe} sheet=${Boolean(closed.sheet)}`);
    record(
      "Universe cards are usable again after closing",
      Boolean(closed.cardHit && closed.cardHit.inUniverse && !closed.cardHit.inSheet),
      closed.cardHit ? `inUniverse=${closed.cardHit.inUniverse}` : "no card hit",
    );
    await openCard(0);
    const reopened = await metrics();
    record(
      "reopening the same conversation keeps the header clear",
      Boolean(reopened.head && reopened.sheet && reopened.sheet.top >= reopened.head.bottom - 1),
      `header bottom=${reopened.head?.bottom ?? "-"} sheet top=${reopened.sheet?.top ?? "-"}`,
    );

    // 4. Scrolling inside the conversation leaves the header where it is.
    const scrolled = await page.evaluate(() => {
      const content = document.querySelector('[data-lelu-module-window^="chat:"][data-lelu-fullscreen] [data-lelu-module-content]');
      if (content) content.scrollTop = 220;
      return Boolean(content);
    });
    await page.waitForTimeout(250);
    const afterScroll = await metrics();
    record(
      "scrolling the conversation leaves the header in place",
      scrolled && Boolean(afterScroll.head && afterScroll.head.top >= 0 && afterScroll.sheet && afterScroll.sheet.top >= afterScroll.head.bottom - 1),
      `header y=${afterScroll.head?.y ?? "-"} sheet top=${afterScroll.sheet?.top ?? "-"}`,
    );
    await page.screenshot({ path: join(SHOTS, `${TAG}-${label.replace(/\s+/g, "-")}-reopened.png`) });
  } catch (error) {
    record(`harness completed at ${label}`, false, String(error?.message ?? error).split("\n")[0].slice(0, 160));
  } finally {
    allErrors.push(...errors.map((line) => `${label}: ${line}`));
    await context.close();
  }
}

await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (allErrors.length) {
  console.log("\nconsole/page errors:");
  for (const line of [...new Set(allErrors)].slice(0, 20)) console.log(`  - ${line}`);
}

writeFileSync(
  join(HERE, `${TAG}-universe-phone-check.json`),
  JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results, errors: [...new Set(allErrors)], passed: results.length - failed.length, total: results.length }, null, 2),
);
process.exit(failed.length === 0 ? 0 : 1);
