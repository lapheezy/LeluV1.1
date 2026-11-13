/**
 * End to end, as a person on a phone: create an account in the gate, then talk
 * to her in the Chat Universe. Captures the reply text (not just a screenshot),
 * memory-hydration logs, and a second turn asking for a chart and a PDF.
 *
 * Usage: node artifacts/mission-chat-universe-1/signedin-chat-demo.mjs [base]
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3001/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const EMAIL = `lelu.demo.${Date.now()}@example.com`;
const PASSWORD = `Demo-aA1-${Date.now()}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (/supabase|hydrat|memory|provider|groq|error/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 200)}`);
});
const shot = (n) => page.screenshot({ path: join(SHOTS, `demo-${n}.png`) });
const wait = (ms) => page.waitForTimeout(ms);
const out = { email: EMAIL };

const sheetText = () =>
  page.evaluate(() => {
    const s = document.querySelector('[data-lelu-module-window^="chat:"]');
    return (s?.innerText || "").slice(0, 2000);
  });

const ask = async (text) => {
  const composer = page.locator('[data-lelu-module-window^="chat:"] textarea').first();
  await composer.click({ timeout: 8000 });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Enter");
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(7000);

  // Sign up through the real gate.
  const gate = page.locator("[data-lelu-signin-gate]").first();
  out.gateShown = (await gate.count()) > 0;
  await shot("01-gate");
  await gate.locator('input[type="email"]').click();
  await page.keyboard.type(EMAIL, { delay: 6 });
  await gate.locator('input[type="password"]').click();
  await page.keyboard.type(PASSWORD, { delay: 6 });
  await gate.getByRole("button", { name: /create account/i }).click();
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 30000 }).catch(() => {});
  out.signedIn = (await page.locator("[data-lelu-signin-gate]").count()) === 0;
  await wait(12000);
  out.hydration = logs.filter((l) => /hydrat|supabase|memory/i.test(l)).slice(-10);
  await shot("02-signed-in");

  // Open the Universe and start a conversation.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))).catch(() => {});
  await wait(2500);
  if ((await page.locator(".lcu-card").count()) === 0) {
    await page.locator('button[aria-label="New chat"]').first().click({ timeout: 6000 }).catch(() => {});
    await wait(2500);
  }
  await page.locator(".lcu-card").first().click({ timeout: 6000 });
  await wait(2000);
  await shot("03-conversation");

  await ask("Lelu, do you remember this account? Tell me in two sentences.");
  await wait(20000);
  out.replyOne = await sheetText();
  await shot("04-reply");

  await ask("Draw me a small chart of weekly focus and give me a PDF summary.");
  await wait(30000);
  out.replyTwo = await sheetText();
  out.artifacts = await page.evaluate(() => {
    const sheet = document.querySelector('[data-lelu-module-window^="chat:"]');
    return {
      svg: sheet?.querySelectorAll("svg").length ?? 0,
      canvas: sheet?.querySelectorAll("canvas").length ?? 0,
      images: sheet?.querySelectorAll("img").length ?? 0,
      downloadLinks: [...(sheet?.querySelectorAll("a[download]") ?? [])].map((a) => a.getAttribute("href")?.slice(0, 60)).slice(0, 4),
      pdfLinks: [...(sheet?.querySelectorAll('a[href$=".pdf"], a[href*="pdf"]') ?? [])].map((a) => a.getAttribute("href")?.slice(0, 60)).slice(0, 4),
      tables: sheet?.querySelectorAll("table").length ?? 0,
      codeBlocks: sheet?.querySelectorAll("pre").length ?? 0,
    };
  });
  await shot("05-chart-pdf");
} catch (error) {
  out.error = String(error).slice(0, 400);
} finally {
  out.logs = logs.slice(-30);
  writeFileSync(join(HERE, "signedin-chat-demo.json"), `${JSON.stringify(out, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
