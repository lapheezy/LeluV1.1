import { launch, desktop, iphone, boot, seed, openUniverse, shot, track, openSeededChat } from "./harness.mjs";
import { devices } from "playwright";
const browser = await launch();
const errors = [];
const bus = (page, action) => page.evaluate(async (a) => {
  const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
  return Bus.getInstance().dispatch(a);
}, action);
const geometry = (page) => page.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { id: el.getAttribute("data-lelu-module-window"), shown: cs.display !== "none", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), z: cs.zIndex };
}));
const tag = process.argv[2] ?? "after";
for (const [label, mk] of [["iphone", () => iphone(browser)], ["iphone-landscape", () => browser.newContext({ ...devices["iPhone 15 Pro landscape"] })], ["desktop", () => desktop(browser)]]) {
  const ctx = await mk();
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);
  await seed(page);
  await openUniverse(page);
  console.log(label, "chat window:", await openSeededChat(page));
  await page.waitForTimeout(700);
  for (const m of ["projects", "browser", "eng-studio"]) { await bus(page, { type: "open_module", target: m, reason: "steward test", initiatedBy: "user" }); await page.waitForTimeout(500); }
  await page.waitForTimeout(1400);
  await shot(page, `${tag}-${label}-1-auto`);
  console.log(label, "auto", JSON.stringify(await geometry(page)));
  const r = await bus(page, { type: "arrange_workspace", target: "split", modules: ["browser"], reason: "put the browser beside the chat", initiatedBy: "lelu" });
  console.log(label, "split→", r.detail);
  await page.waitForTimeout(1200);
  await shot(page, `${tag}-${label}-2-split`);
  if (label === "desktop") {
    await bus(page, { type: "arrange_workspace", target: "tile", modules: [], reason: "tile", initiatedBy: "lelu" });
    await page.waitForTimeout(1200);
    await page.click("[data-lelu-workspace-bar] button[aria-label='Why this layout']").catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${tag}-${label}-3-tile-why`);
    console.log(label, "tile", JSON.stringify(await geometry(page)));
  } else {
    await page.click("[data-lelu-workspace-bar] button[aria-label='Why this layout']").catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${tag}-${label}-3-why`);
  }
  await ctx.close();
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 8));
await browser.close();
