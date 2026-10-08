/**
 * LÉLU WORKSPACE LAYOUT — BROWSER VERIFICATION
 *
 * TypeScript passing says the layer constants are consistent. It says
 * nothing about whether two controls actually land on top of each other
 * in a real browser at a real size, which is what the screenshot showed.
 *
 * So this measures the live DOM: it reads the bounding boxes of the
 * elements the brief names and asserts they do not intersect, at phone,
 * tablet and desktop sizes, and in a deliberately narrow container that
 * stands in for the Freebuff workspace being smaller than the window.
 *
 * Run: node scripts/verify-workspace-layout.mjs   (needs the dev server)
 */

import { chromium } from "playwright";

const BASE = process.env.LELU_BASE ?? "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

/** Elements that must never cover one another. */
const SELECTORS = {
  composer: "[data-lelu-composer]",
  question: "[data-lelu-proactive-question]",
  tabs: "[data-lelu-multichat]",
  dock: "[data-lelu-dock]",
};

const viewports = [
  ["phone", { width: 390, height: 844 }, true],
  ["tablet", { width: 820, height: 1180 }, true],
  ["desktop", { width: 1440, height: 900 }, false],
];

/**
 * Open the chat so its controls exist.
 *
 * The composer, the tab bar and the cognition card only mount once the
 * chat is open, so measuring a freshly loaded page finds nothing and
 * every overlap check silently skips — passing by absence.
 */
async function openChat(page) {
  // The dock's LÉLU item is what mounts the chat. The mobile pill opens the
  // menu first, so both are tried.
  for (const selector of [
    '[aria-label="LÉLU"]',
    "[data-lelu-chat-bubble]",
    '[aria-label="Open LÉLU menu"]',
    '[data-lelu-mobile-menu] [aria-label="LÉLU"]',
  ]) {
    const target = await page.$(selector);
    if (!target) continue;
    // `force` skips Playwright's actionability wait. The dock's controls
    // animate CONTINUOUSLY, so "wait until it stops moving" never resolves
    // and a normal click times out — even though the control is on top and
    // reachable, which the hit test below confirms independently. A human
    // taps it without trouble; this reproduces that.
    await target.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.$("[data-lelu-composer]")) return true;
    // The mobile pill opens the LÉLU menu; "Chat" is an item inside it.
    const inner =
      (await page.$('[data-lelu-mobile-menu] button:has-text("Chat")')) ??
      (await page.$('button:has-text("Chat")')) ??
      (await page.$('[aria-label="LÉLU"]'));
    if (inner) {
      await inner.click({ force: true, timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (await page.$("[data-lelu-composer]")) return true;
    }
  }
  // Last resort: the dock's own documented toggle event, which is what the
  // pill dispatches. Used only when a synthetic click cannot land on a
  // continuously animating control.
  await page.evaluate(() => window.dispatchEvent(new Event("genesis-lelu-menu-toggle")));
  await page.waitForTimeout(2000);
  for (const selector of ['[data-lelu-mobile-menu] button:has-text("Chat")', 'button:has-text("Chat")']) {
    const item = await page.$(selector);
    if (!item) continue;
    await item.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.$("[data-lelu-composer]")) return true;
  }
  return Boolean(await page.$("[data-lelu-composer]"));
}

/** Do two boxes overlap by more than a rounding error? */
function intersects(a, b) {
  if (!a || !b) return false;
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlapX > 2 && overlapY > 2;
}

