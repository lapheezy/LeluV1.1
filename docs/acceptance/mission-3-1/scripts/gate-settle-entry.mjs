/**
 * GATE A · the corrected harness.
 * 1. Wait until the sign-in gate has SETTLED (it mounts after first paint
 *    and covers the viewport at z-index 600 with pointer-events:auto).
 * 2. Dismiss it with its own control and prove it detached.
 * 3. Then, and only then, drive the chat entry with real pointer input.
 * argv: <pathId>
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-1";
const PATHS = {
  "home-now-open-chat": '[aria-label="What LÉLU is doing — open chat"]',
  "navigator-summon": '[data-spatial-control="chat"]',
  "travel-conversation": 'button[aria-label="Travel to Conversation"]',
  "apps-chat-tile": '[data-primary="true"]',
};
const id = process.argv[2];
const selector = PATHS[id];
const [VW, VH] = (process.env.VIEWPORT ?? "1440x900").split("x").map(Number);
const MOBILE = process.env.MOBILE === "1";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: MOBILE, isMobile: MOBILE });
const page = await ctx.newPage();
const pageErrors = [], consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
const t0 = Date.now();
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
const gateProbe = () => page.evaluate(() => {
  const g = document.querySelector("[data-lelu-signin-gate]");
  return { gate: Boolean(g), labels: g ? [...g.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim().slice(0, 48)) : [], home: Boolean(document.querySelector("[data-lelu-home]")), text: g ? (g.innerText ?? "").slice(0, 220) : "" };
});
let gate = { gate: false, labels: [] }, gateSettleMs = null;
for (let i = 0; i < 50; i++) {
  gate = await gateProbe();
  if (gate.gate && gate.labels.length) { gateSettleMs = Date.now() - t0; break; }
  if (!gate.gate && gate.home && Date.now() - t0 > 12000) break;
  await page.waitForTimeout(400);
}
let dismissed = "not-needed";
if (gate.gate && gate.labels.length) {
  const label = gate.labels.find((l) => /without an account/i.test(l)) ?? gate.labels.find((l) => /continue|skip|guest|later|explore/i.test(l)) ?? null;
  if (label) {
    await page.locator("[data-lelu-signin-gate] button", { hasText: label }).first().click({ timeout: 8000 }).catch(async () => {
      await page.evaluate((lbl) => { const g = document.querySelector("[data-lelu-signin-gate]"); [...g.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === lbl)?.click(); }, label).catch(() => {});
    });
    const gone = await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 15000 }).then(() => true).catch(() => false);
    dismissed = gone ? "detached" : "still-present";
  } else dismissed = "no-dismiss-control";
}
await page.waitForSelector("[data-lelu-home]", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1000);
const gateAfter = await page.evaluate(() => Boolean(document.querySelector("[data-lelu-signin-gate]")));
const hit = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
  const top = document.elementFromPoint(cx, cy);
  return { present: true, cx, cy, reachable: Boolean(top && (top === el || el.contains(top))), topAria: top?.getAttribute?.("aria-label") ?? top?.tagName ?? null };
}, selector);
let clickOutcome = "not-attempted", clickError = null;
if (hit.present) { try { await page.mouse.click(hit.cx, hit.cy); clickOutcome = "pointer-click"; } catch (e) { clickOutcome = "click-failed"; clickError = String(e).split("\n")[0].slice(0, 200); } }
const tClick = Date.now();
let dialogMs = null;
try { await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 12000 }); dialogMs = Date.now() - tClick; } catch { dialogMs = -1; }
await page.waitForTimeout(600);
const universe = await page.evaluate(() => {
  const ta = document.querySelector(".lcu textarea");
  const dialog = document.querySelector('[role="dialog"][aria-label="Chat Universe"]');
  return { dialog: Boolean(dialog), cards: document.querySelectorAll(".lcu-card").length, chatCards: document.querySelectorAll('[aria-label^="Open "]').length, composer: ta ? { present: true, disabled: ta.disabled, placeholder: ta.placeholder } : { present: false }, chatWindows: document.querySelectorAll("[data-lelu-chat-window]").length, markedComposers: document.querySelectorAll("[data-lelu-composer]").length, gate: Boolean(document.querySelector("[data-lelu-signin-gate]")) };
});
let typed = null, typeError = null;
if (universe.composer.present && !universe.composer.disabled) {
  try { await page.locator(".lcu textarea").first().click({ timeout: 6000 }); await page.keyboard.type("Mission 3.1 entry check", { delay: 6 }); typed = await page.locator(".lcu textarea").first().inputValue(); }
  catch (e) { typeError = String(e).split("\n")[0].slice(0, 160); }
}
let windowOpen = null;
if (universe.chatCards) {
  const first = page.locator('.lcu [aria-label^="Open "]').first();
  try { await first.click({ timeout: 8000 }); } catch (e) { windowOpen = { error: String(e).split("\n")[0].slice(0, 160) }; }
  await page.waitForTimeout(3000);
  windowOpen = { ...(windowOpen ?? {}), ...(await page.evaluate(() => ({ chatWindows: document.querySelectorAll("[data-lelu-chat-window]").length, markedComposers: document.querySelectorAll("[data-lelu-composer]").length, textareas: document.querySelectorAll("textarea").length, gate: Boolean(document.querySelector("[data-lelu-signin-gate]")) }))) };
}
await page.screenshot({ path: `${OUT}/shots/gate-entry-${id}-${VW}x${VH}.png`, timeout: 8000 }).catch(() => {});
const result = { id, selector, viewport: `${VW}x${VH}`, mobile: MOBILE, at: new Date().toISOString(), gate: { ...gate, settleMs: gateSettleMs, dismissed, presentAfter: gateAfter }, hit, clickOutcome, clickError, dialogMs, universe, typed, typeError, windowOpen, pageErrors: pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 4) };
writeFileSync(`${OUT}/chat-gate-${id}-${VW}x${VH}.json`, JSON.stringify(result, null, 1));
await browser.close().catch(() => {});
console.log(JSON.stringify(result, null, 1));
