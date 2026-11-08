/*
 * MISSION 5.7 — listener lifecycle measurement.
 *
 * Mission 5.6 measured listeners nearly doubling over 5.6 minutes without
 * saying WHICH listeners or where they come from. Counting them again would
 * only repeat that. This uses CDP DOMDebugger.getEventListeners on window and
 * document, so each entry carries the script that registered it — the
 * difference between "listeners grow" and "THIS line registers a new one each
 * time X happens".
 *
 * Read-only against the running app: no model request, no injected state.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? '3013';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/acceptance/mission-5-7';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const CYCLES = Number(process.env.CYCLES ?? 8);

const rec = { mission: '5.7', at: new Date().toISOString(), samples: [], notes: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'listener-lifecycle-results.json'), JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  await cdp.send('Debugger.enable').catch(() => {});

  // scriptId -> url, so a listener entry can name its own source file.
  const scripts = new Map();
  cdp.on('Debugger.scriptParsed', (e) => scripts.set(e.scriptId, e.url || `(inline:${e.scriptId})`));

  const enter = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3000);
    const cosmos = page.locator('button.lch-cosmos').first();
    if (await cosmos.count()) {
      await cosmos.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    const guest = page.locator('button:has-text("Continue without an account")').first();
    if (await guest.count()) {
      await guest.click({ force: true }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  };

  const listenersFor = async (expression, label) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'probe' });
    if (!result?.objectId) return { label, error: 'no objectId' };
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 1 });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
    const byType = {};
    const bySite = {};
    for (const l of listeners) {
      byType[l.type] = (byType[l.type] ?? 0) + 1;
      const url = scripts.get(String(l.scriptId)) ?? 'unknown';
      const key = `${l.type} @ ${url.split('/').slice(-2).join('/')}:${l.lineNumber}`;
      bySite[key] = (bySite[key] ?? 0) + 1;
    }
    return {
      label,
      total: listeners.length,
      byType,
      // Only sites holding more than one copy are interesting: one is normal,
      // many copies of the same line is a registration that outlives its owner.
      duplicates: Object.entries(bySite).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 12),
      distinctSites: Object.keys(bySite).length,
    };
  };

  const perf = async (label) => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const p = (n) => metrics.find((m) => m.name === n)?.value ?? null;
    return {
      label,
      heapMB: p('JSHeapUsedSize') ? +(p('JSHeapUsedSize') / 1048576).toFixed(1) : null,
      nodes: p('Nodes'),
      jsListeners: p('JSEventListeners'),
    };
  };

  await enter();
  rec.samples.push({ ...(await listenersFor('window', 'window:start')), perf: await perf('start') });
  rec.samples.push({ ...(await listenersFor('document', 'document:start')), perf: await perf('start') });
  save();

  const pills = ['Chat', 'Studio', 'Files'];
  for (let i = 0; i < CYCLES; i += 1) {
    const pill = page.locator(`button:has-text("${pills[i % pills.length]}")`).first();
    if (await pill.count()) await pill.click({ force: true }).catch(() => {});
    const cosmos = page.locator('button.lch-cosmos').first();
    if (await cosmos.count()) await cosmos.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  rec.samples.push({ ...(await listenersFor('window', `window:after-${CYCLES}-cycles`)), perf: await perf('cycles') });
  rec.samples.push({ ...(await listenersFor('document', `document:after-${CYCLES}-cycles`)), perf: await perf('cycles') });
  save();

  // Open and close a chat surface repeatedly: the lifecycle 5.6 could not name.
  for (let i = 0; i < 3; i += 1) {
    const chat = page.locator('button:has-text("Chat")').first();
    if (await chat.count()) await chat.click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
  }
  rec.samples.push({ ...(await listenersFor('window', 'window:after-chat-cycles')), perf: await perf('chat') });
  rec.samples.push({ ...(await listenersFor('document', 'document:after-chat-cycles')), perf: await perf('chat') });
  save();

  rec.webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('webgl2');
    return { available: Boolean(gl), lost: gl ? gl.isContextLost() : null };
  });
  rec.result = 'RECORDED';
  save();
  console.log(
    JSON.stringify(
      rec.samples.map((s) => ({ label: s.label, total: s.total, distinct: s.distinctSites, dup: (s.duplicates || []).slice(0, 4), perf: s.perf })),
      null,
      1,
    ).slice(0, 4000),
  );
} catch (e) {
  rec.error = String(e.message || e).slice(0, 300);
  rec.result = 'ERROR';
  save();
  console.log('ERROR', rec.error);
} finally {
  await browser.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  save();
}
