import { launch, desktop, iphone, boot, seed, openUniverse, shot, track, openSeededChat } from "./harness.mjs";
const browser = await launch();
const errors = [];
const results = {};
const stageOf = (page) => page.evaluate(() => document.querySelector("[data-lelu-universe-window]")?.closest(".lst-root")?.getAttribute("data-stage"));
async function say(page, text) {
  const requests = [];
  const onReq = (r) => { const u = r.url(); if (!/\.(png|webp|jpg|svg|css|js|mjs|tsx?|woff2?)(\?|$)/.test(u) && !u.includes("/@") && !u.includes("/node_modules/") && !u.includes("/src/")) requests.push(`${r.method()} ${u}`); };
  page.on("request", onReq);
  const box = page.locator(".lst-composer textarea").first();
  await box.fill(text);
  await box.press("Enter");
  await page.waitForTimeout(3500);
  page.off("request", onReq);
  const reply = await page.evaluate(async () => {
    const { default: Store } = await import("/src/core/multichat/MultiChatStore.ts");
    const c = Store.getInstance().getActive();
    const last = [...(c?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    return last ? { provider: last.provider, text: last.text.slice(0, 220) } : null;
  });
  return { requests, reply };
}
for (const [label, mk] of [["desktop", () => desktop(browser)], ["iphone", () => iphone(browser)]]) {
  const ctx = await mk();
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);
  await seed(page);
  await openUniverse(page);
  await openSeededChat(page);
  await page.waitForTimeout(1200);
  await shot(page, `stage-${label}-0-conversation`);
  for (const s of ["cinematic", "gallery", "present", "board", "spatial"]) {
    for (let k = 0; k < 3 && (await stageOf(page)) !== s; k += 1) {
      await page.locator(`[data-lelu-stage="${s}"]`).first().click({ timeout: 4000 }).catch((e) => console.log("click", s, String(e).slice(0, 120)));
      await page.waitForTimeout(700);
    }
    const ready = { cinematic: ".lst-cine-chapter", gallery: ".lst-tile img", present: ".lst-slide", board: ".lbd-card", spatial: ".lsp-card" }[s];
    await page.waitForSelector(ready, { timeout: 20000 }).catch(() => console.log("not ready", s));
    await page.waitForTimeout(1300);
    if (s === "cinematic") { await page.evaluate(() => document.querySelector(".lst-cine")?.scrollTo({ top: 900 })); await page.waitForTimeout(900); }
    if (s === "present") { await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(900); }
    await shot(page, `stage-${label}-${s}`);
    const view = await page.evaluate(() => { const v = document.querySelector("[data-lelu-stage-view]"); return v ? Object.fromEntries([...v.attributes].map((a) => [a.name, a.value])) : null; });
    console.log(label, s, JSON.stringify(view));
    if (s === "present") await page.locator('button[aria-label="End presentation"]').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  // Back to chat, then LÉLU is TOLD in words, through the real send path.
  await page.locator('[data-lelu-stage="conversation"]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  const r1 = await say(page, "Turn this into a visual research board");
  results[`${label}-board`] = { ...r1, stage: await stageOf(page) };
  await shot(page, `self-${label}-1-board-by-words`);
  const r2 = await say(page, "Make this cinematic");
  results[`${label}-cinematic`] = { ...r2, stage: await stageOf(page) };
  await shot(page, `self-${label}-2-cinematic-by-words`);
  console.log(label, JSON.stringify(results, null, 1).slice(0, 2500));
  await ctx.close();
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 8));
await browser.close();
