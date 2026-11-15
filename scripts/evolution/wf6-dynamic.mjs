/** Workflow 6: move through environments without losing work; LÉLU organises windows from words; state survives a reload. */
import { launch, desktop, iphone, boot, openUniverse, shot, track, seed, openSeededChat, send, stage, works, goStage } from "./harness.mjs";
const label = process.argv[2] ?? "desktop";
const browser = await launch(); const errors = [];
const ctx = await (label === "iphone" ? iphone(browser) : desktop(browser)); const page = await ctx.newPage(); track(page, errors);
const out = { tour: [] };
await boot(page); const id = await seed(page); await openUniverse(page); await openSeededChat(page);
const snapshot = async (s) => ({ stage: s, messages: await page.evaluate(async (cid) => (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance().get(cid).messages.length, id), works: (await works(page, id)).length, boardNodes: await page.locator(".lbd").getAttribute("data-nodes").catch(() => null) });
// Make some work first (a diagram via words, a note on the board).
await send(page, "make a diagram of this", 3500);
out.afterWords = { stage: await stage(page), works: (await works(page, id)).map((w) => `${w.kind}:${w.medium ?? ""}`) };
await goStage(page, "board"); await page.waitForSelector(".lbd-card", { timeout: 20000 }).catch(() => {});
await page.locator(".lbd-tools .lst-chip", { hasText: "+ Note" }).click().catch(() => {}); await page.waitForTimeout(800);
for (const s of ["conversation", "research", "board", "gallery", "present", "spatial", "document", "diagram", "board", "conversation"]) {
  await goStage(page, s); await page.waitForTimeout(s === "spatial" ? 2500 : 1200);
  out.tour.push(await snapshot(s));
  if (["research", "gallery", "spatial"].includes(s)) await shot(page, `wf6-${label}-tour-${s}`);
}
// LÉLU organises from words: open the browser and Projects, then ask.
await page.evaluate(async () => { const B = (await import("/src/core/cognition/UIActionBus.ts")).default.getInstance(); for (const m of ["projects", "browser"]) B.dispatch({ type: "open_module", target: m, reason: "wf6", initiatedBy: "user" }); });
await page.waitForTimeout(1500);
await page.locator(".lws-tab", { hasText: "Deep-sea" }).first().click().catch(() => {}); await page.waitForTimeout(800);
await send(page, "put the browser beside the chat", 3000);
out.split = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-steward]")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.getAttribute("data-lelu-module-window").slice(0, 10)));
await shot(page, `wf6-${label}-beside`);
await send(page, "tile my windows", 3000);
out.tile = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-steward]")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.getAttribute("data-lelu-module-window").slice(0, 10)));
out.reply = await page.evaluate(async (cid) => { const m = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance().get(cid).messages; const r = m[m.length - 1]; return { provider: r.provider, text: r.text.slice(0, 160) }; }, id);
out.stewardLog = await page.evaluate(async () => (await import("/src/core/interface/WorkspaceStewardStore.ts")).default.get().log.slice(-5).map((d) => `${d.by}: ${d.what} · modelCalls ${d.modelCalls}`));
await shot(page, `wf6-${label}-tiled`);
// Reload: conversation, works, board note and the chosen stage come back.
await goStage(page, "board").catch(() => {});
await boot(page); await openUniverse(page); await page.waitForTimeout(2000);
out.afterReload = { windows: await page.locator('[data-lelu-module-window^="chat:"]').count(), stage: await stage(page), ...(await snapshot("after-reload")) };
await shot(page, `wf6-${label}-after-reload`);
console.log(JSON.stringify(out, null, 1));
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 6));
await browser.close();
