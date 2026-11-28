/** Chat Universe in the Cosmos: sessions are a borderless scrolling list. node scripts/landing/universe-cosmos.mjs */
import { chromium } from "playwright";
const OUT = "docs/missions/wp21_4/shots";
const PHONE = process.env.PHONE === "1";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })).newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
await p.evaluate(async () => { const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); for (let i = 0; i < 14; i++) { const c = MC.create(`Session ${i + 1}`); MC.addMessage(c.id, { id: c.id + "m", role: "user", text: `Line from session ${i + 1}: patterns, tasks and notes.`, timestamp: Date.now() - i * 60000, source: "local" }); } });
await p.locator(".ccx-plus").click();
await p.waitForTimeout(400);
await p.locator('[data-open="universe"]').click();
await p.waitForTimeout(3500);
await p.screenshot({ path: `${OUT}/universe-cosmos-0${PHONE ? "-phone" : ""}.png` });
console.log("dom", JSON.stringify(await p.evaluate(() => ({ lcu: !!document.querySelector(".lcu"), grid: !!document.querySelector(".lcu-grid"), cards: document.querySelectorAll(".lcu-card").length, mainLike: [...(document.querySelector(".lcu")?.children ?? [])].map((e) => e.className).slice(0, 8) }))));
const before = await p.evaluate(() => { const m = document.querySelector(".lcu-main"); const cards = [...document.querySelectorAll(".lcu-card")]; return { mode: document.querySelector(".lcu")?.getAttribute("data-cosmos"), cards: cards.length, bordered: cards.filter((c) => parseFloat(getComputedStyle(c).borderTopWidth) > 0 || getComputedStyle(c).backgroundColor !== "rgba(0, 0, 0, 0)").length, scrollable: m.scrollHeight > m.clientHeight, top: m.scrollTop }; });
await p.screenshot({ path: `${OUT}/universe-cosmos-1${PHONE ? "-phone" : ""}.png` });
await p.evaluate(() => { document.querySelector(".lcu-main").scrollBy({ top: 600, behavior: "instant" }); });
await p.waitForTimeout(800);
const after = await p.evaluate(() => document.querySelector(".lcu-main").scrollTop);
await p.screenshot({ path: `${OUT}/universe-cosmos-2-scrolled${PHONE ? "-phone" : ""}.png` });
console.log(JSON.stringify({ before, scrolledTo: after }));
await b.close();
