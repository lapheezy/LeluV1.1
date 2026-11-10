/** GATE A · open a conversation window from the Universe grid, by coordinate. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-1";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [], consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 260)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 50; i++) {
  const g = await page.evaluate(() => { const el = document.querySelector("[data-lelu-signin-gate]"); return el ? [...el.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent ?? "")) : false; });
  if (g) break; await page.waitForTimeout(400);
}
await page.evaluate(() => { const el = document.querySelector("[data-lelu-signin-gate]"); [...(el?.querySelectorAll("button") ?? [])].find((b) => /without an account/i.test(b.textContent ?? ""))?.click(); });
await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).catch(() => {});
await page.waitForSelector("[data-lelu-home]", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const navBtn = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
if (!navBtn) throw new Error("navigator chat control absent");
await page.mouse.click(navBtn.x, navBtn.y);
await page.waitForSelector('.lcu', { state: "visible", timeout: 15000 });
await page.waitForTimeout(1500);
const cards = await page.evaluate(() => {
  const els = [...document.querySelectorAll(".lcu-card")];
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return { label: el.getAttribute("aria-label"), cls: String(el.className), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, cx, cy, topTag: top?.tagName, topCls: String(top?.className ?? "").slice(0, 40), topIsSelfOrChild: Boolean(top && (top === el || el.contains(top))), pe: getComputedStyle(el).pointerEvents };
  });
});
const target = cards.find((c) => /^Open (?!navigation|Chat Universe|the app)/.test(c.label ?? "") && c.topIsSelfOrChild) ?? cards.find((c) => c.topIsSelfOrChild);
let click = null, after = null;
if (target) {
  await page.mouse.click(target.cx, target.cy);
  await page.waitForTimeout(3000);
  after = await page.evaluate(() => ({ chatWindows: document.querySelectorAll("[data-lelu-chat-window]").length, markedComposers: document.querySelectorAll("[data-lelu-composer]").length, textareas: document.querySelectorAll("textarea").length, modules: Object.keys(JSON.parse(localStorage.getItem("lelu.lelu.layout.v2") ?? "{}")).slice(0, 3) }));
  click = "pointer-click";
}
await page.screenshot({ path: `${OUT}/shots/universe-card.png`, timeout: 8000 }).catch(() => {});
const result = { at: new Date().toISOString(), cards, clicked: click, clickedTarget: target?.label ?? null, after, pageErrors: pageErrors.slice(0, 5), consoleErrors: consoleErrors.slice(0, 5) };
writeFileSync(`${OUT}/universe-card-probe.json`, JSON.stringify(result, null, 1));
await browser.close().catch(() => {});
console.log(JSON.stringify(result, null, 1));
