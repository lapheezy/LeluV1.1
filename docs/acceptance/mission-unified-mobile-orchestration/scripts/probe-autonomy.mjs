/*
 * MISSION 2 — live autonomy probe.
 *
 * Drives the REAL application: real guest session, real composer, real
 * cognition loop (AIRouter -> ProviderResolver -> tools -> dispatcher ->
 * EnvironmentOrchestrationEngine -> WorkspaceEngine -> Genesis/Cosmos).
 *
 * It never injects a model response and never calls a tool executor
 * directly. Whatever the app does with a real request is what gets
 * recorded, including "no provider is configured".
 *
 * usage: node probe-autonomy.mjs [port]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.argv[2] ?? process.env.PORT ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const DIR = process.env.OUTDIR ?? 'docs/acceptance/mission-unified-mobile-orchestration';
const TURN = process.env.TURN ?? 'research';
fs.mkdirSync(DIR, { recursive: true });

const PROMPTS = {
  research:
    'Build me a workspace about the Voyager 1 mission and present a summary table of its instruments.',
  evolve:
    'Now revise that same table in place: add a row for the magnetometer boom and keep everything else.',
  multi:
    'Create two surfaces side by side: a short research note on Saturn’s rings and a diagram of their structure.',
  creative:
    'Present a small color palette artifact for a copper hoodie in the environment.',
  save: 'Save this environment as a checkpoint called voyager-run.',
};

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const rec = {
  mission: 'unified-mobile-orchestration',
  turn: TURN,
  base: BASE,
  at: new Date().toISOString(),
  prompt: PROMPTS[TURN] ?? TURN,
  steps: [],
  console: [],
  pageErrors: [],
};
const save = () => fs.writeFileSync(`${DIR}/autonomy-${TURN}.json`, JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    '--no-sandbox',
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
  ],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (msg) => {
    const t = msg.text();
    if (rec.console.length < 400 && /provider|tool|environment|error|fail/i.test(t)) {
      rec.console.push(`${msg.type()}: ${t}`.slice(0, 300));
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);

  // Real entry: open the scene, then continue as a guest (no account).
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

  // The composer only exists once a chat surface is open. Try the real entry
  // points in order and record which one actually produced a composer, so the
  // evidence shows the path instead of assuming it.
  const countComposers = async () =>
    page.evaluate(() => ({
      marker: document.querySelectorAll('[data-lelu-composer]').length,
      textareas: [...document.querySelectorAll('textarea')].map((e) => ({
        ph: e.getAttribute('placeholder'),
        visible: Boolean(e.getBoundingClientRect().width),
      })),
    }));
  const strategies = [
    ['chat-pill', 'button:has-text("Chat")'],
    ['conversation-portal', 'button:has-text("Conversation")'],
    ['ask-header', 'button:has-text("Ask her anything")'],
    ['universe-thread', '[data-lelu-universe-thread]'],
    ['universe-window', '[data-lelu-universe-window]'],
  ];
  rec.entrances = [];
  for (const [label, selector] of strategies) {
    const state = await countComposers();
    if (state.marker > 0 || state.textareas.some((t) => t.visible)) {
      rec.entrances.push({ label, state, used: true });
      break;
    }
    const el = page.locator(selector).first();
    const n = await el.count();
    if (!n) {
      rec.entrances.push({ label, count: 0 });
      continue;
    }
    await el.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3500);
    rec.entrances.push({ label, count: n, after: await countComposers() });
  }
  rec.steps.push({ step: 'open-chat', composers: await page.locator('[data-lelu-composer]').count() });

  // Instrument the real tool/cognition surfaces that the app itself exposes.
  await page.evaluate(() => {
    const g = window;
    g.__probe = { toolCalls: [], providerNotices: [] };
    const origFetch = g.fetch?.bind(g);
    if (origFetch) {
      g.fetch = (...args) => {
        const url = String(args[0]?.url ?? args[0] ?? '');
        if (/chat|complete|lelu|api/i.test(url)) g.__probe.fetches = (g.__probe.fetches ?? []).concat(url.slice(0, 160));
        return origFetch(...args);
      };
    }
  });

  // The chat textarea is identified by its placeholder; the data-lelu-composer
  // marker sits on a wrapper that is not always mounted, so it is not a
  // reliable handle on its own.
  const COMPOSER =
    'textarea[placeholder*="Message"]:visible, [data-lelu-composer] textarea:visible, [data-lelu-composer]:visible';
  const composer = page.locator(COMPOSER).first();
  const composerCount = await composer.count();
  rec.steps.push({ step: 'composer', count: composerCount });
  if (!composerCount) {
    rec.result = 'NO_COMPOSER';
    save();
    throw new Error('composer not found');
  }

  await composer.click();
  await composer.fill(rec.prompt);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => ({
    windows: document.querySelectorAll('[data-lelu-module-window]').length,
    texts: document.querySelectorAll('[data-lelu-module-content]').length,
    body: document.body.innerText.length,
  }));
  rec.before = before;

  await composer.press('Enter');
  rec.steps.push({ step: 'sent', at: Date.now() });

  // Wait for the real turn to produce something: a reply, a tool, or a surface.
  const deadline = Date.now() + 75_000;
  let observed = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    observed = await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const globals = Object.keys(window).filter((k) => /^__lelu|^__probe/i.test(k));
      const calls = window.__leluSelectCalls ?? window.__probe?.toolCalls ?? null;
      return {
        windows: q('[data-lelu-module-window]'),
        contents: [...document.querySelectorAll('[data-lelu-module-content]')].map((e) => e.getAttribute('data-lelu-module-content')),
        universe: q('[aria-label="Chat Universe"]'),
        busy: q('[data-lelu-busy], [aria-busy="true"]'),
        textLen: document.body.innerText.length,
        globals,
        selectCalls: Array.isArray(calls) ? calls.slice(-8) : calls,
        fetches: (window.__probe?.fetches ?? []).slice(-6),
      };
    });
    if (
      observed.windows > before.windows ||
      observed.contents.length > before.texts ||
      observed.textLen > before.body + 80
    ) {
      break;
    }
  }
  rec.observed = observed;
  rec.waitedMs = Date.now() - (rec.steps.at(-1)?.at ?? Date.now());

  // What did the app actually say? Last visible assistant text + any provider notice.
  rec.reply = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return {
      tail: lines.slice(-22),
      mentionsNoProvider: /no ai providers|no provider|offline|provider .*(unavailable|missing)/i.test(text),
      mentionsTool: /environment\.(compose|present_artifact|mutate_surface|manage_workspace|save_state|restore_state)/.test(text),
    };
  });
  rec.result = 'RECORDED';
  save();
  console.log(JSON.stringify({ turn: TURN, result: rec.result, before, observed, reply: rec.reply }, null, 1).slice(0, 3000));
} catch (e) {
  rec.error = String(e.message || e).slice(0, 400);
  rec.result = rec.result ?? 'ERROR';
  save();
  console.log(JSON.stringify({ turn: TURN, result: rec.result, error: rec.error, steps: rec.steps }, null, 1).slice(0, 2000));
} finally {
  await browser.close().catch(() => {});
}
