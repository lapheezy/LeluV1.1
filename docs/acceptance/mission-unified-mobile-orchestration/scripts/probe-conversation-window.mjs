/*
 * MISSION 2 — conversation continuity (workflow B).
 *
 * Opens Conversation through the real spatial portal, then asks the actual
 * interface whether a conversation WINDOW can be opened: how many Universe
 * windows/threads exist, and whether selecting a thread produces a window.
 * Nothing is asserted beyond what the DOM says.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.argv[2] ?? process.env.PORT ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const DIR = process.env.OUTDIR ?? 'docs/acceptance/mission-unified-mobile-orchestration';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
fs.mkdirSync(DIR, { recursive: true });

const rec = { mission: 'unified-mobile-orchestration', workflow: 'B', at: new Date().toISOString(), steps: [] };
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.locator('button.lch-cosmos').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const guest = page.locator('button:has-text("Continue without an account")').first();
  if (await guest.count()) {
    await guest.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  const snap = () =>
    page.evaluate(() => ({
      universeDialogs: document.querySelectorAll('[aria-label="Chat Universe"]').length,
      universeWindows: document.querySelectorAll('[data-lelu-universe-window]').length,
      universeThreads: document.querySelectorAll('[data-lelu-universe-thread]').length,
      composers: document.querySelectorAll('textarea[placeholder*="Message"]').length,
      tablists: document.querySelectorAll('[role="tablist"]').length,
      universes: document.querySelectorAll('.lcu, [data-lelu-universe]').length,
      legacyMultiChatTabs: document.body.innerHTML.includes('MultiChatTabs'),
    }));

  rec.steps.push({ step: 'before-portal', dom: await snap() });

  // Real spatial portal, real pointer press.
  const portal = page.locator('button:has-text("Conversation")').first();
  if (await portal.count()) {
    await portal.click({ force: true }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  rec.steps.push({ step: 'after-portal', dom: await snap() });

  // Can the interface open a conversation window from here?
  const thread = page.locator('[data-lelu-universe-thread]').first();
  const threadCount = await thread.count();
  rec.threadsClickable = threadCount;
  if (threadCount) {
    await thread.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    rec.steps.push({ step: 'after-thread-click', dom: await snap() });
  }
  const newChat = page.locator('button:has-text("New Chat"), button:has-text("New chat")').first();
  rec.newChatButton = await newChat.count();
  if (rec.newChatButton) {
    await newChat.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
    rec.steps.push({ step: 'after-new-chat', dom: await snap() });
  }

  const last = rec.steps.at(-1)?.dom ?? {};
  rec.conversationWindowOpened = (last.universeWindows ?? 0) > 0;
  rec.result = rec.conversationWindowOpened ? 'WINDOW_OPENED' : 'UNIVERSE_ONLY';
  fs.writeFileSync(`${DIR}/conversation-window.json`, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify(rec, null, 1).slice(0, 2500));
} catch (e) {
  rec.error = String(e.message || e).slice(0, 300);
  rec.result = 'ERROR';
  fs.writeFileSync(`${DIR}/conversation-window.json`, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify({ result: rec.result, error: rec.error, steps: rec.steps }, null, 1).slice(0, 1500));
} finally {
  await browser.close().catch(() => {});
}
