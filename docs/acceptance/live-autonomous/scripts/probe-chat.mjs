/**
 * MISSION 3 — find the real chat surface.
 *
 * The home shell's "open chat" did not mount a chat window, so this probe
 * travels to the Conversation destination the app itself offers and reports
 * whether a composer exists there.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "4318";
const OUT = "docs/acceptance/live-autonomous";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = document.querySelector("[data-lelu-signin-gate]");
  const b = g && [...g.querySelectorAll("button")].find((x) => /^Continue/.test((x.textContent || "").trim()));
  b?.click();
});
await page.waitForTimeout(2500);

const steps = [];
const snapshot = async (name) => {
  const s = await page.evaluate(() => ({
    chatWindow: Boolean(document.querySelector("[data-lelu-chat-window]")),
    surface: [...document.querySelectorAll("[data-lelu-surface]")].map((e) => e.getAttribute("data-lelu-surface")).slice(0, 6),
    windows: [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => e.getAttribute("data-lelu-module-window")).slice(0, 8),
    inputs: [...document.querySelectorAll("textarea, input")].filter((e) => e.offsetParent).map((e) => e.getAttribute("aria-label") || e.getAttribute("placeholder")).slice(0, 10),
    sends: [...document.querySelectorAll("button")].map((e) => e.getAttribute("aria-label")).filter((l) => /send|chat|conversation/i.test(l || "")).slice(0, 10),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
  }));
  steps.push({ name, ...s });
  return s;
};
await snapshot("home");

for (const selector of [
  'button[aria-label="Travel to Conversation"]',
  'button[aria-label="Conversation"]',
  'button[aria-label="Chat"]',
]) {
  const el = await page.$(selector).catch(() => null);
  if (!el) continue;
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(4500);
  const s = await snapshot(`after ${selector}`);
  if (s.chatWindow || s.inputs.length) break;
}

writeFileSync(`${OUT}/probe-chat.json`, JSON.stringify({ errors, steps }, null, 1));
console.log(JSON.stringify({ errors, steps }, null, 1).slice(0, 3500));
await ctx.close();
await browser.close();
