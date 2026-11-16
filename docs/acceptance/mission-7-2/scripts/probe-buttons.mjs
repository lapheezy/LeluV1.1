/*
 * Diagnostic for Mission 7.2: what controls does the running app actually show?
 * Prints the visible buttons and every line mentioning an approval, so a
 * selector is chosen from the real DOM rather than guessed.
 *
 * usage: STATE=/tmp/m72-state.json node docs/acceptance/mission-7-2/scripts/probe-buttons.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT ?? '3013';
const BASE = `http://127.0.0.1:${PORT}/`;
const STATE = process.env.STATE ?? '/tmp/m72-state.json';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(process.env.STATE ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);
for (const label of ['Continue without an account', 'Continue as guest', 'Guest']) {
  const guest = page.locator(`button:has-text("${label}")`).first();
  if (await guest.count().catch(() => 0)) { await guest.click({ force: true }).catch(() => {}); await page.waitForTimeout(2500); break; }
}

const info = await page.evaluate(() => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const buttons = [...document.querySelectorAll('button')]
    .filter(visible)
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = document.body.innerText;
  return {
    buttons: [...new Set(buttons)].slice(0, 80),
    expanders: [...document.querySelectorAll('button[aria-expanded]')].map((el) => ({
      expanded: el.getAttribute('aria-expanded'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      visible: visible(el),
    })).slice(0, 10),
    approvalLines: text.split('\n').map((line) => line.trim()).filter((line) => /approv|waiting|pending/i.test(line)).slice(0, 12),
    hasCheckApprove: text.includes('✓ Approve'),
    bodyLength: text.length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
