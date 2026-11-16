import { chromium, devices } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const [OUT, DEV] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext(DEV === "desktop" ? { viewport: { width: 1440, height: 900 } } : { ...devices["iPhone 13"] });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
await page.waitForTimeout(4000);
await page.waitForTimeout(3000);
const chips = await page.evaluate(() => [...document.querySelectorAll("[data-saved-world]")].map((b) => b.textContent.trim()));
console.log("world chips:", JSON.stringify(chips));
if (chips.length === 0) { await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^LÉLU$|navigator|Open the/i.test(b.textContent.trim() + (b.getAttribute("aria-label") ?? "")))?.click()); await page.waitForTimeout(1500); console.log("after open:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("[data-saved-world]")].map((b) => b.textContent.trim())))); }
await page.screenshot({ path: OUT.replace(".png", "-nav.png") });
await page.evaluate(() => document.querySelector("[data-saved-world=moon-oasis]")?.click());
await page.waitForTimeout(15000);
const st = await page.evaluate(() => ({ canvases: document.querySelectorAll("canvas").length, chat: [...document.querySelectorAll("button")].some((b) => /chat/i.test(b.textContent + (b.getAttribute("aria-label") ?? ""))), hasMoon: /Moon Oasis/.test(document.body.innerText) }));
console.log("in world", JSON.stringify(st), "errors", JSON.stringify(errors.slice(0, 3)));
await page.screenshot({ path: OUT });
await browser.close();
