import { launch, desktop, iphone, boot, seed, openUniverse, shot, track, openSeededChat } from "./harness.mjs";
const browser = await launch(); const errors = [];
const label = process.argv[2] ?? "desktop";
const ctx = await (label === "iphone" ? iphone(browser) : desktop(browser)); const page = await ctx.newPage(); track(page, errors);
await boot(page); await seed(page); await openUniverse(page); await openSeededChat(page); await page.waitForTimeout(800);
for (const s of ["research", "document", "diagram", "data", "code", "film", "voice", "studio", "gallery", "spatial", "present"]) {
  for (let k = 0; k < 3; k++) { if ((await page.locator(".lst-root").getAttribute("data-stage").catch(() => "")) === s) break; await page.locator(`[data-lelu-stage="${s}"]`).first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(600); }
  await page.waitForTimeout(1800);
  const ok = await page.locator(`[data-lelu-env-view], [data-lelu-stage-view]`).count();
  console.log(s, "rendered views:", ok);
  await shot(page, `env-${label}-${s}`);
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 6));
await browser.close();
