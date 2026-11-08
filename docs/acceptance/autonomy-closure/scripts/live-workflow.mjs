/*
 * MISSION AC — live autonomous workflow, through the real application.
 *
 * Guest entry -> real Chat Universe composer -> real cognition (AIRouter ->
 * ProviderResolver -> provider tool loop -> ToolDispatcher -> EnvironmentTools
 * -> EnvironmentOrchestrationEngine -> WorkspaceEngine -> Genesis/Cosmos).
 * Nothing is injected: no fake model response, no direct engine call.
 *
 * PHASE=1  create -> modify -> reorganize -> save
 * PHASE=2  (new browser process, server restarted between) restore -> continue
 * A persistent profile is used so storage survives the process boundary; the
 * evidence records whether it did rather than assuming it.
 *
 * usage: PHASE=1 node live-workflow.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? '3013';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/acceptance/autonomy-closure';
const TAG = process.env.TAG ?? 'desktop';
const PHASE = Number(process.env.PHASE ?? 1);
const WAIT_MS = Number(process.env.WAIT_MS ?? 150_000);
const PROFILE = process.env.PROFILE ?? '/tmp/lelu-profile-ac';
const [VW, VH] = (process.env.VIEWPORT ?? '1440x900').split('x').map(Number);
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const TURNS = {
  1: [
    { stage: 'create', prompt: 'Create a working space about the planets: a table of the eight planets, a diagram of their order from the sun, and a short document explaining it. Choose the layout yourself and build it now.' },
    { stage: 'modify', prompt: 'Now change the table surface you already made so it also shows each planet moon count. Modify that existing surface in place, do not create a replacement.' },
    { stage: 'reorganize', prompt: 'Reorganize the workspace you built into a grid layout and focus the diagram surface.' },
    { stage: 'save', prompt: 'Save this environment as a snapshot named planets-closure so we can continue it in another session.' },
  ],
  2: [
    { stage: 'restore', prompt: 'Restore the environment snapshot named planets-closure that we saved before the restart.' },
    { stage: 'continue', prompt: 'Continue the restored work: add a section about Saturns rings to the existing document surface, updating it in place rather than making a new one.' },
  ],
};

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const rec = {
  mission: 'autonomy-closure', tag: TAG, phase: PHASE, base: BASE,
  viewport: { width: VW, height: VH }, profile: PROFILE,
  at: new Date().toISOString(), turns: [], console: [], modelRequests: [],
  pageErrors: [], crashes: [], metrics: [], result: 'RUNNING',
};
const file = path.join(OUT, `live-${TAG}-phase${PHASE}.json`);
const save = () => fs.writeFileSync(file, JSON.stringify(rec, null, 2));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true, executablePath: CHROME, viewport: { width: VW, height: VH },
  reducedMotion: 'reduce', hasTouch: VW < 500, isMobile: VW < 500,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let page = ctx.pages()[0] ?? (await ctx.newPage());
rec.storageAtStart = await page.evaluate(() => Object.keys(localStorage).filter((k) => /environment|workspace|lelu/i.test(k))).catch(() => null);
save();
page.on('pageerror', (e) => { rec.pageErrors.push(String(e.message || e).slice(0, 300)); save(); });
page.on('crash', () => { rec.crashes.push({ at: Date.now(), afterTurn: rec.turns.length }); save(); });
page.on('console', (msg) => {
  const t = msg.text();
  if (rec.console.length < 1500 && /provider|tool|environment|workspace|surface|snapshot|error|fail|compose|restore/i.test(t)) {
    rec.console.push(`${msg.type()}: ${t}`.slice(0, 500));
  }
});
ctx.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/model/') && rec.modelRequests.length < 300) {
    rec.modelRequests.push({ url: u.replace(BASE, '/').slice(0, 150), status: r.status(), at: Date.now() });
    save();
  }
});

const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable').catch(() => {});
const metrics = async (label) => {
  try {
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    const pick = (n) => m.find((x) => x.name === n)?.value ?? null;
    rec.metrics.push({ label, heapMB: pick('JSHeapUsedSize') ? +(pick('JSHeapUsedSize') / 1048576).toFixed(1) : null,
      nodes: pick('Nodes'), listeners: pick('JSEventListeners'), documents: pick('Documents') });
    save();
  } catch { /* metrics are evidence, never a blocker */ }
};

const snap = () => page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const contents = [...document.querySelectorAll('[data-lelu-module-content]')].map((e) => e.getAttribute('data-lelu-module-content'));
  const titles = [...document.querySelectorAll('[data-lelu-module-window]')].map((e) => (e.textContent || '').trim().slice(0, 90));
  const text = document.body.innerText;
  return {
    windows: q('[data-lelu-module-window]'), contents, titles,
    canvases: q('canvas'), elements: document.querySelectorAll('*').length, textLen: text.length,
    tail: text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-16),
    toolMentions: (text.match(/environment\.[a-z_]+/g) || []).slice(-10),
    snapshotMentions: (text.match(/snapshot-[a-z0-9]+/g) || []).slice(-6),
    storage: (() => { try { return Object.keys(localStorage).filter((k) => /environment|workspace|lelu/i.test(k)).slice(0, 24); } catch { return []; } })(),
    envState: (() => { try { const raw = localStorage.getItem('environment.snapshots') || localStorage.getItem('lelu.environment.snapshots'); return raw ? raw.slice(0, 400) : null; } catch { return null; } })(),
  };
});

