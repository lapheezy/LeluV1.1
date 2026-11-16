/*
 * MISSION 5.5 — live autonomy probe.
 *
 * Drives the REAL application: guest session, real composer, real cognition
 * (AIRouter -> ProviderResolver -> provider -> tool loop -> dispatcher ->
 * EnvironmentOrchestrationEngine -> WorkspaceEngine -> Genesis/Cosmos).
 *
 * It never injects a model response and never calls a tool executor itself.
 * What the app does with a real request is what gets recorded.
 *
 * usage: TURN=<name> PROMPT="..." node probe-autonomy55.mjs [port]
 *        ADD=1  -> continue in the same page/session as the previous turn
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.argv[2] ?? process.env.PORT ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const DIR = process.env.OUTDIR ?? 'docs/acceptance/mission-5-5';
const TURN = process.env.TURN ?? 'create';
const PROMPT = process.env.PROMPT ?? 'Create a visual environment for investigating the future of sustainable cities.';
const TIMEOUT_MS = Number(process.env.WAIT_MS ?? 170_000);
fs.mkdirSync(DIR, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const rec = {
  mission: '5.5-autonomy-activation',
  turn: TURN,
  prompt: PROMPT,
  base: BASE,
  at: new Date().toISOString(),
  steps: [],
  console: [],
  modelRequests: [],
  pageErrors: [],
};
const save = () => fs.writeFileSync(`${DIR}/turn-${TURN}.json`, JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (msg) => {
    const t = msg.text();
    if (rec.console.length < 900 && /provider|tool|environment|workspace|surface|error|fail|compose/i.test(t)) {
      rec.console.push(`${msg.type()}: ${t}`.slice(0, 400));
    }
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes('/api/model/') && rec.modelRequests.length < 60) {
      rec.modelRequests.push({ url: u.replace(BASE, '/').slice(0, 120), status: r.status(), at: Date.now() });
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  const cosmos = page.locator('button.lch-cosmos').first();
  if (await cosmos.count()) {
    await cosmos.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  const guest = page.locator('button:has-text("Continue without an account")').first();
  const guestCount = await guest.count();
  if (guestCount) {
    await guest.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3500);
  }
  rec.steps.push({ step: 'enter', cosmos: await cosmos.count(), guest: guestCount });

  const COMPOSER = 'textarea[placeholder*="Message"]:visible, textarea:visible';
  const composer = page.locator(COMPOSER).first();
  if (!(await composer.count())) {
    const pill = page.locator('button:has-text("Chat")').first();
    if (await pill.count()) {
      await pill.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3500);
    }
  }
  const box = page.locator(COMPOSER).first();
  if (!(await box.count())) {
    rec.result = 'NO_COMPOSER';
    save();
    throw new Error('composer not found');
  }

  const snap = () =>
    page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
      return {
        windows: q('[data-lelu-module-window]'),
        contents: [...document.querySelectorAll('[data-lelu-module-content]')].map((e) =>
          e.getAttribute('data-lelu-module-content'),
        ),
        canvases: q('canvas'),
        textLen: document.body.innerText.length,
        tail: lines.slice(-16),
        toolMentions: (document.body.innerText.match(/environment\.[a-z_]+/g) || []).slice(-8),
      };
    });

  rec.before = await snap();
  await box.click();
  await box.fill(PROMPT);
  await page.waitForTimeout(500);
  await box.press('Enter');
  rec.steps.push({ step: 'sent', at: Date.now() });

  // Poll until the app produces something new, or the wait expires.
  const deadline = Date.now() + TIMEOUT_MS;
  let observed = rec.before;
  let stable = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const now = await snap();
    const changed =
      now.windows !== observed.windows ||
      now.contents.length !== observed.contents.length ||
      now.textLen !== observed.textLen;
    observed = now;
    stable = changed ? 0 : stable + 1;
    const providerNotice = /no ai providers|offline mode|unreachable or unconfigured/i.test(now.tail.join(' '));
    if (providerNotice && stable >= 1) break;
    // Turn settled: text stopped growing for ~12s after having changed.
    if (stable >= 4 && now.textLen !== rec.before.textLen) break;
  }
  rec.observed = observed;
  rec.waitedMs = Date.now() - (rec.steps.at(-1)?.at ?? Date.now());

  rec.reply = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return {
      tail: lines.slice(-24),
      providerNotice: /no ai providers|offline mode|unreachable or unconfigured/i.test(text),
    };
  });

  // Tool/provider truth from the app's own logs, not from the visible text.
  rec.trace = {
    tried: rec.console.filter((l) => /Trying |generated response|cannot handle/i.test(l)).slice(-12),
    tools: rec.console.filter((l) => /Tool .* ->|toolCalls|toolsExecuted/i.test(l)).slice(-20),
    errors: rec.console.filter((l) => /error|fail|cooldown|Skipping/i.test(l)).slice(-14),
    env: rec.console.filter((l) => /EnvironmentOrchestrationEngine|WorkspaceEngine|Composed environment/i.test(l)).slice(-10),
  };

  await page.screenshot({ path: `${DIR}/turn-${TURN}.png`, fullPage: false }).catch(() => {});
  rec.result = 'RECORDED';
  save();
  console.log(JSON.stringify({ turn: TURN, result: rec.result, before: rec.before, observed: rec.observed, trace: rec.trace, reply: rec.reply }, null, 1).slice(0, 6000));
} catch (e) {
  rec.error = String(e.message || e).slice(0, 500);
  rec.result = rec.result ?? 'ERROR';
  save();
  console.log(JSON.stringify({ turn: TURN, result: rec.result, error: rec.error, trace: rec.trace, steps: rec.steps }, null, 1).slice(0, 3000));
} finally {
  await browser.close().catch(() => {});
}
