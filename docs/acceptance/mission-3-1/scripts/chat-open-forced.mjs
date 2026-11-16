/**
 * GATE A · split the failure.
 * Phase 1: element.click() (bypasses hit-testing) — does the handler run?
 * Phase 2: dispatch lelu-open-universe directly — is anything listening?
 * Everything is read from the page's own console heartbeat.
 */
import { chromium } from "playwright";
const [id, selector, vp] = process.argv.slice(2);
const [W, H] = (vp ?? "1440x900").split("x").map(Number);
const OUT = "docs/acceptance/mission-3-1";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 720, isMobile: W < 720 });
const page = await ctx.newPage();
const beats = [], pageErrors = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("BEAT")) beats.push(t); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
await page.addInitScript(() => {
  window.__events = 0; window.__listeners = 0;
  const add = window.addEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => { if (type === "lelu-open-universe") window.__listeners++; return add(type, fn, opts); };
  add("lelu-open-universe", () => { window.__events++; });
  add("error", (e) => console.log("UNCAUGHT", String(e.message).slice(0, 200)));
  let n = 0;
  setInterval(() => {
    n++;
    console.log(`BEAT ${n} chat=${document.querySelectorAll("[data-lelu-chat-window]").length} composer=${document.querySelectorAll("[data-lelu-composer]").length} ta=${document.querySelectorAll("textarea").length} home=${document.querySelector("[data-lelu-home]") ? 1 : 0} uni=${document.documentElement.dataset.leluUniverse ?? "none"} ev=${window.__events} lsn=${window.__listeners}`);
  }, 400);
});
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("[data-lelu-home]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
const base = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return { listeners: window.__listeners, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, topEl: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null, topIsTarget: top === el || el.contains(top), pe: getComputedStyle(el).pointerEvents, vis: getComputedStyle(el).visibility, ancestors: (() => { const out = []; let p = el.parentElement; for (let i = 0; p && i < 6; i++, p = p.parentElement) out.push(`${p.tagName}.${String(p.className).slice(0, 28)}[pe=${getComputedStyle(p).pointerEvents}]`); return out; })() };
}, selector);
const beatsBefore = beats.length;
// PHASE 1: programmatic click on the real element.
await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
await page.waitForTimeout(4000);
const phase1 = beats.slice(beatsBefore).at(-1) ?? null;
// PHASE 2: the event itself, with no button involved.
const evBefore = await page.evaluate(() => window.__events).catch(() => null);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await page.waitForTimeout(5000);
const phase2 = beats.slice(beatsBefore).at(-1) ?? null;
let shot = "saved";
try { await page.screenshot({ path: `${OUT}/shots/forced-${id}-${W}x${H}.png`, timeout: 10000 }); } catch { shot = "failed"; }
const finalState = await page.evaluate(() => ({ events: window.__events, listeners: window.__listeners, uni: document.documentElement.dataset.leluUniverse ?? "none", chat: document.querySelectorAll("[data-lelu-chat-window]").length, composer: document.querySelectorAll("[data-lelu-composer]").length, home: Boolean(document.querySelector("[data-lelu-home]")), textareas: document.querySelectorAll("textarea").length, universeRoot: Boolean(document.querySelector(".lcu")), dialogChatUniverse: Boolean(document.querySelector('[role="dialog"][aria-label="Chat Universe"]')) })).catch((e) => ({ evalError: String(e).slice(0, 160) }));
await browser.close().catch(() => {});
console.log(JSON.stringify({ id, selector, viewport: `${W}x${H}`, at: new Date().toISOString(), base, phase1, evBefore, phase2, finalState, screenshot: shot, pageErrors, beatsBeforeClick: beatsBefore, beatTail: beats.slice(-6) }, null, 1));
