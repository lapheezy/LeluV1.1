/**
 * Does a NEW account actually get cloud memory, and does she answer after
 * signing up? Runs the real app in a phone-sized Safari-ish context:
 *
 *   1. fresh storage → the sign-in gate
 *   2. "Create account" with a throwaway address
 *   3. report persistence status, hydration and any Supabase warning
 *   4. ask a question in the Chat Universe and record the reply
 *
 * Usage: node artifacts/mission-chat-universe-1/signin-memory-check.mjs [base]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now();
const EMAIL = `lelu.review.${stamp}@example.com`;
const PASSWORD = `Review-${stamp}-aA1!`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const logs = [];
page.on("console", (m) => {
  const text = m.text();
  if (/lélu|lelu|supabase|hydrat|auth|provider|groq/i.test(text)) logs.push(`${m.type()}: ${text.slice(0, 240)}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.slice(0, 240)}`));

const shot = (name) => page.screenshot({ path: join(SHOTS, `signin-${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);

const result = { email: EMAIL, steps: {} };
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(4000);
  // Fresh device: no skip flag, no session.
  await page.evaluate(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => /lelu|supabase|sb-/i.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage blocked */
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(5000);

  const gate = page.locator("[data-lelu-signin-gate]");
  result.steps.gateVisible = (await gate.count()) > 0;
  await shot("01-gate");

  if (!result.steps.gateVisible) {
    // Something (a session) already answered; report the state we actually see.
    result.steps.gateText = (await page.locator("body").innerText()).slice(0, 400);
  } else {
    await gate.locator('input[type="email"]').fill(EMAIL, { timeout: 8000 });
    await gate.locator('input[type="password"]').fill(PASSWORD, { timeout: 8000 });
    await gate.getByRole("button", { name: /create account/i }).click({ timeout: 8000 });
    await wait(7000);
    result.steps.afterSignupText = (await page.locator("body").innerText()).slice(0, 400);
    result.steps.gateAfterSignup = (await gate.count()) > 0;
    await shot("02-after-signup");

    result.steps.persistence = await page.evaluate(async () => {
      try {
        const mod = await import("/src/core/persistence/SupabasePersistence.ts");
        const p = mod.default.getInstance();
        const state = p.getAuthState();
        return {
          status: state.status,
          hasSession: Boolean(state.session),
          userId: state.session?.user?.id ?? null,
          configError: state.configError ?? null,
        };
      } catch (error) {
        return { error: String(error).slice(0, 200) };
      }
    });

    // Give hydration its bounded window, then look for what it said.
    await wait(9000);
    result.steps.hydrationLogs = logs.filter((line) => /hydrat|supabase|memory/i.test(line)).slice(-12);
    await shot("03-hydrated");
  }

  // Ask something and record what comes back.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))).catch(() => {});
  await wait(2000);
  if ((await page.locator(".lcu-card").count()) === 0) {
    await page.locator('button[aria-label="New chat"]').first().click({ timeout: 6000 }).catch(() => {});
    await wait(2500);
  }
  await page.locator(".lcu-card").first().click({ timeout: 6000 }).catch(() => {});
  await wait(2500);
  const composer = page.locator('[data-lelu-module-window^="chat:"] textarea').first();
  await composer.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type("Lelu, do you remember me? Answer in one sentence.", { delay: 12 });
  await page.keyboard.press("Enter");
  await wait(20000);
  result.steps.afterAsk = (await page.locator('[data-lelu-module-window^="chat:"]').first().innerText()).slice(0, 900);
  await shot("04-answer");
} catch (error) {
  result.error = String(error).slice(0, 400);
} finally {
  result.logs = logs.slice(-40);
  writeFileSync(join(HERE, "signin-memory-check.json"), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
