/**
 * One signed-in turn that asks for something visible in chat: a chart and a
 * PDF. Captures what the conversation actually shows (artifact cards) and
 * saves any file the card offers.
 *
 * Usage: node artifacts/mission-chat-universe-1/chart-pdf-turn.mjs [base]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const PROJECT_URL = "https://nrehsldbfxthspikaxvr.supabase.co";
const KEY = readFileSync(join(HERE, "..", "..", "src/core/config/supabasePublic.ts"), "utf8").match(/publishableKey: "([^"]+)"/)[1];
const EMAIL = `lelu.chart.${Date.now()}@example.com`;

const signup = await fetch(`${PROJECT_URL}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: `Chart-aA1-${Date.now()}` }),
}).then((r) => r.json());

const browser = await chromium.launch({ downloadsPath: join(HERE, "downloads") });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
});
const page = await context.newPage();
const out = { email: EMAIL, userId: signup.user?.id ?? null };

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(
  ({ key, value }) => {
    localStorage.clear();
    localStorage.setItem(key, value);
  },
  { key: "sb-nrehsldbfxthspikaxvr-auth-token", value: JSON.stringify(signup) },
);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await page.waitForTimeout(2500);
if ((await page.locator(".lcu-card").count()) === 0) {
  await page.locator('button[aria-label="New chat"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2500);
}
await page.locator(".lcu-card").first().click({ timeout: 6000 });
await page.waitForTimeout(2500);

const composer = page.locator('[data-lelu-module-window^="chat:"] textarea').first();
await composer.click();
await page.keyboard.type(
  "Build me a one-page chart of my focus hours this week: Mon 2, Tue 4, Wed 3, Thu 5, Fri 1. Put it in a document and export a PDF I can download.",
  { delay: 8 },
);
await page.keyboard.press("Enter");

const deadline = Date.now() + 150_000;
let last = "";
while (Date.now() < deadline) {
  await page.waitForTimeout(5000);
  const text = await page.locator('[data-lelu-module-window^="chat:"]').first().innerText();
  if (text !== last) last = text;
  if (/artifact|download|pdf|chart/i.test(text) && !/thinking it through|working with tools/i.test(text)) break;
}

out.text = last.slice(0, 1600);
out.cards = await page.evaluate(() => {
  const sheet = document.querySelector('[data-lelu-module-window^="chat:"]');
  return {
    artifacts: [...(sheet?.querySelectorAll("[data-lelu-artifact], [data-studio-artifact]") ?? [])].map((el) => (el.textContent || "").slice(0, 120)),
    links: [...(sheet?.querySelectorAll("a[download], button") ?? [])].map((el) => (el.textContent || "").trim().slice(0, 40)).filter((t) => /pdf|download|open|export/i.test(t)).slice(0, 8),
  };
});
await page.screenshot({ path: join(SHOTS, "chart-turn-390x844.png") });

// If the card offers a download, take it.
const link = page.locator('[data-lelu-module-window^="chat:"] a[download], [data-lelu-module-window^="chat:"] button:has-text("Download")').first();
if (await link.count()) {
  const download = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), link.click({ timeout: 8000 }).catch(() => {})]).then(([d]) => d);
  if (download) {
    const target = join(HERE, "downloads", download.suggestedFilename() || "artifact.bin");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(await download.path(), target);
    out.download = { name: download.suggestedFilename(), path: target };
  }
}

writeFileSync(join(HERE, "chart-pdf-turn.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
