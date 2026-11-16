import { launch, desktop, iphone, boot, openUniverse, shot, track } from "./harness.mjs";
const browser = await launch(); const errors = [];
for (const [label, mk] of [["desktop", () => desktop(browser)], ["iphone", () => iphone(browser)]]) {
  const ctx = await mk(); const page = await ctx.newPage(); track(page, errors);
  await boot(page); await openUniverse(page);
  await page.locator("[data-lelu-evolution-trail]").click();
  const ok = await page.waitForSelector(".lst-tile img", { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2500);
  console.log(label, "trail gallery:", ok, "tiles:", await page.locator(".lst-tile").count(), "stage:", await page.locator(".lst-root").getAttribute("data-stage").catch(() => null));
  await shot(page, `trail-${label}-gallery`);
  await page.locator(".lst-tile").nth(6).click().catch(() => {}); await page.waitForTimeout(1500);
  await shot(page, `trail-${label}-lightbox`);
  await ctx.close();
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")));
await browser.close();