const enter = async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const cosmos = page.locator('button.lch-cosmos').first();
  if (await cosmos.count()) { await cosmos.click().catch(() => {}); await page.waitForTimeout(2500); }
  const guest = page.locator('button:has-text("Continue without an account")').first();
  if (await guest.count()) { await guest.click({ force: true }).catch(() => {}); await page.waitForTimeout(3500); }
  const COMPOSER = 'textarea[placeholder*="Message"]:visible, textarea:visible';
  if (!(await page.locator(COMPOSER).count())) {
    const pill = page.locator('button:has-text("Chat")').first();
    if (await pill.count()) { await pill.click({ force: true }).catch(() => {}); await page.waitForTimeout(3000); }
  }
  return page.locator(COMPOSER).first();
};

try {
  let box = await enter();
  rec.entry = { composer: await box.count(), viewport: `${VW}x${VH}`, storageAtStart: rec.storageAtStart };
  await metrics('entered'); save();
  if (!(await box.count())) throw new Error('composer not found after guest entry');

  const COOLDOWN_MS = Number(process.env.COOLDOWN_MS ?? 70_000);
  const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
  const offline = (s2) => /no ai providers|offline mode|unreachable or unconfigured/i.test((s2?.tail || []).join(' '));

  for (const turn of TURNS[PHASE]) {
    const t = { stage: turn.stage, prompt: turn.prompt, at: Date.now(), mark: rec.console.length, attempts: [] };
    try {
      t.before = await snap();
      let observed = t.before, changed = false;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        const a = { n: attempt, at: Date.now() };
        box = page.locator('textarea[placeholder*="Message"]:visible, textarea:visible').first();
        if (!(await box.count())) throw new Error('composer missing');
        await box.evaluate((el) => el.focus());
        await box.fill(turn.prompt).catch(async () => page.keyboard.insertText(turn.prompt));
        await page.waitForTimeout(400);
        await box.evaluate((el) => el.focus());
        await page.keyboard.press('Enter');
        a.sent = Date.now();
        const deadline = Date.now() + WAIT_MS;
        changed = false;
        let stable = 0, limited = false;
        while (Date.now() < deadline) {
          await page.waitForTimeout(3000);
          const now = await snap();
          const grew =
            now.windows !== observed.windows ||
            now.contents.length !== observed.contents.length ||
            now.toolMentions.length > (observed.toolMentions || []).length ||
            now.snapshotMentions.length > (observed.snapshotMentions || []).length;
          if (grew) changed = true;
          observed = now;
          stable = grew ? 0 : stable + 1;
          if (offline(now)) { limited = true; break; }
          if (changed && stable >= 4) break;
        }
        a.waitedMs = Date.now() - a.sent;
        a.changed = changed; a.providerLimited = limited;
        a.windows = observed.windows; a.contents = observed.contents.length;
        a.tools = rec.console.slice(t.mark).filter((l) => /Tool [a-z_.]+ ->|Composed environment|Presented |Saved environment|Restored environment|Surface \[/i.test(l)).slice(-6);
        t.attempts.push(a);
        save();
        console.log(`  ${turn.stage} attempt ${attempt}: changed=${changed} limited=${limited} win=${observed.windows} waited=${a.waitedMs}ms`);
        if (changed) break;
        if (limited && attempt < ATTEMPTS) {
          rec.cooldowns = rec.cooldowns || [];
          rec.cooldowns.push({ stage: turn.stage, waitedMs: COOLDOWN_MS, at: Date.now() });
          save();
          await page.waitForTimeout(COOLDOWN_MS);
        }
      }
      t.observed = observed;
      t.waitedMs = t.attempts.reduce((n, a) => n + (a.waitedMs || 0), 0);
      t.console = rec.console.slice(t.mark);
      t.toolEvidence = t.console.filter((l) => /Tool [a-z_.]+ ->|toolCalls|Composed environment|Presented |Saved environment|Restored environment|Surface \[|mutat/i.test(l)).slice(-24);
      t.provider = t.console.filter((l) => /Trying |generated response|refused|cooldown|rate limit|429/i.test(l)).slice(-12);
      await page.screenshot({ path: path.join(OUT, 'shots', `${TAG}-p${PHASE}-${turn.stage}.png`) }).catch(() => {});
      await metrics(`turn-${turn.stage}`);
      t.result = changed ? 'RECORDED' : (t.attempts.every((a) => a.providerLimited) ? 'PROVIDER_LIMITED' : 'NO_CHANGE');
    } catch (e) {
      t.error = String(e.message || e).slice(0, 400); t.result = 'ERROR';
      await page.screenshot({ path: path.join(OUT, 'shots', `${TAG}-p${PHASE}-${turn.stage}-error.png`) }).catch(() => {});
    }
    rec.turns.push(t); save();
    console.log(`${turn.stage}: ${t.result} waited=${t.waitedMs ?? 0}ms windows=${t.observed?.windows ?? '?'} contents=${t.observed?.contents?.length ?? '?'} snaps=${JSON.stringify(t.observed?.snapshotMentions ?? [])}`);
    if (t.error && /closed|crash|Target page/i.test(t.error)) break;
  }
  rec.finalState = await snap();
  await page.screenshot({ path: path.join(OUT, 'shots', `${TAG}-p${PHASE}-final.png`) }).catch(() => {});
  rec.result = 'RECORDED';
  save();
} catch (e) {
  rec.error = String(e.message || e).slice(0, 500);
  rec.result = rec.result === 'RUNNING' ? 'ERROR' : rec.result;
  save();
  console.log(JSON.stringify({ result: rec.result, error: rec.error }));
} finally {
  await ctx.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ result: rec.result, turns: rec.turns.map((t) => ({ s: t.stage, r: t.result, w: t.waitedMs, win: t.observed?.windows, con: t.observed?.contents?.length, tools: t.toolEvidence?.slice(-3) })), modelRequests: rec.modelRequests.length, crashes: rec.crashes.length }, null, 1).slice(0, 3000));
}
