/**
 * Phase 9 visual evidence: the real app, a real Supabase account, a real chat.
 *
 *   LELU_BASE=http://127.0.0.1:5174/ LELU_UI_EMAIL=… LELU_UI_PASSWORD=… \
 *   node scripts/verify-usage-ui.cjs <device|desktop> <outDir>
 *
 * 1. signed out  → Settings › Usage & budgets says "kept on this device only"   (before)
 * 2. sign in, send one real chat turn (gated, settled to the account)
 * 3. Settings    → "Synced to your account", account-wide totals              (after)
 * 4. set "All AI providers: 1 request/day" in the UI, send another message
 *    → the chat answers with the budget notice; no provider was called       (enforcement)
 *
 * Credentials come from the environment only and are never printed.
 */
const fs = require("node:fs");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [kind, outDir] = process.argv.slice(2);
const tag = kind.replace(/\s/g, "");

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  let ctx = kind === "desktop" ? await browser.newContext({ viewport: { width: 1440, height: 900 } }) : await browser.newContext({ ...devices[kind] });
  let page = await ctx.newPage();
  const errors = [];
  const providerCalls = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("request", (r) => { if (/\/api\/model\/.+\/chat/.test(r.url())) providerCalls.push(r.url().replace(BASE, "/")); });

  const openPanel = (t) => page.evaluate(async (target) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target, reason: "verify", initiatedBy: "lelu" });
  }, t);
  const showUsage = async (name) => {
    await openPanel("settings");
    await page.waitForTimeout(1500);
    await page.getByTestId("usage-sync-status").scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/${name}-${tag}.png`, timeout: 60000 });
    return page.getByTestId("usage-sync-status").innerText().catch(() => "missing");
  };
  // The window frame's close control is a bare "✕" button (no aria-label).
  const signIn = async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-lelu-signin-gate] input", { state: "visible", timeout: 30000 });
    await page.locator("[data-lelu-signin-gate] input").nth(0).fill(process.env.LELU_UI_EMAIL);
    await page.locator("[data-lelu-signin-gate] input").nth(1).fill(process.env.LELU_UI_PASSWORD);
    await page.locator("[data-lelu-signin-gate] button", { hasText: "Sign in" }).click();
    await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 30000 }).catch(() => errors.push("sign-in gate did not close"));
    await page.waitForTimeout(6000);
  };
  const closeSettings = async () => {
    const close = page.locator("button", { hasText: /^[✕×]$/ });
    const n = await close.count();
    for (let i = n - 1; i >= 0; i -= 1) {
      if (await close.nth(i).isVisible()) { await close.nth(i).click().catch(() => {}); break; }
    }
    await page.waitForTimeout(1200);
  };
  const chat = async (text) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openPanel("chat");
      const shown = await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 8000 }).then(() => true, () => false);
      if (shown) break;
      await closeSettings();
    }
    await page.locator("[data-lelu-composer] textarea").fill(text);
    await page.locator("[data-lelu-composer] textarea").press("Enter").catch(() => page.getByRole("button", { name: "Send message" }).click({ noWaitAfter: true, force: true }));
    await page.waitForTimeout(20000);
  };

  // 1. signed out
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 });
  await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    [...(gate?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click();
  });
  await page.waitForTimeout(3000);
  const before = await showUsage("before-signed-out");

  // 2. sign in — a fresh browser context, as a new device would be
  await ctx.close();
  ctx = kind === "desktop" ? await browser.newContext({ viewport: { width: 1440, height: 900 } }) : await browser.newContext({ ...devices[kind] });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("request", (r) => { if (/\/api\/model\/.+\/chat/.test(r.url())) providerCalls.push(r.url().replace(BASE, "/")); });
  await signIn();
  const callsBefore = providerCalls.length;
  await chat("In one sentence: what is a tardigrade?");
  const callsForTurn = providerCalls.length - callsBefore;
  await page.screenshot({ path: `${outDir}/chat-signed-in-${tag}.png`, timeout: 60000 });
  await page.click("button[aria-label='Close chat']", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(4000); // let the sync flush
  const after = await showUsage("after-synced");

  const notSentBefore = await page.locator("text=I didn't send this to").count();
  // 4. budget through the UI, then enforcement in chat
  await page.getByLabel("Budget applies to").selectOption("ai");
  await page.getByLabel("Provider or source").selectOption("*");
  await page.getByLabel("requests/day").fill("1");
  await page.getByRole("button", { name: "Save budget" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/budget-set-${tag}.png`, timeout: 60000 });
  // Another device: a fresh browser, the same user. The budget saved above
  // lives in the account, so it must stop this device's call too.
  await ctx.close();
  ctx = kind === "desktop" ? await browser.newContext({ viewport: { width: 1440, height: 900 } }) : await browser.newContext({ ...devices[kind] });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("request", (r) => { if (/\/api\/model\/.+\/chat/.test(r.url())) providerCalls.push(r.url().replace(BASE, "/")); });
  await signIn();
  const callsBeforeBlocked = providerCalls.length;
  await chat("And how long can it survive without water?");
  const blockedCalls = providerCalls.length - callsBeforeBlocked;
  await page.screenshot({ path: `${outDir}/chat-budget-notice-${tag}.png`, timeout: 60000 });
  const notices = page.locator("text=I didn't send this to");
  const notice = (await notices.count()) > notSentBefore ? await notices.last().innerText() : "notice not found";

  const result = { kind, before, after, providerCallsForFirstTurn: callsForTurn, noticesBeforeBudget: notSentBefore, providerCallsAfterBudget: blockedCalls, notice, errors };
  fs.writeFileSync(`${outDir}/ui-run-${tag}.json`, JSON.stringify(result, null, 1) + "\n");
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})();
