/**
 * "Signed up, then what?" — the app with a REAL Supabase session.
 *
 * The headless browser cannot type into the sign-in card reliably (the card's
 * inputs are controlled and a programmatic value is reset on the next render),
 * so this creates the account through Supabase's own sign-up endpoint, stores
 * the returned session exactly where supabase-js keeps it, reloads, and then
 * measures what the user cares about: is she signed in, does memory hydrate,
 * does she answer.
 *
 * Usage: node artifacts/mission-chat-universe-1/session-inject-check.mjs [base]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const PROJECT_URL = "https://nrehsldbfxthspikaxvr.supabase.co";
const KEY = readFileSync(join(HERE, "..", "..", "src/core/config/supabasePublic.ts"), "utf8").match(/publishableKey: "([^"]+)"/)[1];
const EMAIL = `lelu.session.${Date.now()}@example.com`;
const PASSWORD = `Session-aA1-${Date.now()}`;

const out = { email: EMAIL };

const signup = await fetch(`${PROJECT_URL}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const session = await signup.json();
out.signup = { status: signup.status, hasAccessToken: Boolean(session.access_token), userId: session.user?.id ?? null };
if (!session.access_token) {
  writeFileSync(join(HERE, "session-inject.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const storageKey = `sb-nrehsldbfxthspikaxvr-auth-token`;

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
  const t = m.text();
  if (/supabase|hydrat|memory|lélu|lelu/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 220)}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.slice(0, 220)}`));
const shot = (n) => page.screenshot({ path: join(SHOTS, `session-${n}.png`) });
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: JSON.stringify(session) },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(9000);

  out.afterReload = await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    const key = Object.keys(localStorage).find((k) => /auth-token$/.test(k));
    let token = null;
    try {
      const raw = key ? JSON.parse(localStorage.getItem(key)) : null;
      token = raw ? { hasAccess: Boolean(raw.access_token), userId: raw.user?.id ?? null, email: raw.user?.email ?? null } : null;
    } catch {
      token = { error: "unparseable" };
    }
    return { gatePresent: Boolean(gate), token };
  });
  await shot("01-signed-in");

  // Give hydration its bounded window.
  await wait(9000);
  out.hydrationLogs = logs.filter((l) => /hydrat|supabase|memory/i.test(l)).slice(-14);
  await shot("02-hydrated");

  // Ask her something only a signed-in, memory-backed LÉLU would answer.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))).catch(() => {});
  await wait(2500);
  if ((await page.locator(".lcu-card").count()) === 0) {
    await page.locator('button[aria-label="New chat"]').first().click({ timeout: 6000 }).catch(() => {});
    await wait(2500);
  }
  await page.locator(".lcu-card").first().click({ timeout: 6000 }).catch(() => {});
  await wait(2500);
  const composer = page.locator('[data-lelu-module-window^="chat:"] textarea').first();
  await composer.click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type("Lelu, do you remember me from my account? Answer in two sentences.", { delay: 12 });
  await page.keyboard.press("Enter");
  await wait(22000);

  out.reply = await page.evaluate(() => {
    const sheet = document.querySelector('[data-lelu-module-window^="chat:"]');
    return (sheet?.innerText || "").slice(0, 1200);
  });
  await shot("03-answer");
} catch (error) {
  out.error = String(error).slice(0, 400);
} finally {
  out.logs = logs.slice(-30);
  writeFileSync(join(HERE, "session-inject-check.json"), `${JSON.stringify(out, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
