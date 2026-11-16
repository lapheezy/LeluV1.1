/**
 * MISSION 3.1 · GATE A — chat entry acceptance, real pointer input.
 *
 * The gate (`[data-lelu-signin-gate]`) mounts AFTER first paint at z-index
 * 600 with pointer-events:auto, so a driver that checks for it too early
 * sees nothing, then clicks into a modal. Every path here waits for the
 * gate to settle, dismisses it, and proves it is gone before clicking.
 *
 * argv: [pathIds…]   env: VIEWPORT=WxH  MOBILE=1
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-1";
const [VW, VH] = (process.env.VIEWPORT ?? "1440x900").split("x").map(Number);
const MOBILE = process.env.MOBILE === "1";
const ALL = [
  { id: "home-now-open-chat", selector: '[aria-label="What LÉLU is doing — open chat"]' },
  { id: "navigator-summon", selector: '[data-spatial-control="chat"]' },
  { id: "travel-conversation", selector: 'button[aria-label="Travel to Conversation"]' },
  { id: "apps-chat-tile", selector: '[data-primary="true"]' },
];
const want = process.argv.slice(2);
const paths = want.length ? ALL.filter((p) => want.includes(p.id)) : ALL;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const results = [];
for (const p of paths) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: MOBILE, isMobile: MOBILE });
  const page = await ctx.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
  // Wait for the gate to SETTLE (present with its dismiss control, or truly absent once home is up).
  let gateSeen = false, gateDismissed = false, gateSettleMs = null, homeUp = false;
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => {
      const g = document.querySelector("[data-lelu-signin-gate]");
      const b = g ? [...g.querySelectorAll("button")].find((x) => /continue/i.test(x.textContent ?? "")) : null;
      return { gate: Boolean(g), dismiss: Boolean(b), home: Boolean(document.querySelector("[data-lelu-home]")) };
    });
    if (s.gate && s.dismiss) { gateSeen = true; gateSettleMs = Date.now() - t0; await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...g.querySelectorAll("button")].find((x) => /continue/i.test(x.textContent ?? ""))?.click(); }); gateDismissed = true; await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20000 }).catch(() => {}); break; }
    if (s.home && !s.gate) { homeUp = true; break; }
    await page.waitForTimeout(400);
  }
  await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const gateAfter = await page.evaluate(() => Boolean(document.querySelector("[data-lelu-signin-gate]")));
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { present: true, cx, cy, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, reachable: Boolean(top && (top === el || el.contains(top))), topAria: top?.getAttribute?.("aria-label") ?? top?.tagName ?? null };
  }, p.selector).catch((e) => ({ evalError: String(e).slice(0, 120) }));
  let clickOutcome = "not-attempted", clickError = null;
  if (hit.present) {
    try { await page.mouse.click(hit.cx, hit.cy); clickOutcome = "pointer-click"; }
    catch (e) { clickOutcome = "click-failed"; clickError = String(e).split("\n")[0].slice(0, 200); }
  } else clickOutcome = "selector-absent";
  const tClick = Date.now();
  let dialogMs = null;
  try { await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 12000 }); dialogMs = Date.now() - tClick; } catch { dialogMs = -1; }
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => {
    const ta = document.querySelector('.lcu textarea');
    return {
      universeDialog: Boolean(document.querySelector('[role="dialog"][aria-label="Chat Universe"]')),
      universeRoot: Boolean(document.querySelector(".lcu")),
      homeStillRendered: Boolean(document.querySelector("[data-lelu-home]")),
      htmlUniverseFlag: document.documentElement.dataset.leluUniverse ?? null,
      composer: ta ? { present: true, disabled: ta.disabled, placeholder: ta.placeholder, ariaLabel: ta.getAttribute("aria-label") } : { present: false },
      chatWindows: document.querySelectorAll("[data-lelu-chat-window]").length,
      markedComposers: document.querySelectorAll("[data-lelu-composer]").length,
      cards: document.querySelectorAll(".lcu-card").length,
      chatsDetached: document.querySelectorAll('[aria-label^="Open "]').length,
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 160) }));
  // Type into the Universe composer with real keystrokes (only if it accepts text).
  let typed = null;
  if (state.composer?.present && !state.composer.disabled) {
    try { await page.locator(".lcu textarea").first().click({ timeout: 5000 }); await page.keyboard.type("Mission 3.1 entry check", { delay: 8 }); typed = await page.locator(".lcu textarea").first().inputValue(); }
    catch (e) { typed = "type-failed:" + String(e).split("\n")[0].slice(0, 120); }
  }
  // Open a conversation as a window: the composer's real target.
  let windowOpen = null;
  const openBtn = page.locator('[aria-label^="Open "]').first();
  if (await openBtn.count().catch(() => 0)) {
    try { await openBtn.click({ timeout: 8000 }); } catch (e) { windowOpen = { clicked: false, error: String(e).split("\n")[0].slice(0, 140) }; }
    await page.waitForTimeout(2500);
    windowOpen = { clicked: true, ...(await page.evaluate(() => ({ chatWindows: document.querySelectorAll("[data-lelu-chat-window]").length, markedComposers: document.querySelectorAll("[data-lelu-composer]").length, textareas: document.querySelectorAll("textarea").length }))) };
  }
  await page.screenshot({ path: `${OUT}/shots/entry-${p.id}-${VW}x${VH}.png`, timeout: 6000 }).catch(() => {});
  results.push({ path: p.id, selector: p.selector, viewport: `${VW}x${VH}`, gate: { seen: gateSeen, dismissed: gateDismissed, settleMs: gateSettleMs, homeWithoutGate: homeUp, presentAfter: gateAfter }, hit, clickOutcome, clickError, dialogMs, state, typed, windowOpen, pageErrors: pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 4) });
  writeFileSync(`${OUT}/chat-entry-${VW}x${VH}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: `${VW}x${VH}`, mobile: MOBILE, results }, null, 1));
  await ctx.close();
}
await browser.close().catch(() => {});
console.log(JSON.stringify({ at: new Date().toISOString(), viewport: `${VW}x${VH}`, mobile: MOBILE, results }, null, 1));
