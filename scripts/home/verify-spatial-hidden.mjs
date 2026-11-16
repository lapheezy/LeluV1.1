/**
 * The Spatial bar is put away on the Home: a tab on the left edge, the
 * menu entry, or asking LÉLU opens it; ✕, Escape or asking puts it away.
 * A picture at every step: docs/missions/m15-home/shots-15.2/.
 */
import { chromium } from "playwright";
const OUT = "docs/missions/m15-home/shots-15.2";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
let n = 0;
async function step(p, name, ok, note = "") {
  n++;
  const file = `${OUT}/step-${String(n).padStart(2, "0")}-${ok ? "ok" : "FAIL"}-${name}.png`;
  await p.screenshot({ path: file });
  results.push({ n, name, ok, note, file });
  console.log(`${ok ? "PASS" : "FAIL"} ${n} ${name} ${note}`);
}
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);
async function enter(vp) {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(8000);
  for (let i = 0; i < 3; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) { await c.first().click({ force: true }); await p.waitForTimeout(1500); } }
  await p.waitForTimeout(1200);
  return { ctx, p };
}
for (const [dev, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 393, height: 852 }]]) {
  const { ctx, p } = await enter(vp);
  await step(p, `${dev}-home-bar-gone`, !(await vis(p, "[data-spatial-nav]")) && (await vis(p, "[data-spatial-nav-tab]")), "bar hidden, side tab present");
  await p.click("[data-spatial-nav-tab]");
  await p.waitForTimeout(600);
  await step(p, `${dev}-tab-opens-bar`, await vis(p, "[data-spatial-nav]"));
  if (dev === "desktop") {
    const overlap = await p.evaluate(() => { const a = document.querySelector("[data-spatial-nav] > div")?.getBoundingClientRect(); const c = document.querySelector("nav.lsn")?.getBoundingClientRect(); return a && c ? a.bottom > c.top && a.top < c.bottom : false; });
    await step(p, `${dev}-bar-clear-of-home-nav`, !overlap);
  }
  await p.click('[data-spatial-control="hide"]');
  await p.waitForTimeout(600);
  await step(p, `${dev}-x-puts-it-away`, !(await vis(p, "[data-spatial-nav]")) && (await vis(p, "[data-spatial-nav-tab]")));
  await p.click('button[aria-label="Open the app library"]');
  await p.waitForTimeout(800);
  await step(p, `${dev}-menu-has-spatial`, await vis(p, "[data-spatial-menu-entry]"));
  await p.click("[data-spatial-menu-entry]");
  await p.waitForTimeout(800);
  await step(p, `${dev}-menu-opens-bar`, await vis(p, "[data-spatial-nav]"));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  await step(p, `${dev}-escape-puts-it-away`, !(await vis(p, "[data-spatial-nav]")));
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForTimeout(8000);
  await step(p, `${dev}-reload-stays-away`, !(await vis(p, "[data-spatial-nav]")) && (await vis(p, "[data-spatial-nav-tab]")));
  await ctx.close();
}
// LÉLU: through the real chat router.
{
  const { ctx, p } = await enter({ width: 1440, height: 900 });
  const ask = async (words) => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await p.waitForTimeout(1500);
    // The chat window's own composer when a chat is open, else the Universe's.
    const win = p.locator("textarea[placeholder^='Message LÉLU —']");
    let box = (await win.count()) && (await win.first().isVisible()) ? win.first() : p.locator(".lcu-input textarea");
    if (await box.isDisabled()) {
      const fresh = p.getByRole("button", { name: /new chat|start a chat|new conversation/i }).first();
      if (await fresh.count()) await fresh.click();
      await p.waitForTimeout(1000);
    }
    await box.click();
    await box.fill(words);
    await box.press("Enter");
    await p.waitForTimeout(4000);
  };
  await ask("open the spatial menu");
  await step(p, "lelu-reply-open", await p.evaluate(() => document.body.innerText.includes("The spatial bar is open")), "LÉLU answered");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  if (await p.getByRole("button", { name: "Close Chat Universe" }).isVisible().catch(() => false)) await p.getByRole("button", { name: "Close Chat Universe" }).click();
  await p.waitForTimeout(1200);
  const shown = await p.evaluate(() => document.body.dataset.spatialNavShown);
  await step(p, "lelu-opened-bar", shown === "true" && (await vis(p, "[data-spatial-nav]")), `body flag ${shown}`);
  await ask("hide the spatial bar");
  await step(p, "lelu-reply-hide", await p.evaluate(() => document.body.innerText.includes("Put away.")));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  if (await p.getByRole("button", { name: "Close Chat Universe" }).isVisible().catch(() => false)) await p.getByRole("button", { name: "Close Chat Universe" }).click();
  await p.waitForTimeout(1200);
  await step(p, "lelu-hid-bar", !(await vis(p, "[data-spatial-nav]")) && (await vis(p, "[data-spatial-nav-tab]")));
  await ctx.close();
}
await b.close();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
