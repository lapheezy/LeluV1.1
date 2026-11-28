/** iPhone (emulated 390×844): 3 windows → Split, drag divider, Tile (pyramid), Stack (side by side). */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
const errors = []; p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2000);
for (const panel of ["notifications", "browser", "settings"]) { await p.evaluate((panel) => window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel } })), panel); await p.waitForTimeout(2000); }
const rects = () => p.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return `${e.getAttribute("data-lelu-module-window")} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
const pick = async (m) => {
  if (!(await p.locator('[data-lelu-workspace-bar="compact"] [data-lelu-layout]').count())) await p.evaluate(() => document.querySelector('[data-lelu-workspace-bar="compact"] [aria-label="Layout"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(500);
  const ok = await p.evaluate((m) => { const b = document.querySelector(`[data-lelu-workspace-bar="compact"] [data-lelu-layout="${m}"]`); b?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!b; }, m);
  await p.waitForTimeout(1500);
  return ok;
};
const out = { bar: await p.locator('[data-lelu-workspace-bar="compact"]').count() };
out.split = { ok: await pick("split"), rects: await rects() };
await p.screenshot({ path: `${OUT}/phone-1-split.png` });
const d = await p.evaluate(() => { const e = document.querySelector("[data-phone-divider]"); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
if (d) { await p.mouse.move(d[0], d[1]); await p.mouse.down(); await p.mouse.move(d[0], d[1] - 180, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1200); }
out.dragged = { divider: !!d, rects: await rects() };
await p.screenshot({ path: `${OUT}/phone-2-resized.png` });
out.tile = { ok: await pick("tile"), rects: await rects() };
await p.screenshot({ path: `${OUT}/phone-3-pyramid.png` });
out.stack = { ok: await pick("stack"), rects: await rects() };
await p.screenshot({ path: `${OUT}/phone-4-side-by-side.png` });
console.log(JSON.stringify({ ...out, errors }, null, 1));
await b.close();
