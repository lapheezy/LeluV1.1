import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.getByText("Continue without an account").count()) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null)) break; }
const fps = () => Promise.race([page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(+(n / 3).toFixed(1)); }; requestAnimationFrame(f); })), new Promise((x) => setTimeout(() => x("no frames in 15s"), 15000))]);
const shotMs = async () => { const t = Date.now(); try { await page.screenshot({ timeout: 30000 }); return Date.now() - t; } catch { return "timeout"; } };
console.log("home fps", await fps(), "shot ms", await shotMs());
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await page.waitForTimeout(4000);
for (let k = 0; k < 3; k++) console.log(`chat (presence on) fps`, await fps(), "shot ms", await shotMs());
await page.evaluate(async () => (await import("/src/core/avatar/CompanionStore.ts")).default.getInstance().setEnabled(false));
await page.waitForTimeout(3000);
for (let k = 0; k < 3; k++) console.log(`chat (presence off) fps`, await fps(), "shot ms", await shotMs());
await page.evaluate(async () => (await import("/src/core/avatar/CompanionStore.ts")).default.getInstance().setEnabled(true));
await browser.close();
