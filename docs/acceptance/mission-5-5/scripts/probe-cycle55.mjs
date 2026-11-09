/*
 * MISSION 5.5 — end-to-end autonomy cycle.
 *
 * One real session, several real instructions. Nothing is injected: each
 * instruction is typed into the app's own composer and the app's own
 * cognition decides what to do. The probe only OBSERVES.
 *
 * It exits as soon as the session becomes unstable rather than waiting for
 * a crash, so the evidence is what the app did, not what a dead page
 * looked like.
 *
 * usage: node probe-cycle55.mjs [port]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.argv[2] ?? process.env.PORT ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const DIR = process.env.OUTDIR ?? 'docs/acceptance/mission-5-5';
const TURN_BUDGET_MS = Number(process.env.TURN_BUDGET_MS ?? 68_000);
fs.mkdirSync(DIR, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux64/headless_shell`;

const TURNS = [
  { id: 'create', prompt: 'Create a visual environment for investigating the future of sustainable cities.' },
  { id: 'organize', prompt: 'Organize the research, build comparisons, and create a visual presentation.' },
  { id: 'inspect', prompt: 'Inspect what you created and correct anything incomplete.' },
  { id: 'expand', prompt: 'Expand the environment with an interactive section about renewable energy.' },
  { id: 'emphasize', prompt: 'Reorganize the presentation to emphasize the most important discoveries.' },
];

const rec = {
  mission: '5.5-autonomy-activation',
  mode: 'cycle',
  base: BASE,
  at: new Date().toISOString(),
  turns: [],
  console: [],
  modelRequests: [],
  pageErrors: [],
  crash: null,
};
const save = () => fs.writeFileSync(`${DIR}/cycle.json`, JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message || e).slice(0, 240)));
  page.on('console', (msg) => {
    const t = msg.text();
    if (rec.console.length < 1400 && /provider|tool|environment|workspace|surface|error|compose|Skipping/i.test(t)) {
      rec.console.push(`${msg.type()}: ${t}`.slice(0, 360));
    }
  });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/model/') && rec.modelRequests.length < 80) {
      rec.modelRequests.push({ path: u.split('/api/model/')[1]?.slice(0, 40), status: r.status() });
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3200);
  const cosmos = page.locator('button.lch-cosmos').first();
  if (await cosmos.count()) {
    await cosmos.click().catch(() => {});
    await page.waitForTimeout(2200);
  }
  const guest = page.locator('button:has-text("Continue without an account")').first();
  if (await guest.count()) {
    await guest.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  const pill = page.locator('button:has-text("Chat")').first();
  if (await pill.count()) {
    await pill.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2800);
  }

  const seat = page.locator('textarea[placeholder*="Message"]:visible, textarea:visible').first();
  if (!(await seat.count())) {
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
        toolMentions: [...new Set(document.body.innerText.match(/environment\.[a-z_]+/g) || [])],
        tail: lines.slice(-14),
      };
    });

  const toolOkCount = () => rec.console.filter((l) => /Tool .* -> ok/.test(l)).length;

  for (const turn of TURNS) {
    const before = await snap().catch(() => null);
    const toolBefore = toolOkCount();
    const consoleBefore = rec.console.length;
    const started = Date.now();
    await seat.click().catch(() => {});
    await seat.fill(turn.prompt).catch(() => {});
    await page.waitForTimeout(350);
    await seat.press('Enter').catch(() => {});

    let after = before;
    let fired = false;
    while (Date.now() - started < TURN_BUDGET_MS) {
      await page.waitForTimeout(2500);
      after = await snap().catch(() => null);
      if (!after) break;
      const toolsRan = toolOkCount() > toolBefore;
      const domChanged =
        before && (after.windows !== before.windows || after.contents.length !== before.contents.length);
      if (toolsRan && domChanged) {
        fired = true;
        break;
      }
      // Settled text with no tool: stop early rather than burn the budget.
      if (Date.now() - started > 40_000 && !toolsRan) {
        const quiet = rec.console.length === consoleBefore;
        if (quiet) break;
      }
    }

    rec.turns.push({
      id: turn.id,
      prompt: turn.prompt,
      ms: Date.now() - started,
      toolsRan: toolOkCount() - toolBefore,
      fired,
      before,
      after,
      trace: rec.console
        .slice(consoleBefore)
        .filter((l) => /Trying |generated response|Tool .* ->|too large|Composed|surface/i.test(l))
        .slice(0, 14),
    });
    await page.screenshot({ path: `${DIR}/cycle-${turn.id}.png` }).catch(() => {});
    save();
    if (!after) break;
  }

  // Persistence: does the environment survive a reload?
  const beforeReload = await snap().catch(() => null);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000);
  const afterReload = await snap().catch(() => null);
  rec.persistence = { beforeReload, afterReload };
  await page.screenshot({ path: `${DIR}/cycle-after-reload.png` }).catch(() => {});

  rec.result = 'CYCLE_RECORDED';
  rec.trace = {
    tools: rec.console.filter((l) => /Tool .* ->/.test(l)).slice(-20),
    providers: rec.console.filter((l) => /generated response|Trying /.test(l)).slice(-10),
  };
  save();
  console.log(
    JSON.stringify(
      {
        result: rec.result,
        turns: rec.turns.map((t) => ({
          id: t.id,
          ms: t.ms,
          toolsRan: t.toolsRan,
          windows: [t.before?.windows, t.after?.windows],
          contents: [t.before?.contents?.length, t.after?.contents?.length],
          trace: t.trace,
        })),
        persistence: {
          windows: [beforeReload?.windows, afterReload?.windows],
          contents: [beforeReload?.contents?.length, afterReload?.contents?.length],
        },
        tools: rec.trace.tools,
      },
      null,
      1,
    ).slice(0, 7000),
  );
} catch (e) {
  rec.crash = String(e.message || e).slice(0, 300);
  rec.result = 'SESSION_ENDED';
  save();
  console.log(
    JSON.stringify(
      { result: rec.result, crash: rec.crash, turns: rec.turns.map((t) => ({ id: t.id, toolsRan: t.toolsRan, trace: t.trace })) },
      null,
      1,
    ).slice(0, 5000),
  );
} finally {
  await browser.close().catch(() => {});
}
