import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.getByText("Continue without an account").count()) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null)) break; }
await page.waitForTimeout(2000);
console.log(JSON.stringify(await page.evaluate(() => {
  const b = document.querySelector("[data-testid=lelu-companion-body]").getBoundingClientRect();
  const pts = [[0.5, 0.6], [0.5, 0.3], [0.5, 0.85]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy]);
  return { body: [b.left, b.top, b.width, b.height], hits: pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); const chain = []; for (let n = e; n && chain.length < 4; n = n.parentElement) chain.push(`${n.tagName.toLowerCase()}${n.dataset?.testid ? "#" + n.dataset.testid : ""}${n.getAttribute("role") ? "[" + n.getAttribute("role") + "]" : ""}.${String(n.className).slice(0, 25)} z=${getComputedStyle(n).zIndex}`); return chain.join(" < "); }) };
})));
await browser.close();
