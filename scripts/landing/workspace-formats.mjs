/**
 * Her workspace below the Cosmos: scroll down from the landing, then several formats, then ask her for one.
 *   node scripts/landing/workspace-formats.mjs   (PHONE=1 for the emulated phone)
 */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const PHONE = process.env.PHONE === "1";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2500);
const sfx = PHONE ? "-phone" : "";
await p.screenshot({ path: `${OUT}/ws-0-landing${sfx}.png` });
// Scroll down from the Cosmos (wheel on desktop, the pill on the phone).
if (PHONE) await p.locator("[data-workspace-pill]").tap(); else { await p.mouse.move(200, 300); await p.mouse.wheel(0, 400); }
await p.waitForSelector("[data-cosmos-workspace]", { timeout: 10000 });
await p.waitForTimeout(3500);
const read = () => p.evaluate(() => ({ format: document.querySelector("[data-cosmos-workspace]")?.getAttribute("data-format"), sections: [...document.querySelectorAll(".cw-section h3")].map((h) => h.textContent), items: document.querySelectorAll("[data-item]").length, counts: document.querySelector(".cw-title small")?.textContent, borders: [...document.querySelectorAll(".cw-item")].filter((e) => parseFloat(getComputedStyle(e).borderTopWidth) > 0).length, scrolls: (() => { const c = document.querySelector("[data-cosmos-workspace]"); return c.scrollHeight > c.clientHeight; })() }));
const out = { opened: await read() };
const formats = PHONE ? ["column", "scatter", "terminal"] : ["bento", "lanes", "scatter", "orbit", "terminal", "freeform"];
for (const f of formats) {
  await p.locator(`[data-format-pick="${f}"]`).click();
  await p.waitForTimeout(1200);
  out[f] = await read();
  await p.screenshot({ path: `${OUT}/ws-${f}${sfx}.png` });
}
// Open an item: it navigates to the real thing.
const first = p.locator(".cw-item, .cw-term-line").first();
const label = await first.textContent();
await first.click();
await p.waitForTimeout(3000);
out.openedItem = { label: label?.slice(0, 60), workspaceClosed: !(await p.locator("[data-cosmos-workspace]").count()), universe: !!(await p.locator(".lcu").count()), panel: await p.evaluate(() => document.querySelector("[data-lelu-module-window]")?.getAttribute("data-lelu-module-window") ?? null) };
await p.screenshot({ path: `${OUT}/ws-opened-item${sfx}.png` });
console.log(JSON.stringify({ ...out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
