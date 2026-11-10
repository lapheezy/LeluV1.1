/** One chat entry path, one page. argv: <id> <selector> [viewport WxH] */
import { chromium } from "playwright";
const [id, selector, vp] = process.argv.slice(2);
const [W, H] = (vp ?? "1440x900").split("x").map(Number);
const OUT = "docs/acceptance/mission-3-1";
const log = (...a) => console.error(`[${id}]`, ...a);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 720, isMobile: W < 720 });
const page = await ctx.newPage();
const consoleErrors = [], pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
await page.addInitScript(() => { window.__universeEvents = 0; window.addEventListener("lelu-open-universe", () => { window.__universeEvents++; }); });
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
let gate = "absent";
for (let i = 0; i < 20; i++) {
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account");
    if (!b) return document.querySelector("[data-lelu-signin-gate]") ? "gate-no-button" : "gone";
    b.click(); return "clicked";
  }).catch(() => "error");
  gate = r; if (r === "clicked" || r === "gone") break;
  await page.waitForTimeout(300);
}
await page.waitForSelector("[data-lelu-home]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
const snap = () => page.evaluate((sel) => ({
  chat: document.querySelectorAll("[data-lelu-chat-window]").length,
  composer: document.querySelectorAll("[data-lelu-composer]").length,
  textareas: document.querySelectorAll("textarea").length,
  home: Boolean(document.querySelector("[data-lelu-home]")),
  universeEvents: window.__universeEvents ?? 0,
  target: (() => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display, pe: getComputedStyle(el).pointerEvents }; })(),
}), selector);
const pre = await snap();
log("pre", JSON.stringify(pre), "gate", gate);
const n = await page.locator(selector).count();
let clickOutcome = n ? "clicked" : "selector-absent", clickError = null;
if (n) {
  try { await page.locator(selector).first().click({ timeout: 4000 }); }
  catch (e) { clickOutcome = "click-failed"; clickError = String(e).split("\n")[0].slice(0, 240); }
}
const samples = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(250);
  const s = await snap(); samples.push({ i, ...s });
  if (s.chat > 0 && s.composer > 0) break;
}
await page.screenshot({ path: `${OUT}/shots/${id}-${W}x${H}.png` });
const post = await snap();
log("post", JSON.stringify(post), "click", clickOutcome, clickError ?? "");
await browser.close();
console.log(JSON.stringify({ id, selector, viewport: `${W}x${H}`, at: new Date().toISOString(), gate, pre, clickOutcome, clickError, post, firstChatSample: samples.findIndex((s) => s.chat > 0), samples: samples.map((s) => ({ i: s.i, chat: s.chat, composer: s.composer, home: s.home, universeEvents: s.universeEvents })), pageErrors: pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 4) }, null, 1));
