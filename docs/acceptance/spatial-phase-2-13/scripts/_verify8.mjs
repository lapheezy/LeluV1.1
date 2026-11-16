import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ["--no-sandbox","--headless=new","--enable-unsafe-swiftshader","--disable-dev-shm-usage"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3500);
await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => (x.textContent??"").toLowerCase().includes("continue without an account"))?.click(); });
await page.waitForTimeout(1500);
const c = await (await page.$(".lch-cosmos"))?.boundingBox();
if (c) await page.mouse.click(c.x + c.width/2, c.y + c.height/2);
await page.waitForTimeout(4000);
const cur = () => page.evaluate(() => window.__leluSpatial?.getState?.().current ?? null);
const waitFor = async (want, budget = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < budget) { if (await cur() === want) return Date.now() - t0; await page.waitForTimeout(200); } return -1; };
console.log("boot", await cur());
const chip = await page.evaluate(() => { const el = document.querySelector('[data-spatial-scene="studio"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; });
if (chip) { await page.mouse.click(chip.x, chip.y); console.log("rail->studio ms", await waitFor("studio")); }
const core = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
if (core) { await page.mouse.click(core.x+core.width/2, core.y+core.height/2); console.log("back->core ms", await waitFor("core")); }
await page.waitForTimeout(1500);
for (const dest of ["files","studio"]) {
  const m = await page.evaluate((wanted) => { const p = window.__leluPortalField?.().portals.find(x => x.destination === wanted); const canvas = document.querySelector('[data-spatial-canvas="genesis"]'); if(!p) return null; for (let r=0;r<=2;r++){const s=r*9;for(let dx=-s;dx<=s;dx+=9)for(let dy=-s;dy<=s;dy+=9){const x=Math.round(p.screen.x+dx),y=Math.round(p.screen.y+dy);if(document.elementFromPoint(x,y)===canvas&&window.__leluPortalPick?.(x,y)?.portalId===p.id)return{x,y,id:p.id};}} return null; }, dest);
  if (!m) { console.log(dest, "no pixel"); continue; }
  await cdp.send("Input.dispatchMouseEvent", { type:"mouseMoved", x:m.x, y:m.y, button:"none", clickCount:0 });
  await cdp.send("Input.dispatchMouseEvent", { type:"mousePressed", x:m.x, y:m.y, button:"left", clickCount:1 });
  await cdp.send("Input.dispatchMouseEvent", { type:"mouseReleased", x:m.x, y:m.y, button:"left", clickCount:1 });
  const ms = await waitFor(dest);
  const t = await page.evaluate(() => { const e = window.__leluPortalEvents?.at(-1); return e ? e.delivered.portalId : null; });
  console.log("portal", dest, "arrived", await cur(), "ms", ms, "delivered", t);
  const c2 = await (await page.$('[data-spatial-control="core"]'))?.boundingBox();
  if (c2) { await page.mouse.click(c2.x+c2.width/2, c2.y+c2.height/2); await waitFor("core"); }
}
await b.close();
