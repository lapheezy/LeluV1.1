let out0;
/** Two windows open; press Tile, then Split; measure the window rectangles. */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2000);
for (const panel of ["notifications", "browser"]) { await p.evaluate((panel) => window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel } })), panel); await p.waitForTimeout(2500); }
const rects = () => p.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return `${e.getAttribute("data-lelu-module-window")} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
out0 = await p.evaluate(() => [...document.querySelectorAll('[data-lelu-layout="tile"]')].map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], visible: getComputedStyle(e).visibility, top: top ? top.tagName + "." + String(top.className).slice(0, 60) + " " + (top.closest("[data-testid]")?.getAttribute("data-testid") ?? "") : null }; }));
console.log("tile-btn", JSON.stringify(out0));
const out = { before: await rects(), modes: await p.evaluate(() => [...document.querySelectorAll("[data-lelu-layout]")].map((e) => e.getAttribute("data-lelu-layout"))) };
for (const m of ["tile", "split"]) {
  const btn = p.locator(`[data-lelu-layout="${m}"]`).first();
  if (!(await btn.count())) { out[m] = "no button"; continue; }
  await btn.click({ timeout: 5000 }).catch((e) => (out[m + "Click"] = String(e).split("\n")[0]));
  await p.waitForTimeout(1500);
  out[m] = await rects();
  await p.screenshot({ path: `${OUT}/layout-${m}.png` });
}
console.log(JSON.stringify({ ...out, errors }, null, 1));
await b.close();
