/*
 * MISSION 5.6 — live autonomy cycle probe.
 *
 * Drives the REAL application in one browser session: guest entry, real
 * composer, real cognition (AIRouter -> ProviderResolver -> provider -> tool
 * loop -> dispatcher -> EnvironmentOrchestrationEngine -> WorkspaceEngine ->
 * Genesis/Cosmos). It never injects a model response and never calls a tool
 * executor itself.
 *
 * Evidence is written after EVERY turn, so a renderer death mid-cycle leaves
 * the turns that already happened on disk instead of losing the run.
 *
 * usage:
 *   PORT=3013 node probe-cycle56.mjs
 *   TURNS=2 node probe-cycle56.mjs          # run only the first N instructions
 *   RELOAD=1 PORT=3013 node probe-cycle56.mjs  # persistence half only
 *   VIEWPORT=390x844 TAG=mobile node probe-cycle56.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? process.argv[2] ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const OUTDIR = process.env.OUTDIR ?? 'docs/acceptance/mission-5-6';
const TAG = process.env.TAG ?? 'default';
const [VW, VH] = (process.env.VIEWPORT ?? '1440x900').split('x').map(Number);
const WAIT_MS = Number(process.env.WAIT_MS ?? 170_000);
const RELOAD_ONLY = process.env.RELOAD === '1';
const MAX_TURNS = Number(process.env.TURNS ?? 99);

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const INSTRUCTIONS = [
  'Create an interactive research environment about emerging artificial intelligence. Organize the information into a visual overview, research sections, an interactive comparison, and a dedicated workspace for further investigation. Choose the presentation structure yourself.',
  'Organize the research, build comparisons, and create a visual presentation.',
  'Inspect the environment you just created. Identify anything incomplete, poorly arranged, disconnected, or difficult to navigate. Correct the problems you find.',
  'Expand the research environment with a new section on autonomous agents. Compare three architectures, connect the new section to the existing research, and update the overview without destroying the original structure.',
  'Present the most important findings in a more visual way.',
  'Preserve this environment so we can continue working on it in another session.',
];

fs.mkdirSync(path.join(OUTDIR, 'shots'), { recursive: true });

const rec = {
  mission: '5.6-live-autonomy-completion',
  tag: TAG,
  base: BASE,
  viewport: { width: VW, height: VH },
  at: new Date().toISOString(),
  instructions: INSTRUCTIONS,
  turns: [],
  console: [],
  modelRequests: [],
  pageErrors: [],
  crashes: [],
  metrics: [],
  persistence: null,
  result: 'RUNNING',
};
const file = path.join(OUTDIR, `cycle-${TAG}.json`);
const save = () => fs.writeFileSync(file, JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

let page;
try {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    reducedMotion: 'reduce',
    hasTouch: VW < 500,
    isMobile: VW < 500,
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => {
    rec.pageErrors.push(String(e.message || e).slice(0, 300));
    save();
  });
  page.on('crash', () => {
    rec.crashes.push({ at: Date.now(), afterTurn: rec.turns.length });
    save();
  });
  page.on('console', (msg) => {
    const t = msg.text();
    if (rec.console.length < 1200 && /provider|tool|environment|workspace|surface|error|fail|compose|snapshot/i.test(t)) {
      rec.console.push(`${msg.type()}: ${t}`.slice(0, 400));
    }
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes('/api/model/') && rec.modelRequests.length < 200) {
      rec.modelRequests.push({ url: u.replace(BASE, '/').slice(0, 140), status: r.status(), at: Date.now() });
    }
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});
  const metrics = async (label) => {
    try {
      const { metrics: m } = await cdp.send('Performance.getMetrics');
      const pick = (n) => m.find((x) => x.name === n)?.value ?? null;
      rec.metrics.push({
        label,
        at: Date.now(),
        heapMB: pick('JSHeapUsedSize') ? +(pick('JSHeapUsedSize') / 1048576).toFixed(1) : null,
        nodes: pick('Nodes'),
        listeners: pick('JSEventListeners'),
        documents: pick('Documents'),
        layouts: pick('LayoutCount'),
        recalc: pick('RecalcStyleCount'),
      });
      save();
    } catch {
      /* metrics are evidence, never a reason to fail the run */
    }
  };

  const enter = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3500);
    const cosmos = page.locator('button.lch-cosmos').first();
    if (await cosmos.count()) {
      await cosmos.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    const guest = page.locator('button:has-text("Continue without an account")').first();
    if (await guest.count()) {
      await guest.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3500);
    }
    const COMPOSER = 'textarea[placeholder*="Message"]:visible, textarea:visible';
    if (!(await page.locator(COMPOSER).count())) {
      const pill = page.locator('button:has-text("Chat")').first();
      if (await pill.count()) {
        await pill.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }
    return page.locator(COMPOSER).first();
  };

  const snap = () =>
    page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
      const contents = [...document.querySelectorAll('[data-lelu-module-content]')].map((e) =>
        e.getAttribute('data-lelu-module-content'),
      );
      let storage = [];
      try {
        storage = Object.keys(localStorage).map((k) => ({
          k,
          bytes: (localStorage.getItem(k) || '').length,
        }));
      } catch {
        storage = [];
      }
      return {
        windows: q('[data-lelu-module-window]'),
        contents,
        canvases: q('canvas'),
        elements: document.querySelectorAll('*').length,
        textLen: document.body.innerText.length,
        tail: lines.slice(-18),
        toolMentions: (document.body.innerText.match(/environment\.[a-z_]+/g) || []).slice(-8),
        snapshotMentions: (document.body.innerText.match(/snapshot-[a-z0-9]+/g) || []).slice(-4),
        storage: storage.filter((s) => /environment|workspace|lelu|kv/i.test(s.k)).slice(0, 20),
        storageTotal: storage.length,
      };
    });

  let box = await enter();
  rec.steps = [{ step: 'enter', at: Date.now(), composer: await box.count(), viewport: `${VW}x${VH}` }];
  await metrics('entered');
  save();

  if (RELOAD_ONLY) {
    // The environment must survive a full application reload, and must still
    // be editable afterwards.
    rec.persistence = { before: await snap() };
    await metrics('before-reload');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    const cosmos = page.locator('button.lch-cosmos').first();
    if (await cosmos.count()) {
      await cosmos.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    const guest = page.locator('button:has-text("Continue without an account")').first();
    if (await guest.count()) {
      await guest.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3500);
    }
    rec.persistence.after = await snap();
    await metrics('after-reload');
    await page.screenshot({ path: path.join(OUTDIR, 'shots', `${TAG}-after-reload.png`) }).catch(() => {});
    rec.result = 'RELOAD_RECORDED';
    save();
  } else {
    for (let i = 0; i < Math.min(INSTRUCTIONS.length, MAX_TURNS); i += 1) {
      const prompt = INSTRUCTIONS[i];
      const turn = { n: i + 1, prompt, at: Date.now(), consoleMark: rec.console.length };
      try {
        box = page.locator('textarea[placeholder*="Message"]:visible, textarea:visible').first();
        if (!(await box.count())) throw new Error('composer missing');
        await box.evaluate((el) => el.focus());
        await box.fill(prompt).catch(async () => {
          await page.keyboard.insertText(prompt);
        });
        await page.waitForTimeout(400);
        turn.before = await snap();
        await box.evaluate((el) => el.focus());
        await page.keyboard.press('Enter');
        turn.sent = Date.now();

        const deadline = Date.now() + WAIT_MS;
        let observed = turn.before;
        let changed = false;
        let stable = 0;
        while (Date.now() < deadline) {
          await page.waitForTimeout(3000);
          const now = await snap();
          const grew =
            now.textLen !== observed.textLen ||
            now.windows !== observed.windows ||
            now.contents.length !== observed.contents.length;
          if (grew) changed = true;
          observed = now;
          stable = grew ? 0 : stable + 1;
          const offline = /no ai providers|offline mode|unreachable or unconfigured/i.test(now.tail.join(' '));
          if (offline) break;
          if (changed && stable >= 4) break;
        }
        turn.observed = observed;
        turn.waitedMs = Date.now() - turn.sent;
        turn.console = rec.console.slice(turn.consoleMark);
        turn.tools = turn.console.filter((l) => /Tool [a-z_]+ ->|toolCalls|toolsExecuted|Composed environment|Presented |Saved environment|Restored environment|Surface \[/i.test(l)).slice(-20);
        turn.provider = turn.console.filter((l) => /Trying |generated response|refused|cannot handle|cooldown/i.test(l)).slice(-10);
        await page.screenshot({ path: path.join(OUTDIR, 'shots', `${TAG}-turn${i + 1}.png`) }).catch(() => {});
        await metrics(`turn-${i + 1}`);
        turn.result = 'RECORDED';
      } catch (e) {
        turn.error = String(e.message || e).slice(0, 400);
        turn.result = 'ERROR';
        try {
          await page.screenshot({ path: path.join(OUTDIR, 'shots', `${TAG}-turn${i + 1}-error.png`) }).catch(() => {});
        } catch {
          /* page may be gone */
        }
      }
      rec.turns.push(turn);
      save();
      console.log(`turn ${i + 1}: ${turn.result} waited=${turn.waitedMs ?? 0}ms windows=${turn.observed?.windows ?? '?'}`);
      if (turn.error && /closed|crash|Target page/i.test(turn.error)) break;
    }
    rec.result = 'RECORDED';
    save();
  }
} catch (e) {
  rec.error = String(e.message || e).slice(0, 500);
  rec.result = rec.result === 'RUNNING' ? 'ERROR' : rec.result;
  save();
  console.log(JSON.stringify({ result: rec.result, error: rec.error }, null, 1));
} finally {
  await browser.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  save();
  const summary = {
    result: rec.result,
    turns: rec.turns.map((t) => ({ n: t.n, r: t.result, waited: t.waitedMs, windows: t.observed?.windows, contents: t.observed?.contents?.length, tools: t.tools })),
    crashes: rec.crashes,
    pageErrors: rec.pageErrors.slice(-5),
    metricsTail: rec.metrics.slice(-3),
    persistence: rec.persistence
      ? {
          before: { windows: rec.persistence.before?.windows, contents: rec.persistence.before?.contents, storage: rec.persistence.before?.storage },
          after: { windows: rec.persistence.after?.windows, contents: rec.persistence.after?.contents, storage: rec.persistence.after?.storage },
        }
      : null,
  };
  console.log(JSON.stringify(summary, null, 1).slice(0, 5000));
}
