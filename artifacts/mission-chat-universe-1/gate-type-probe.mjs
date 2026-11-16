/**
 * The real user path: TAP the email field, TYPE, tap password, TYPE, press
 * "Create account" with a real click. Then report whether Supabase wrote a
 * session, whether the gate closed, and whether memory hydration ran.
 *
 * Usage: node artifacts/mission-chat-universe-1/gate-type-probe.mjs [base]
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const EMAIL = `lelu.typed.${Date.now()}@example.com`;
const PASSWORD = `Typed-aA1-${Date.now()}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (/supabase|auth|hydrat|lélu|lelu/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 200)}`);
});

const snapshot = () =>
  page.evaluate(() => {
    const gates = [...document.querySelectorAll("[data-lelu-signin-gate]")];
    let token = null;
    try {
      const key = Object.keys(localStorage).find((k) => /auth-token$/.test(k));
      if (key) {
        const raw = JSON.parse(localStorage.getItem(key));
        token = { key, hasAccess: Boolean(raw?.access_token), userId: raw?.user?.id ?? null };
      }
    } catch (e) {
      token = { error: String(e).slice(0, 100) };
    }
    return {
      gateCount: gates.length,
      gateText: gates[0] ? (gates[0].textContent || "").replace(/\s+/g, " ").slice(0, 260) : null,
      token,
      inputValues: gates[0] ? [...gates[0].querySelectorAll("input")].map((i) => i.value.slice(0, 40)) : [],
    };
  });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

const out = { email: EMAIL, before: await snapshot() };

const gate = page.locator("[data-lelu-signin-gate]").first();
await gate.locator('input[type="email"]').click();
await page.keyboard.type(EMAIL, { delay: 8 });
await gate.locator('input[type="password"]').click();
await page.keyboard.type(PASSWORD, { delay: 8 });
out.filled = await snapshot();

await gate.getByRole("button", { name: /create account/i }).click();
await page.waitForTimeout(4000);
out.after4s = await snapshot();
await page.waitForTimeout(8000);
out.after12s = await snapshot();
await page.screenshot({ path: join(SHOTS, "gate-typed-after.png") });

// Give hydration a window and look for its logs / memory stores.
await page.waitForTimeout(6000);
out.logs = logs.slice(-24);
writeFileSync(join(HERE, "gate-type-probe.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
