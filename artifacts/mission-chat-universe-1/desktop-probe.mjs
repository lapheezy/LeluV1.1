/**
 * Desktop regression probe: the phone header clearance must not touch a
 * desktop conversation window. Measures the real page at 1440×900.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  try {
    window.localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
  } catch {}
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-lelu-dock], .lcu", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1200);
if (!(await page.evaluate(() => document.querySelector(".lcu")))) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector(".lcu", { state: "visible", timeout: 15000 });
}
await page.waitForTimeout(300);
if ((await page.locator(".lcu-card:not(.lcu-card-new)").count()) === 0) {
  await page.click('button[aria-label="New chat"]');
  await page.waitForTimeout(600);
}
await page.locator(".lcu-card:not(.lcu-card-new)").first().click();
await page.waitForSelector('[data-lelu-module-window^="chat:"]', { timeout: 10000 });
await page.waitForTimeout(600);

const result = await page.evaluate(() => {
  const sheet = document.querySelector('[data-lelu-module-window^="chat:"]');
  const r = sheet.getBoundingClientRect();
  const universe = document.querySelector(".lcu");
  const head = universe?.querySelector(".lcu-head");
  return {
    fullscreenAttr: sheet.getAttribute("data-lelu-fullscreen"),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    viewport: { w: innerWidth, h: innerHeight },
    paddingTop: getComputedStyle(sheet).paddingTop,
    top: getComputedStyle(sheet).top,
    universeHead: head ? Math.round(head.getBoundingClientRect().bottom) : null,
    draggable: Boolean(sheet.querySelector('[data-lelu-panel-heading]')),
  };
});

const ok =
  result.fullscreenAttr === null &&
  result.rect.w < result.viewport.w &&
  result.rect.h < result.viewport.h &&
  result.top !== "88px";

console.log(JSON.stringify({ ok, ...result, errors }, null, 2));
await browser.close();
process.exit(ok ? 0 : 1);
