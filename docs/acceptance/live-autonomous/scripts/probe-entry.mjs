/**
 * MISSION 3 — LIVE AUTONOMOUS ACTIVATION
 *
 * Entry probe. Boots the real application, clears the sign-in gate, and
 * reports the actual controls and state so the conversational driver can
 * press something that exists. No synthetic events, no direct engine calls.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

const gateDismissed = await page.evaluate(() => {
  const g = document.querySelector("[data-lelu-signin-gate]");
  const b = g && [...g.querySelectorAll("button")].find((x) => /^Continue/.test((x.textContent || "").trim()));
  b?.click();
  return Boolean(b);
});
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const label = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim() || "").slice(0, 60);
  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .map((el) => ({ label: label(el), visible: Boolean(el.offsetParent) }))
    .filter((b) => b.label && b.visible)
    .slice(0, 80);
  return {
    surface: document.querySelector("[data-lelu-surface]")?.getAttribute("data-lelu-surface") ?? null,
    signInGate: Boolean(document.querySelector("[data-lelu-signin-gate]")),
    home: Boolean(document.querySelector("[data-lelu-home]")),
    chatRegion: Boolean(document.querySelector('[aria-label="Conversation with LÉLU"], [aria-label="Conversation"]')),
    buttons,
    textareas: [...document.querySelectorAll("textarea")].map((t) => ({
      label: t.getAttribute("aria-label"),
      placeholder: t.getAttribute("placeholder"),
      visible: Boolean(t.offsetParent),
    })),
    storageKeys: Object.keys(localStorage).sort(),
    canvases: document.querySelectorAll("canvas").length,
    bodyText: (document.body.innerText || "").slice(0, 900),
  };
});

writeFileSync(`${OUT}/probe-entry.json`, JSON.stringify({ gateDismissed, errors, ...report }, null, 1));
console.log(JSON.stringify({ gateDismissed, errors, ...report }, null, 1).slice(0, 4000));
await ctx.close();
await browser.close();
