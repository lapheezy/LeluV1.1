import { launch, desktop, iphone, boot, seed, openUniverse, shot, track } from "./harness.mjs";
import { devices } from "playwright";
const browser = await launch();
const errors = [];
const openModule = (page, target) => page.evaluate(async (t) => {
  const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
  return Bus.getInstance().dispatch({ type: "open_module", target: t, reason: "before capture", initiatedBy: "user" });
}, target);
const contexts = [
  ["desktop", () => desktop(browser)],
  ["iphone", () => iphone(browser)],
  ["iphone-landscape", () => browser.newContext({ ...devices["iPhone 15 Pro landscape"] })],
];
for (const [label, mk] of contexts) {
  const ctx = await mk();
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);
  if (label !== "iphone-landscape") await shot(page, `before-${label}-0-home-cosmos`);
  await seed(page);
  await openUniverse(page);
  if (label !== "iphone-landscape") await shot(page, `before-${label}-1-universe`);
  await page.locator(".lcu-card", { hasText: "Deep-sea" }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, `before-${label}-2-chat-window`);
  const results = [];
  for (const m of ["projects", "browser", "eng-studio"]) { results.push(await openModule(page, m)); await page.waitForTimeout(700); }
  await page.waitForTimeout(1200);
  await shot(page, `before-${label}-3-many-windows`);
  console.log(label, JSON.stringify(results));
  await ctx.close();
}
console.log("errors:", errors.slice(0, 8));
await browser.close();
