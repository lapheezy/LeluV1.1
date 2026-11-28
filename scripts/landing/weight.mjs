/**
 * Lightweight / full weight, measured in the running app: the controls switch, LÉLU switches from the
 * chat, and what the renderer actually does is read back each time.
 *   node scripts/landing/weight.mjs
 */
import { chromium } from "playwright";
const OUT = "docs/missions/unify/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(3000);
const read = () => p.evaluate(() => ({ weight: document.documentElement.dataset.leluWeight, stats: (({ profile, profileReason, override, renderer, fps }) => ({ profile, profileReason, override, renderer: renderer?.slice(0, 40), fps }))(window.__leluRenderStats ?? {}), blur: getComputedStyle(document.querySelector(".ccx-bar")).backdropFilter }));
const out = { start: await read() };
await p.locator(".ccx-plus").click();
await p.waitForTimeout(500);
await p.locator('[data-weight="light"]').click();
await p.waitForTimeout(2000);
out.light = { ...(await read()), says: await p.locator("[data-performance-state]").textContent() };
await p.screenshot({ path: `${OUT}/weight-1-light-controls.png` });
await p.locator(".ccx-plus").click();
const ask = async (text) => {
  await p.locator("[data-core-chat] textarea").fill(text);
  await p.locator(".ccx-send").click();
  await p.waitForTimeout(7000);
  return { ...(await read()), reply: (await p.locator(".ccx-her").textContent().catch(() => ""))?.slice(0, 420) };
};
out.full = await ask("Switch to full weight mode");
await p.screenshot({ path: `${OUT}/weight-2-asked-full.png` });
out.auto = await ask("use auto mode for performance");
await p.screenshot({ path: `${OUT}/weight-3-asked-auto.png` });
console.log(JSON.stringify(out, null, 1));
await b.close();
