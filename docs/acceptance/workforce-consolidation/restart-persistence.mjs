/**
 * Restart survival on the production server: one browser profile, one chat
 * turn, a full `bun server.ts` stop/start (scripted by the caller between the
 * two phases), then the same profile reloads.
 *   node restart-persistence.mjs before|after <profileDir>
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const [phase, profile] = process.argv.slice(2);
const OUT = "docs/acceptance/workforce-consolidation";
const ctx = await chromium.launchPersistentContext(profile, { ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}), args: ["--no-sandbox"], viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("http://127.0.0.1:4173/", { waitUntil: "load" });
await page.waitForTimeout(4000);
const chat = page.getByRole("button", { name: /^Chat$/ });
if (await chat.count()) { await chat.first().click(); await page.waitForTimeout(1500); }
const health = await page.evaluate(async () => (await fetch("/healthz", { cache: "no-store" })).json());
if (phase === "before") {
  const token = `RS${Date.now().toString(36).toUpperCase()}`;
  const n = await page.locator('[data-role="assistant"]').count();
  const box = page.locator("textarea:visible").first();
  await box.fill(`Remember the restart codeword ${token}. Answer in five words.`);
  await box.press("Enter");
  for (let i = 0; i < 90 && (await page.locator('[data-role="assistant"]').count()) <= n; i += 1) await page.waitForTimeout(1000);
  await page.waitForTimeout(3000);
  writeFileSync(`${OUT}/restart-token.txt`, token);
  console.log(JSON.stringify({ phase, token, serverUptime: health.uptimeSeconds, version: health.version, assistantMessages: await page.locator('[data-role="assistant"]').count() }));
} else {
  const token = readFileSync(`${OUT}/restart-token.txt`, "utf8").trim();
  const visible = await page.evaluate((t) => [...document.querySelectorAll("[data-role]")].some((m) => m.innerText.includes(t)), token);
  const out = { phase, token, serverUptime: health.uptimeSeconds, version: health.version, conversationSurvivedServerRestart: visible, assistantMessages: await page.locator('[data-role="assistant"]').count() };
  await page.screenshot({ path: `${OUT}/screenshots/restart-after.png` });
  writeFileSync(`${OUT}/restart-persistence.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}
await ctx.close();
