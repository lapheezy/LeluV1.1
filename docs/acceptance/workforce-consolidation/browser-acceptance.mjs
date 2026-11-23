/**
 * Workforce consolidation — browser acceptance against the PRODUCTION server.
 *
 *   bun server.ts (dist/) → real Chromium (Playwright), desktop 1440×900 and
 *   iPhone-13 emulation (390×844, touch; Blink engine, iOS user agent).
 *
 * Measures from the page itself (Navigation Timing, paint entries,
 * performance.memory) and records every console error. Drives: load, guest
 * entry, chat open, a typed turn answered by the configured provider, reload
 * (conversation persisted), offline → online recovery, microphone permission
 * with Chromium's FAKE device (no physical microphone exists here), and the
 * Cosmos entry. Nothing is estimated; a step that could not be observed is
 * recorded as not observed.
 *
 *   node docs/acceptance/workforce-consolidation/browser-acceptance.mjs desktop|mobile
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODE = process.argv[2] || "desktop";
const URL = process.env.LELU_URL || "http://127.0.0.1:4173/";
const OUT = join(process.cwd(), "docs/acceptance/workforce-consolidation");
mkdirSync(join(OUT, "screenshots"), { recursive: true });

const browser = await chromium.launch({
  ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-precise-memory-info"],
});
const context = await browser.newContext(
  MODE === "mobile"
    ? { ...devices["iPhone 13"], permissions: ["microphone"], deviceScaleFactor: 1 }
    : { viewport: { width: 1440, height: 900 }, permissions: ["microphone"] },
);
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
page.on("requestfailed", (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
page.on("response", (r) => { if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url().slice(0, 160)}`); });

const result = { mode: MODE, url: URL, startedAt: new Date().toISOString(), steps: {} };
const step = (name, data) => { result.steps[name] = data; console.log(name, JSON.stringify(data)); };
const shot = (name) => page.screenshot({ path: join(OUT, "screenshots", `${MODE}-${name}.png`) });
const tap = async (loc) => (MODE === "mobile" ? loc.tap() : loc.click());

const t0 = Date.now();
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(4000);
const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType("resource");
  const mem = performance.memory ? { usedJSHeapMb: Math.round(performance.memory.usedJSHeapSize / 1048576), totalJSHeapMb: Math.round(performance.memory.totalJSHeapSize / 1048576) } : null;
  return {
    ttfbMs: Math.round(nav.responseStart), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadEventMs: Math.round(nav.loadEventEnd),
    paints, resources: res.length, transferredKb: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
    jsKb: Math.round(res.filter((r) => /\.js(\?|$)/.test(r.name)).reduce((s, r) => s + (r.transferSize || 0), 0) / 1024), mem,
  };
});
step("load", { wallLoadMs: loadMs, ...perf });
await shot("01-loaded");

// Guest entry (no account in this environment).
const guest = page.getByRole("button", { name: /Continue without an account|Continue/ });
if (await guest.count()) { await tap(guest.first()); await page.waitForTimeout(1500); step("guestEntry", { shown: true }); }
else step("guestEntry", { shown: false });

// Open chat.
const chatTile = page.getByRole("button", { name: /^Chat$/ });
const opener = page.locator('button[aria-label*="open chat" i], button[aria-label*="chat" i]');
if (await chatTile.count()) await tap(chatTile.first());
else if (await opener.count()) await tap(opener.first());
await page.waitForTimeout(1500);
const composer = page.locator("textarea:visible").first();
const composerVisible = await composer.count() ? await composer.isVisible() : false;
step("chatOpen", { composerVisible });
await shot("02-chat");

// One typed turn through the real runtime.
const token = `WF${Date.now().toString(36).toUpperCase()}`;
let turn = { sent: false };
if (composerVisible) {
  const assistantCount = () => page.evaluate(() => document.querySelectorAll('[data-role="assistant"]').length);
  const before = await assistantCount();
  const sentAt = Date.now();
  await composer.fill(`My workforce acceptance codeword is ${token}. Reply in one short sentence confirming you have it.`);
  await composer.press("Enter");
  let replied = false;
  let replyText = null;
  for (let i = 0; i < 120 && !replied; i += 1) {
    await page.waitForTimeout(1000);
    if ((await assistantCount()) > before) {
      // Wait for the reply to settle (streaming), then read the newest one.
      await page.waitForTimeout(2500);
      replyText = await page.evaluate(() => { const all = document.querySelectorAll('[data-role="assistant"]'); return all[all.length - 1]?.innerText?.slice(0, 400) ?? null; });
      replied = Boolean(replyText && replyText.trim().length > 0);
    }
  }
  turn = { sent: true, replyObserved: replied, secondsToReply: replied ? Math.round((Date.now() - sentAt) / 100) / 10 : null, replyText, replyMentionsCodeword: Boolean(replyText && replyText.includes(token)) };
}
step("chatTurn", turn);
await shot("03-reply");

// Reload: is the conversation still there?
const r0 = Date.now();
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(4000);
if (await chatTile.count()) { await tap(chatTile.first()); await page.waitForTimeout(1500); }
const afterReload = await page.evaluate((t) => [...document.querySelectorAll('[data-role]')].some((m) => m.innerText.includes(t)), token);
  const assistantAfterReload = await page.evaluate(() => document.querySelectorAll('[data-role="assistant"]').length);
const stored = await page.evaluate((t) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || "").includes(t)), token);
step("reload", { reloadMs: Date.now() - r0, messageWithCodewordVisibleAfterReload: afterReload, assistantMessagesAfterReload: assistantAfterReload, tokenInLocalStorage: stored });
await shot("04-after-reload");

// Network interruption.
await context.setOffline(true);
await page.waitForTimeout(1500);
const offlineAlive = await page.evaluate(() => Boolean(document.querySelector("#root")?.children.length));
await context.setOffline(false);
await page.waitForTimeout(2500);
const health = await page.evaluate(async () => { try { const r = await fetch("/healthz", { cache: "no-store" }); return r.status; } catch { return "error"; } });
step("networkInterruption", { appStillMountedOffline: offlineAlive, healthzAfterReconnect: health });

// Microphone (fake device): permission and a real getUserMedia stream.
const mic = await page.evaluate(async () => {
  const secure = window.isSecureContext;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = s.getAudioTracks().map((t) => ({ label: t.label, state: t.readyState }));
    s.getTracks().forEach((t) => t.stop());
    return { secureContext: secure, granted: true, tracks };
  } catch (e) { return { secureContext: secure, granted: false, error: String(e) }; }
});
const voiceToggle = await page.locator("[data-lelu-voice-toggle]").count();
step("microphone", { ...mic, voiceToggleRendered: voiceToggle > 0 });

// Cosmos entry.
const cosmosBtn = page.locator('button[aria-label="Look at the Cosmos"]');
let cosmos = { buttonFound: (await cosmosBtn.count()) > 0 };
if (cosmos.buttonFound && (await cosmosBtn.first().isVisible())) {
  await tap(cosmosBtn.first());
  await page.waitForTimeout(3000);
  cosmos = { ...cosmos, ...(await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { canvas: Boolean(c), canvasSize: c ? [c.width, c.height] : null, dock: document.querySelector("[data-testid=lelu-cosmos-dock]")?.getAttribute("data-immersive") ?? null };
  })) };
}
step("cosmos", cosmos);
await shot("05-cosmos");

const memEnd = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
result.usedJSHeapMbAtEnd = memEnd;
result.consoleErrors = consoleErrors;
result.pageErrors = pageErrors;
result.failedRequests = failedRequests;
result.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, `browser-${MODE}.json`), JSON.stringify(result, null, 2));
console.log(`console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}, failed/5xx requests: ${failedRequests.length}`);
await browser.close();
