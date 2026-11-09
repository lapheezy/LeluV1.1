import { chromium, devices } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.getByText("Continue without an account").count()) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null)) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await page.waitForTimeout(2500);
await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
await page.waitForTimeout(4000);
const fps = () => Promise.race([page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 5000) requestAnimationFrame(f); else r(+(n / 5).toFixed(1)); }; requestAnimationFrame(f); })), new Promise((x) => setTimeout(() => x(0), 20000))]);
const state = await page.evaluate(() => { const e = document.querySelector("[data-testid=lelu-companion]"); const b = e?.querySelector("[data-testid=lelu-companion-body]")?.getBoundingClientRect(); return { sheet: !!document.querySelector("[data-lelu-fullscreen]"), place: e?.dataset.presence, body: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null }; });
console.log("state", JSON.stringify(state));
console.log("dom", JSON.stringify(await page.evaluate(() => {
  const e = document.querySelector("[data-testid=lelu-companion]"); const b = e.querySelector("[data-testid=lelu-companion-body]").getBoundingClientRect();
  const img = e.querySelector("[data-testid=lelu-companion-still]");
  const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  const sheet = document.querySelector("[data-lelu-fullscreen]");
  const chain = []; for (let n = e; n && chain.length < 8; n = n.parentElement) chain.push(`${n.tagName.toLowerCase()}${n.dataset?.testid ? "#" + n.dataset.testid : ""}[inline=${n.style.visibility || "-"} vis=${getComputedStyle(n).visibility}]`); return { chain, inlineVis: e.style.visibility, scene: e.dataset.scene, panel: e.dataset.panel, z: getComputedStyle(e).zIndex, vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity, transform: getComputedStyle(e).transform.slice(0, 60), w: e.style.width, h: e.style.height, img: img ? img.src.length : null, sheetZ: sheet ? getComputedStyle(sheet).zIndex : null, sheetParentZ: sheet?.parentElement ? getComputedStyle(sheet.parentElement).zIndex : null, top: `${top?.tagName}.${String(top?.className).slice(0, 30)} ${top?.closest("[data-testid=lelu-companion]") ? "(her)" : ""}`, herParent: e.parentElement?.tagName + "." + String(e.parentElement?.className).slice(0, 30) + " z=" + getComputedStyle(e.parentElement).zIndex };
})));
await browser.close(); process.exit(0);
const samples = []; const t0 = Date.now();
while (Date.now() - t0 < 60000) samples.push(await fps());
const frames0 = await page.evaluate(() => Number(document.querySelector("[data-testid=lelu-companion] [data-frames]")?.dataset.frames ?? 0));
await page.waitForTimeout(5000);
const frames1 = await page.evaluate(() => Number(document.querySelector("[data-testid=lelu-companion] [data-frames]")?.dataset.frames ?? 0));
console.log("page fps per 5s window over 60s:", JSON.stringify(samples), "min", Math.min(...samples));
console.log("avatar frames per second under the sheet:", ((frames1 - frames0) / 5).toFixed(1));
await page.screenshot({ path: "sheet-presence.png" });
await browser.close();
