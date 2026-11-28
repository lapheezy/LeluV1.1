/**
 * WP21.4 acceptance in the running app: unified → + Experience → OG (dashboard landing, original apps row,
 * original utility row, Chat Universe on its original backdrop) → back to unified. The same conversation
 * and theme are checked in both modes, and an original is opened without changing the saved mode.
 *   node scripts/landing/og-mode.mjs
 */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const PHONE = process.env.PHONE === "1";
const p = await (await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2500);
const look = () => p.evaluate(async () => {
  const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const W = await import("/src/core/worlds/WorldStore.ts");
  return { mode: localStorage.getItem("lelu.experience.v1") ?? "unified", coreChat: !!document.querySelector("[data-core-chat]"), dashboard: !!document.querySelector("[data-lelu-home]"), appsRow: !!document.querySelector("[data-og-apps-row]"), utilityRow: document.querySelectorAll(".lsn-bar .lsn-item").length, ogBack: !!document.querySelector("[data-og-back]"), universe: document.querySelector(".lcu")?.getAttribute("data-cosmos") ?? null, conversations: MC.list().map((c) => c.title), messages: MC.list().reduce((n, c) => n + c.messages.length, 0), theme: W.activeWorld()?.families?.[0] ?? "primary" };
});
const out = {};
// Unified: say something and pick a theme, so both have shared state to check.
await p.locator("[data-core-chat] textarea").fill("Remember this: the OG test.");
await p.locator(".ccx-send").click();
await p.waitForTimeout(5000);
await p.locator(".ccx-plus").click();
await p.waitForTimeout(400);
await p.locator('[data-theme="aurora"]').click();
await p.waitForTimeout(2500);
out.unified = await look();
await p.screenshot({ path: `${OUT}/01-unified-controls${PHONE ? "-phone" : ""}.png` });
// Switch to OG.
await p.locator("[data-og-switch]").scrollIntoViewIfNeeded();
await p.locator("[data-og-switch]").click();
await p.waitForTimeout(4000);
out.og = await look();
await p.screenshot({ path: `${OUT}/02-og-dashboard${PHONE ? "-phone" : ""}.png` });
// OG Chat Universe: original backdrop.
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForTimeout(3000);
out.ogUniverse = await look();
await p.screenshot({ path: `${OUT}/03-og-chat-universe${PHONE ? "-phone" : ""}.png` });
await p.evaluate(() => document.querySelector('button[aria-label="Close Chat Universe"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(1500);
// Back to unified, one tap.
await p.locator("[data-og-back]").click();
await p.waitForTimeout(4000);
out.back = await look();
await p.screenshot({ path: `${OUT}/04-back-unified${PHONE ? "-phone" : ""}.png` });
// Open one original (LÉLU System UI) from the + tab: the saved mode must not change.
await p.locator(".ccx-plus").click();
await p.waitForTimeout(400);
await p.locator('[data-original="lelu-system"]').click();
await p.waitForTimeout(6000);
out.original = { url: p.url(), mode: await p.evaluate(() => localStorage.getItem("lelu.experience.v1")) };
await p.screenshot({ path: `${OUT}/05-original-lelu-system${PHONE ? "-phone" : ""}.png` });
console.log(JSON.stringify({ ...out, errors: errors.slice(0, 4) }, null, 1));
await b.close();
