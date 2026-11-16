/**
 * Click "Create account" on the real gate and read what the gate itself says
 * after the click: its textContent, whether it stayed, and whether Supabase
 * wrote a session token to storage.
 *
 * Usage: node artifacts/mission-chat-universe-1/gate-click-probe.mjs [base]
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const EMAIL = `lelu.click.${Date.now()}@example.com`;
const PASSWORD = `Click-aA1-${Date.now()}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (/supabase|auth|hydrat|lélu|lelu/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 200)}`);
});

const snapshot = () =>
  page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    let token = null;
    try {
      const key = Object.keys(localStorage).find((k) => /auth-token$/.test(k));
      if (key) {
        const raw = JSON.parse(localStorage.getItem(key));
        token = { key, hasAccess: Boolean(raw?.access_token), userId: raw?.user?.id ?? null, email: raw?.user?.email ?? null };
      }
    } catch (e) {
      token = { error: String(e).slice(0, 120) };
    }
    return {
      gatePresent: Boolean(gate),
      gateText: gate ? (gate.textContent || "").replace(/\s+/g, " ").slice(0, 300) : null,
      storageKeys: Object.keys(localStorage).filter((k) => /lelu|supabase|sb-|auth/i.test(k)).slice(0, 10),
      token,
    };
  });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

const out = { email: EMAIL, before: await snapshot() };

const gate = page.locator("[data-lelu-signin-gate]");
await gate.locator('input[type="email"]').fill(EMAIL);
await gate.locator('input[type="password"]').fill(PASSWORD);
await gate.getByRole("button", { name: /create account/i }).click();
await page.waitForTimeout(9000);
out.after = await snapshot();
await page.screenshot({ path: join(SHOTS, "gate-click-after.png") });

out.logs = logs.slice(-20);
writeFileSync(join(HERE, "gate-click-probe.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
await browser.close();
