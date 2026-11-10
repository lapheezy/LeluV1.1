/**
 * GATE A · click trace
 * The renderer stops answering page.evaluate after the chat control is
 * pressed, so everything is measured from the page's OWN console stream:
 * a heartbeat the page writes about itself. If the heartbeats stop, the
 * main thread is blocked, and the last line says exactly where it stopped.
 * argv: <id> <selector> [WxH]
 */
import { chromium } from "playwright";
const [id, selector, vp] = process.argv.slice(2);
const [W, H] = (vp ?? "1440x900").split("x").map(Number);
const OUT = "docs/acceptance/mission-3-1";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 720, isMobile: W < 720 });
const page = await ctx.newPage();
const beats = [], pageErrors = [], consoleErrors = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("BEAT")) beats.push({ at: Date.now(), text: t.slice(0, 200) });
  else if (m.type() === "error") consoleErrors.push(t.slice(0, 200));
});
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
await page.addInitScript((sel) => {
  window.__sel = sel;
  window.__events = 0;
  window.addEventListener("lelu-open-universe", () => { window.__events++; console.log("UNIVERSE_EVENT", window.__events); });
  window.addEventListener("error", (e) => console.log("UNCAUGHT", String(e.message).slice(0, 160)));
  window.addEventListener("unhandledrejection", (e) => console.log("REJECTED", String(e.reason).slice(0, 160)));
  let n = 0;
  setInterval(() => {
    n++;
    const chat = document.querySelectorAll("[data-lelu-chat-window]").length;
    const comp = document.querySelectorAll("[data-lelu-composer]").length;
    const ta = document.querySelectorAll("textarea").length;
    const home = Boolean(document.querySelector("[data-lelu-home]"));
    const uni = document.documentElement.dataset.leluUniverse ?? "none";
    console.log(`BEAT ${n} chat=${chat} composer=${comp} textarea=${ta} home=${home ? 1 : 0} uni=${uni} events=${window.__events}`);
  }, 400);
}, selector);
const t0 = Date.now();
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("[data-lelu-home]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1200);
const box = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
}, selector).catch(() => null);
const beatsBefore = beats.length;
await page.mouse.click(box.x, box.y);
const clickedAt = Date.now();
await page.waitForTimeout(14000);
const lastBeatAt = beats.length ? beats[beats.length - 1].at : null;
let alive = "yes", aliveErr = null;
try { await page.evaluate(() => 1, null, { timeout: 4000 }); } catch (e) { alive = "no"; aliveErr = String(e).split("\n")[0].slice(0, 160); }
let shot = "saved";
try { await page.screenshot({ path: `${OUT}/shots/trace-${id}-${W}x${H}.png`, timeout: 8000 }); } catch (e) { shot = "failed:" + String(e).split("\n")[0].slice(0, 120); }
const beatsAfter = beats.slice(beatsBefore);
await browser.close().catch(() => {});
console.log(JSON.stringify({
  id, selector, viewport: `${W}x${H}`, at: new Date().toISOString(),
  clickTarget: box, clickError: null,
  msToLastBeat: lastBeatAt ? lastBeatAt - clickedAt : null,
  beatsBeforeClick: beatsBefore, beatsAfterClick: beatsAfter.length,
  mainThreadResponsiveAfter: alive, aliveErr, screenshot: shot,
  firstBeatWithChat: beatsAfter.findIndex((b) => /chat=[1-9]/.test(b.text)),
  beatsAfterTitles: beatsAfter.map((b) => b.text),
  pageErrors: pageErrors.slice(0, 6), consoleErrors: consoleErrors.slice(0, 6),
}, null, 1));
