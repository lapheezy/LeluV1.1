import { launch, desktop, iphone, boot, seed, openUniverse, shot, track, openSeededChat } from "./harness.mjs";
const browser = await launch();
const errors = [];
const bus = (page, a) => page.evaluate(async (x) => (await import("/src/core/cognition/UIActionBus.ts")).default.getInstance().dispatch(x), a);
async function navigate(page, url) {
  const input = page.locator('[data-lelu-browser] input[aria-label="Browser address"]');
  await input.fill(url); await input.press("Enter");
}
for (const [label, mk] of [["desktop", () => desktop(browser)], ["iphone", () => iphone(browser)]]) {
  const ctx = await mk(); const page = await ctx.newPage(); track(page, errors);
  await boot(page); await seed(page); await openUniverse(page); await openSeededChat(page);
  await bus(page, { type: "open_module", target: "browser", reason: "browser demo", initiatedBy: "user" });
  await page.waitForSelector("[data-lelu-browser]", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, `browser-${label}-0-idle`);
  await navigate(page, "https://en.wikipedia.org/wiki/Bioluminescence");
  const frame = page.frameLocator('[data-lelu-browser] iframe[title="Lélu in-app browser"]');
  const ok = await frame.locator("#firstHeading").waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  console.log(label, "wikipedia rendered:", ok, "heading:", ok ? await frame.locator("#firstHeading").innerText() : null);
  await shot(page, `browser-${label}-1-wikipedia`);
  // second session: a site that refuses embedding
  await page.locator('[data-lelu-browser] button[aria-label="New tab"]').click();
  await navigate(page, "https://github.com/xyflow/xyflow");
  await page.waitForTimeout(6000);
  const slow = await page.locator(".lbr-slow, .lbr-hint").first().isVisible().catch(() => false);
  console.log(label, "github: fallback strip shown:", slow, "| embeddable verdict:", await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("lelu.browser.tabs.v1")) || "null") || "null")?.tabs?.length));
  await shot(page, `browser-${label}-2-refused-banner`);
  await page.locator(".lbr-chip", { hasText: "Reader" }).first().click();
  await page.waitForSelector('.lbr-reader[data-status="read"], .lbr-reader[data-status="failed"]', { timeout: 40000 }).catch(() => {});
  console.log(label, "reader status:", await page.locator(".lbr-reader").getAttribute("data-status").catch(() => null), (await page.locator(".lbr-reader").innerText().catch(() => "")).slice(0, 160).replace(/\n/g, " "));
  await shot(page, `browser-${label}-3-reader`);
  // back to wikipedia tab, beside the chat, then to the board
  await page.locator(".lbr-tab").first().click(); await page.waitForTimeout(1500);
  await page.locator(".lbr-chip", { hasText: "Beside chat" }).click(); await page.waitForTimeout(2000);
  await shot(page, `browser-${label}-4-beside-chat`);
  await page.locator(".lbr-chip", { hasText: "To board" }).click();
  await page.waitForTimeout(1200);
  if (label === "iphone") { await page.locator(".lws-tab", { hasText: "Deep-sea" }).first().click().catch(() => {}); }
  await page.waitForSelector('.lbd-card[data-kind="link"]', { timeout: 20000 }).catch(() => console.log("no link card"));
  await page.waitForTimeout(1500);
  const src = await page.evaluate(() => [...document.querySelectorAll('.lbd-card[data-kind="link"] strong')].map((e) => e.textContent));
  console.log(label, "board link nodes:", JSON.stringify(src));
  await shot(page, `browser-${label}-5-to-board`);
  await ctx.close();
}
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 8));
await browser.close();
