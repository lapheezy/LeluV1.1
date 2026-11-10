import { chromium } from "playwright";
const OUT = "docs/acceptance/live-autonomous/shots";
const b = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { const g=document.querySelector("[data-lelu-signin-gate]"); const btn=g&&[...g.querySelectorAll("button")].find(x=>/^Continue/.test((x.textContent||"").trim())); btn?.click(); });
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/home.png` });
const r = await p.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find(x => (x.getAttribute("aria-label")||"") === "Summon the chat");
  btn?.click();
  await new Promise(res => setTimeout(res, 9000));
  return { clicked: Boolean(btn), chat: Boolean(document.querySelector("[data-lelu-chat-window]")) };
});
await p.screenshot({ path: `${OUT}/summon-9s.png` });
console.log(JSON.stringify(r));
await c.close(); await b.close();
