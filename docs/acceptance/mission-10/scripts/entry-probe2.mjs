import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:3013";
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ["--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

const dump = async (label) => {
  const r = await page.evaluate(() => ({
    textareas: [...document.querySelectorAll("textarea")].map((el) => ({ ph: el.getAttribute("placeholder"), vis: !!(el.offsetWidth || el.offsetHeight) })),
    editables: [...document.querySelectorAll('[contenteditable="true"]')].length,
  }));
  console.log(label, JSON.stringify(r));
  return r.textareas.length + r.editables;
};

// 1. dismiss the sign-in card like a person
for (const l of ["Continue without an account", "Continue as guest"]) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.count().catch(() => 0)) { await b.click({ force: true }).catch(() => {}); await page.waitForTimeout(1500); break; }
}
await dump("after-guest");

// 2. the dock's conversation control
for (const sel of ['button[aria-label*="onversation" i]', 'button:has-text("✉")', 'button:has-text("LÉLU\'s room")']) {
  const b = page.locator(sel).first();
  if (await b.count().catch(() => 0)) {
    await b.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    const n = await dump(`after ${sel}`);
    if (n > 0) { console.log("OPENED_WITH", sel); break; }
  }
}
await page.screenshot({ path: "docs/acceptance/mission-10/shots/entry-probe2.png" });
await browser.close();
