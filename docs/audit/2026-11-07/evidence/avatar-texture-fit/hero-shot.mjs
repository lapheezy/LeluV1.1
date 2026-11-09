import { chromium, devices } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) break; }
await page.waitForTimeout(4000);
const el = page.locator("[data-testid=lelu-companion]").first();
await el.screenshot({ path: OUT });
console.log(JSON.stringify(await el.boundingBox()));
await browser.close();
