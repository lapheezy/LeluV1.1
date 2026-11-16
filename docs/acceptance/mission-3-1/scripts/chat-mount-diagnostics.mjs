/**
 * MISSION 3.1 · GATE A — why did no chat window mount?
 * Real pointer clicks on the app's own controls, sampling the DOM every
 * 250 ms so the failure point is the measured one, not a guess.
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:4318/";
const OUT = "docs/acceptance/mission-3-1";
const PATHS = [
  { id: "home-now-open-chat", selector: '[aria-label="What LÉLU is doing — open chat"]' },
  { id: "navigator-summon", selector: '[data-spatial-control="chat"]' },
  { id: "apps-chat-button", selector: '[data-primary="true"]' },
  { id: "travel-conversation", selector: 'button[aria-label="Travel to Conversation"]' },
];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const results = [];
for (const pathDef of PATHS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  let gateSeen = false;
  for (let i = 0; i < 40; i++) {
    const hit = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account");
      if (!b) return false;
      b.click(); return true;
    }).catch(() => false);
    if (hit) { gateSeen = true; break; }
    await page.waitForTimeout(500);
  }
  await page.waitForSelector("[data-lelu-home]", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const pre = await page.evaluate(() => ({
    home: Boolean(document.querySelector("[data-lelu-home]")),
    chat: Boolean(document.querySelector("[data-lelu-chat-window]")),
    composer: Boolean(document.querySelector("[data-lelu-composer]")),
  }));
  const target = page.locator(pathDef.selector).first();
  const count = await target.count();
  let clickOutcome = "not-attempted", clickError = null, box = null;
  if (count > 0) {
    box = await target.boundingBox().catch(() => null);
    const hitTest = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
      return { visible: getComputedStyle(el).display !== "none", w: Math.round(r.width), h: Math.round(r.height), topTag: top?.tagName ?? null, topIsSelfOrChild: Boolean(top && (top === el || el.contains(top))), topAria: top?.getAttribute?.("aria-label") ?? null };
    }, pathDef.selector).catch(() => null);
    try { await target.click({ timeout: 5000 }); clickOutcome = "clicked"; }
    catch (e) { clickOutcome = "click-failed"; clickError = String(e).split("\n")[0].slice(0, 300); }
    const samples = [];
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => ({
        t: performance.now(),
        chat: Boolean(document.querySelector("[data-lelu-chat-window]")),
        composer: Boolean(document.querySelector("[data-lelu-composer]")),
        home: Boolean(document.querySelector("[data-lelu-home]")),
        sending: document.querySelector("[data-lelu-chat-window]")?.getAttribute("data-lelu-sending") ?? null,
      }));
      samples.push(s);
      if (s.chat && s.composer) break;
    }
    await page.screenshot({ path: `${OUT}/shots/diag-${pathDef.id}.png` });
    results.push({ path: pathDef.id, selector: pathDef.selector, gateSeen, pre, count, box, hitTest, clickOutcome, clickError, mountedAt: samples.findIndex((s) => s.chat), samples: samples.map((s, i) => ({ i, chat: s.chat, composer: s.composer, home: s.home })), consoleErrors: consoleErrors.slice(0, 5), pageErrors: pageErrors.slice(0, 5) });
  } else {
    results.push({ path: pathDef.id, selector: pathDef.selector, gateSeen, pre, count: 0, clickOutcome: "selector-absent", consoleErrors: consoleErrors.slice(0, 5), pageErrors: pageErrors.slice(0, 5) });
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
