/**
 * M22.9 persistent runtime — resource validation over repeated sessions.
 *
 * 30 start/stop cycles of the real voice session through the real chat
 * microphone button (simulated microphone, real app). Measured per cycle
 * after a forced GC (CDP HeapProfiler.collectGarbage):
 *   JS heap, DOM listener counts on window/document (CDP
 *   DOMDebugger.getEventListeners), AudioContexts created / closed,
 *   microphone streams open, lifecycle listeners, React commits of the
 *   voice button (MutationObserver on its attributes).
 * Writes MISSION-22.9/persistent-runtime/logs/resource-probe.json.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "MISSION-22.9", "persistent-runtime", "logs");
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const CYCLES = Number(process.argv[2] || 30);
// "idle": the same wall time with NO voice sessions — the control for heap drift.
const IDLE = process.argv[3] === "idle";

const browser = await chromium.launch({
  ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__ctx = { created: 0, closed: 0 };
  const Ctx = window.AudioContext;
  window.AudioContext = class extends Ctx {
    constructor(...args) {
      super(...args);
      window.__ctx.created += 1;
      const close = this.close.bind(this);
      this.close = () => { window.__ctx.closed += 1; return close(); };
    }
  };
});
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(9000);
const guest = page.getByRole("button", { name: "Continue without an account" });
if (await guest.count()) { await guest.first().click(); await page.waitForTimeout(1500); }
await page.getByRole("button", { name: /^Chat$/ }).first().click();
await page.waitForTimeout(3000);
const mic = page.locator("[data-lelu-voice-toggle]:visible").first();
await mic.waitFor({ state: "visible" });
await page.evaluate(() => {
  window.__mut = 0;
  const el = document.querySelector("[data-lelu-voice-toggle]");
  new MutationObserver((m) => { window.__mut += m.length; }).observe(el, { attributes: true });
});

const cdp = await context.newCDPSession(page);
await cdp.send("DOMDebugger.enable").catch(() => {});
async function listeners(expr) {
  const { result } = await cdp.send("Runtime.evaluate", { expression: expr });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
  return listeners.length;
}
async function measure(i, phase) {
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  const v = await page.evaluate(() => ({ d: window.__leluVoice?.diagnostics, active: window.__leluVoice?.active, ctx: window.__ctx, mut: window.__mut }));
  return {
    i, phase, heapMB: +(heap / 1048576).toFixed(2),
    windowListeners: await listeners("window"),
    documentListeners: await listeners("document"),
    audioContextsCreated: v.ctx.created, audioContextsClosed: v.ctx.closed,
    micStreamsOpen: v.d?.micStreamsOpen, micStreamsAcquired: v.d?.micStreamsAcquired, micStreamsReleased: v.d?.micStreamsReleased,
    lifecycleListeners: v.d?.lifecycleListeners, ttsQueueDepth: v.d?.ttsQueueDepth, buttonAttributeMutations: v.mut, active: v.active,
  };
}

const rows = [await measure(-1, "before")];
const startLatencies = [];
if (IDLE) {
  for (let i = 0; i < CYCLES; i += 1) {
    await page.waitForTimeout(2700);
    if (i === 0 || i === 9 || i === 19 || i === CYCLES - 1) rows.push(await measure(i, "idle"));
  }
}
for (let i = 0; i < (IDLE ? 0 : CYCLES); i += 1) {
  const clickAt = Date.now();
  await mic.click();
  await page.waitForFunction(() => window.__leluVoice?.active && window.__leluVoice?.diagnostics?.micStreamActive, null, { timeout: 10_000 });
  startLatencies.push(Date.now() - clickAt);
  await page.waitForTimeout(1500); // the VAD/recorder loop runs a while
  await mic.click();
  await page.waitForFunction(() => window.__leluVoice && !window.__leluVoice.active, null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  if (i === 0 || i === 9 || i === 19 || i === CYCLES - 1) rows.push(await measure(i, "after-stop"));
}
const sorted = [...startLatencies].sort((a, b) => a - b);
const result = {
  ranAt: new Date().toISOString(), cycles: CYCLES, simulatedMicrophone: true,
  mode: IDLE ? "idle-control" : "cycles",
  tapToMicLiveMs: IDLE ? null : { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted.at(-1) },
  rows,
};
writeFileSync(join(OUT, IDLE ? "resource-probe-idle.json" : "resource-probe.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
