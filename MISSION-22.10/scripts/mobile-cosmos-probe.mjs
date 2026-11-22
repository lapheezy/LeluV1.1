/**
 * M22.10 item 14 — on a phone, the chat (with a live voice session) must not
 * keep the hidden 3D Cosmos rendering. Counts real WebGL draw calls
 * (drawArrays/drawElements and their instanced variants, WebGL1+2) in 5 s
 * windows: home (world visible), chat open, chat open + voice session.
 * iPhone-13 profile on Chromium (layout/touch only — not WebKit).
 */
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const browser = await chromium.launch({
  ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}),
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ ...devices["iPhone 13"], permissions: ["microphone"] });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__draws = 0;
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const original = C.prototype[name];
      if (!original) continue;
      C.prototype[name] = function (...args) { window.__draws += 1; return original.apply(this, args); };
    }
  }
});
const draws = () => page.evaluate(() => window.__draws);
const window5s = async (label) => { const a = await draws(); await page.waitForTimeout(5000); const b = await draws(); return { label, drawCalls5s: b - a }; };
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(9000);
const guest = page.getByRole("button", { name: "Continue without an account" });
if (await guest.count()) { await guest.first().tap(); await page.waitForTimeout(1500); }
const rows = [await window5s("home (world visible)")];
await page.getByRole("button", { name: /^Chat$/ }).first().tap();
await page.waitForTimeout(3000);
rows.push(await window5s("chat open"));
const mic = page.locator("[data-lelu-voice-toggle]:visible").first();
await mic.tap();
await page.waitForFunction(() => window.__leluVoice?.active, null, { timeout: 15_000 });
rows.push(await window5s("chat open + voice session"));
const capture = await mic.getAttribute("data-lelu-voice-capture");
await mic.tap();
await page.waitForTimeout(800);
await page.screenshot({ path: "MISSION-22.10/screenshots/mobile-cosmos-probe.png" });
const out = { ranAt: new Date().toISOString(), profile: "iPhone 13 on Chromium", rows, micCaptureDuringVoice: capture, voiceActiveAfterStop: await page.evaluate(() => window.__leluVoice?.active) };
writeFileSync("MISSION-22.10/logs/mobile-cosmos-probe.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
