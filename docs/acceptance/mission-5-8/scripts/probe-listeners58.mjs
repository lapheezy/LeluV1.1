/* Mission 5.8 — listener attribution that distinguishes a renderer crash from a harness fault. */
import { chromium } from 'playwright';
import fs from 'fs';
const PORT = process.env.PORT ?? '3013';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'docs/acceptance/mission-5-8/listener-attribution-58.json';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const CYCLES = Number(process.env.CYCLES ?? 3);
const rec = { mission: '5.8', at: new Date().toISOString(), stage: 'launch', events: [], samples: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(rec, null, 2));
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
let disconnected = null;
browser.on('disconnected', () => { disconnected = new Date().toISOString(); });
try {
  rec.stage = 'context';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('crash', () => rec.events.push({ at: new Date().toISOString(), event: 'page-crash' }));
  page.on('close', () => rec.events.push({ at: new Date().toISOString(), event: 'page-close' }));
  page.on('console', (m) => { if (m.type() === 'error') rec.events.push({ event: 'console-error', text: m.text().slice(0, 120) }); });
  page.on('pageerror', (e) => rec.events.push({ event: 'pageerror', text: String(e.message).slice(0, 120) }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  await cdp.send('Debugger.enable').catch(() => {});
  const scripts = new Map();
  cdp.on('Debugger.scriptParsed', (e) => scripts.set(e.scriptId, e.url || `(inline:${e.scriptId})`));
  const listenersFor = async (expr, label) => {
    rec.stage = `listeners:${label}`;
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr, objectGroup: 'probe' });
    if (!result?.objectId) return { label, error: 'no objectId' };
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 1 });
    const bySite = {};
    for (const l of listeners) {
      const url = scripts.get(String(l.scriptId)) ?? 'unknown';
      const k = `${l.type} @ ${url.split('/').slice(-2).join('/')}:${l.lineNumber}`;
      bySite[k] = (bySite[k] ?? 0) + 1;
    }
    return { label, total: listeners.length, distinctSites: Object.keys(bySite).length,
      duplicates: Object.entries(bySite).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  };
  const perf = async (label) => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const p = (n) => metrics.find((m) => m.name === n)?.value ?? null;
    return { label, heapMB: p('JSHeapUsedSize') ? +(p('JSHeapUsedSize') / 1048576).toFixed(1) : null,
      nodes: p('Nodes'), jsListeners: p('JSEventListeners') };
  };
  rec.stage = 'goto';
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  const guest = page.locator('button:has-text("Continue without an account")').first();
  if (await guest.count()) { await guest.click({ force: true }).catch(() => {}); await page.waitForTimeout(2500); }
  rec.samples.push({ ...(await listenersFor('window', 'window:start')), perf: await perf('start') });
  rec.samples.push({ ...(await listenersFor('document', 'document:start')), perf: await perf('start') });
  save();
  const pills = ['Chat', 'Studio', 'Files'];
  for (let i = 0; i < CYCLES; i += 1) {
    rec.stage = `cycle-${i + 1}`;
    const pill = page.locator(`button:has-text("${pills[i % pills.length]}")`).first();
    if (await pill.count()) await pill.click({ force: true, timeout: 8000 }).catch((e) => rec.events.push({ event: 'pill-click', text: String(e.message).slice(0, 90) }));
    await page.waitForTimeout(1000);
    rec.samples.push({ ...(await listenersFor('window', `window:after-cycle-${i + 1}`)), perf: await perf(`cycle-${i + 1}`) });
    save();
  }
  rec.samples.push({ ...(await listenersFor('window', `window:after-${CYCLES}-cycles`)), perf: await perf('cycles') });
  rec.samples.push({ ...(await listenersFor('document', `document:after-${CYCLES}-cycles`)), perf: await perf('cycles') });
  rec.result = 'RECORDED';
  save();
  console.log(JSON.stringify(rec.samples.map((s) => ({ l: s.label, t: s.total, d: s.distinctSites, dup: (s.duplicates || []).length, heap: s.perf?.heapMB, nodes: s.perf?.nodes, js: s.perf?.jsListeners })), null, 0).slice(0, 2600));
} catch (e) {
  rec.error = String(e.message || e).slice(0, 200);
  rec.result = 'ERROR';
  rec.disconnectedAt = disconnected;
  save();
  console.log('ERROR', rec.error, '| stage:', rec.stage, '| events:', JSON.stringify(rec.events.slice(-4)), '| disconnected:', disconnected);
} finally {
  await browser.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  if (!rec.result) rec.result = 'INCOMPLETE';
  save();
}
