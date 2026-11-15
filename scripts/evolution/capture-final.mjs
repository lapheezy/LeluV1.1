import { launch, desktop, iphone, boot, seed, openUniverse, shot, track, openSeededChat } from "./harness.mjs";
const browser = await launch();
const errors = [];
const bus = (page, a) => page.evaluate(async (x) => (await import("/src/core/cognition/UIActionBus.ts")).default.getInstance().dispatch(x), a);
const geo = (page) => page.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].filter((e) => getComputedStyle(e).display !== "none" && e.getAttribute("data-lelu-steward")).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute("data-lelu-module-window").slice(0, 12), Math.round(r.width)]; }));
const tabs = (page) => page.locator(".lws-tab").count();

/* 1. Reorganising as the space changes */
{
  const ctx = await desktop(browser); const page = await ctx.newPage(); track(page, errors);
  await boot(page); await seed(page); await openUniverse(page); await openSeededChat(page);
  for (const m of ["projects", "browser", "eng-studio", "voice-studio", "security-center", "infra-monitor", "agents"]) { await bus(page, { type: "open_module", target: m, reason: "demo", initiatedBy: "user" }); await page.waitForTimeout(250); }
  await bus(page, { type: "arrange_workspace", target: "tile", modules: [], reason: "demo", initiatedBy: "lelu" });
  for (const [w, h] of [[1440, 900], [1024, 768], [820, 1000], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(3200);
    const shown = await geo(page);
    console.log(`viewport ${w}x${h}: shown=${shown.length} ${JSON.stringify(shown)} tabs=${await tabs(page)}`);
    await shot(page, `fit-${w}`);
  }
  await ctx.close();
}

/* 2. Cosmos: button, backdrop, return; state preserved */
if (process.argv[2] !== "fit-only") for (const [label, mk] of [["desktop", () => desktop(browser)], ["iphone", () => iphone(browser)]]) {
  const ctx = await mk(); const page = await ctx.newPage(); track(page, errors);
  await boot(page); await seed(page);
  await shot(page, `cosmos-${label}-0-home`);
  await page.locator('button[aria-label="Look at the Cosmos"]').first().click({ timeout: 5000 }).catch((e) => console.log("cosmos btn", String(e).slice(0, 100)));
  await page.waitForTimeout(2500);
  const immersive = await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.get().immersive);
  console.log(label, "Cosmos button → immersive:", immersive);
  await shot(page, `cosmos-${label}-1-immersive`);
  await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.setImmersive(false));
  await page.waitForTimeout(1000);
  // Into Chat Universe, open the chat, put it on the board stage, then flip the backdrop.
  await openUniverse(page); await openSeededChat(page); await page.waitForTimeout(800);
  await page.locator('[data-lelu-stage="board"]').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const mode0 = await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.get().cosmosMode);
  await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.setCosmosMode("floating"));
  await page.waitForTimeout(2200);
  const mode1 = await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.get().cosmosMode);
  console.log(label, "backdrop toggle:", mode0, "→", mode1, "| live canvas present:", await page.locator("canvas").count());
  await shot(page, `cosmos-${label}-2-backdrop-floating`);
  await page.evaluate(async () => (await import("/src/app/scene/genesis/home/homeStore.ts")).default.setCosmosMode("workspace"));
  // Close the Universe → home Cosmos, then come back: windows + stage + conversation intact?
  await page.evaluate(async () => (await import("/src/app/scene/genesis/chat/universe/universeOpen.ts")).setUniverseOpen(false));
  await page.waitForTimeout(1500);
  await shot(page, `cosmos-${label}-3-back-home`);
  await openUniverse(page); await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ windows: [...document.querySelectorAll('[data-lelu-module-window^="chat:"]')].length, stage: document.querySelector(".lst-root")?.getAttribute("data-stage"), messages: document.querySelectorAll(".lcu-msg").length, boardNodes: document.querySelector(".lbd")?.getAttribute("data-nodes") }));
  console.log(label, "after Cosmos round trip:", JSON.stringify(after));
  await shot(page, `cosmos-${label}-4-returned`);
  await ctx.close();
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 8));
await browser.close();
