/**
 * What does the sign-in gate actually do on a phone-sized fresh session?
 *
 * Measures where the gate paints, whether something else is on top of it, and
 * what happens after "Create account": session, auth status, hydration logs.
 *
 * Usage: node artifacts/mission-chat-universe-1/gate-probe.mjs [base]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const EMAIL = `lelu.gate.${Date.now()}@example.com`;
const PASSWORD = `Gate-aA1-${Date.now()}`;

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
  if (/lélu|lelu|supabase|hydrat|auth|gate/i.test(text)) logs.push(`${m.type()}: ${text.slice(0, 220)}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.slice(0, 220)}`));

const out = { email: EMAIL, base: BASE };

const measure = () =>
  page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    if (!gate) return { gate: false, bodyText: document.body.innerText.slice(0, 160) };
    const b = gate.getBoundingClientRect();
    const cs = getComputedStyle(gate);
    const card = gate.firstElementChild;
    const cb = card?.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
    return {
      gate: true,
      gateBox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      gateZ: cs.zIndex,
      gatePointerEvents: cs.pointerEvents,
      cardBox: cb ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height) } : null,
      cardBackground: card ? getComputedStyle(card).backgroundColor : null,
      topElementAtGateCentre: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || "").slice(0, 40)}` : null,
      topElementInsideGate: hit ? gate.contains(hit) : null,
      gateText: (gate.innerText || "").slice(0, 260),
    };
  });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* blocked */
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  out.gate = await measure();
  await page.screenshot({ path: join(SHOTS, "gate-01-open.png") });

  const gate = page.locator("[data-lelu-signin-gate]");
  if (await gate.count()) {
    await gate.locator('input[type="email"]').fill(EMAIL, { timeout: 8000 });
    await gate.locator('input[type="password"]').fill(PASSWORD, { timeout: 8000 });
    const btn = gate.getByRole("button", { name: /create account/i });
    out.buttonBox = await btn.boundingBox();
    out.buttonHit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName.toLowerCase()}.${String(el.className || "").slice(0, 40)}` : null;
    }, { x: Math.round(out.buttonBox.x + out.buttonBox.width / 2), y: Math.round(out.buttonBox.y + out.buttonBox.height / 2) });
    await btn.click({ timeout: 8000 }).catch((e) => (out.clickError = String(e).slice(0, 160)));
    await page.waitForTimeout(8000);

    out.afterSignup = await measure();
    out.authAfterSignup = await page.evaluate(async () => {
      const mod = await import("/src/core/persistence/SupabasePersistence.ts");
      const p = mod.default.getInstance();
      const s = p.getAuthState();
      return { status: s.status, hasSession: Boolean(s.session), userId: s.session?.user?.id ?? null, email: s.session?.user?.email ?? null };
    });
    await page.screenshot({ path: join(SHOTS, "gate-02-after-signup.png") });

    await page.waitForTimeout(9000);
    out.authAfterWait = await page.evaluate(async () => {
      const mod = await import("/src/core/persistence/SupabasePersistence.ts");
      const p = mod.default.getInstance();
      const s = p.getAuthState();
      return { status: s.status, hasSession: Boolean(s.session), userId: s.session?.user?.id ?? null };
    });
    await page.screenshot({ path: join(SHOTS, "gate-03-hydrated.png") });
  }
} catch (error) {
  out.error = String(error).slice(0, 400);
} finally {
  out.logs = logs.slice(-30);
  writeFileSync(join(HERE, "gate-probe.json"), `${JSON.stringify(out, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
