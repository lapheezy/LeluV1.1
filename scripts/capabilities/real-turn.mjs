/** Send LÉLU a real chat message (free-tier providers only) and capture the reply and any cards. node scripts/capabilities/real-turn.mjs "<message>" <shotName> */
import { mkdir } from "node:fs/promises";
import { launch, track } from "../evolution/harness.mjs";
const [msg, name = "turn"] = process.argv.slice(2);
const OUT = "docs/missions/capabilities/shots";
await mkdir(OUT, { recursive: true });
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
track(p, errors);
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(2000);
const title = `Turn ${name} ${Date.now() % 1e5}`;
await p.evaluate(async (t) => { const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); MC.create(t); }, title);
await p.waitForTimeout(500);
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
await p.evaluate((t) => document.querySelector(`button[aria-label="Open ${t}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })), title);
await p.waitForTimeout(1500);
const box = p.locator('[data-lelu-universe-window] textarea, [data-lelu-universe-window] input[placeholder^="Message"]').last();
await box.fill(msg);
await box.press("Enter");
const t0 = Date.now();
let last = "";
for (let i = 0; i < 90; i++) {
  await p.waitForTimeout(2000);
  const s = await p.evaluate(() => { const m = [...document.querySelectorAll('[data-lelu-universe-window] .lcu-msg[data-role="assistant"]')]; return { n: m.length, text: m.at(-1)?.innerText.slice(0, 600) ?? "", cards: document.querySelectorAll('[data-lelu-universe-window] [data-artifact-id], [data-lelu-universe-window] [data-studio-card], [data-lelu-universe-window] .lcu-artifact').length, working: !!document.querySelector('[data-lelu-universe-window] [data-turn-state="working"], [data-lelu-universe-window] .lcu-typing') }; });
  if (s.text && s.text === last && !s.working && Date.now() - t0 > 15000) break;
  last = s.text;
}
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/turn-${name}.png` });
const final = await p.evaluate(() => { const m = [...document.querySelectorAll('[data-lelu-universe-window] .lcu-msg[data-role="assistant"]')]; return { replies: m.length, text: m.at(-1)?.innerText.slice(0, 1200) ?? "", images: document.querySelectorAll('[data-lelu-universe-window] .lcu-msg img, [data-lelu-universe-window] .lcu-msg canvas, [data-lelu-universe-window] .lcu-msg svg').length }; });
console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), ...final, errors: errors.filter((e) => !/404|favicon/.test(e)).slice(0, 5) }, null, 1));
await b.close();