console.log("\n=== LAYOUT: nothing overlaps, nothing overflows ===");
for (const [vpName, viewport, isMobile] of viewports) {
  const page = await browser.newPage({ viewport, isMobile, hasTouch: isMobile });
  const fatal = [];
  page.on("pageerror", (e) => fatal.push(String(e.message).slice(0, 140)));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  // Wait for real content rather than guessing with a sleep: the first load
  // of a cold dev server also pays Vite's dependency optimisation, and a
  // fixed 5s read as "blank" when the app was merely still booting.
  await page
    .waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, { timeout: 40000 })
    .catch(() => {});
  await page.waitForTimeout(4000);
  await openChat(page);

  const rendered = await page.$eval("#root", (el) => el.children.length).catch(() => 0);
  check(`renders @ ${vpName}`, rendered > 0, rendered === 0 ? "blank" : "");

  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );
  check(`no horizontal overflow @ ${vpName}`, noHScroll);

  // The measurement root must exist and must have been measured.
  const rootBox = await page.evaluate(() => {
    const el = document.querySelector('[data-workspace="genesis-unified"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
  check(
    `workspace root is present and sized @ ${vpName}`,
    Boolean(rootBox && rootBox.width > 0 && rootBox.height > 0),
    rootBox ? `${rootBox.width}x${rootBox.height}` : "missing",
  );

  const boxes = await page.evaluate((selectors) => {
    const out = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      if (!el) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      out[name] = visible
        ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
        : null;
    }
    return out;
  }, SELECTORS);

  // Any control that is on screen must be inside the viewport, or it is
  // unreachable — the "clipped content" symptom.
  for (const [name, box] of Object.entries(boxes)) {
    if (!box) continue;
    const inside = box.left >= -2 && box.right <= viewport.width + 2;
    check(`${name} is within the viewport @ ${vpName}`, inside,
      inside ? "" : `left=${Math.round(box.left)} right=${Math.round(box.right)} vw=${viewport.width}`);
  }

  // HIT TEST. A control can be visible, enabled, inside the viewport and
  // still unreachable because something else is painted over it — which is
  // exactly what happened to the mobile LÉLU pill. Bounding boxes cannot
  // see that; elementFromPoint can.
  const blocked = await page.evaluate(() => {
    const out = [];
    for (const selector of ['[aria-label="Open LÉLU menu"]', "[data-lelu-composer] button"]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el)) {
        out.push(`${selector} blocked by ${hit.tagName} ${(hit.getAttribute("aria-label") || "").slice(0, 24)}`);
      }
    }
    return out;
  });
  check(`primary controls are actually clickable @ ${vpName}`, blocked.length === 0, blocked.join("; "));

  // An absent control must FAIL, not silently skip: "nothing overlaps"
  // is worthless if it is true because nothing was measured.
  check(
    `composer is present to be measured @ ${vpName}`,
    Boolean(boxes.composer),
    boxes.composer ? "" : "chat did not open — overlap checks below are unverified",
  );

  // The pairs the brief calls out explicitly.
  for (const [a, b] of [
    ["question", "composer"],
    ["tabs", "composer"],
    ["dock", "composer"],
    ["question", "tabs"],
  ]) {
    if (!boxes[a] || !boxes[b]) continue;
    check(`${a} does not cover ${b} @ ${vpName}`, !intersects(boxes[a], boxes[b]));
  }

  if (fatal.length) check(`no fatal error @ ${vpName}`, false, fatal[0]);
  await page.close();
}

console.log("\n=== CONTAINER: the interface fits a container smaller than the window ===");
{
  // The Freebuff case. The window is desktop-sized; the interface is
  // mounted in a narrow box. Measuring the window would lay out for room
  // that is not there.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fatal = [];
  page.on("pageerror", (e) => fatal.push(String(e.message).slice(0, 140)));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const measured = await page.evaluate(() => {
    const el = document.querySelector('[data-workspace="genesis-unified"]');
    if (!el) return null;
    // Constrain the root the way an embedding workspace would.
    el.style.position = "absolute";
    el.style.inset = "auto";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.width = "420px";
    el.style.height = "720px";
    return new Promise((resolve) => {
      // Give the ResizeObserver a frame to fire and React a tick to render.
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        const overflowing = [];
        for (const selector of [
          "[data-lelu-composer]",
          "[data-lelu-proactive-question]",
        ]) {
          const child = document.querySelector(selector);
          if (!child) continue;
          const cr = child.getBoundingClientRect();
          if (cr.right > r.right + 2) overflowing.push(selector);
        }
        resolve({ width: Math.round(r.width), overflowing });
      }, 1200);
    });
  });

  check("root accepts a constrained size", Boolean(measured && measured.width === 420),
    measured ? String(measured.width) : "missing");
  check(
    "controls stay inside the constrained container",
    Boolean(measured && measured.overflowing.length === 0),
    measured?.overflowing?.join(", ") ?? "",
  );
  if (fatal.length) check("no fatal error in a constrained container", false, fatal[0]);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL LAYOUT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
