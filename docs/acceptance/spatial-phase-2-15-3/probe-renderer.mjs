import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.argv[2] ?? '4183';
const W = Number(process.argv[3] ?? 360), H = Number(process.argv[4] ?? 640);
const MODE = process.argv[5] ?? 'webgl'; // webgl | hidden
const OUT = 'docs/acceptance/spatial-phase-2-15-3';
fs.mkdirSync(OUT, { recursive: true });
const rec = { viewport: `${W}x${H}`, mode: MODE, at: new Date().toISOString(), timeline: [], checks: {}, errors: [], console: [], crashed: null };
const save = () => { try { fs.writeFileSync(`${OUT}/renderer-probe-${W}x${H}-${MODE}.json`, JSON.stringify(rec, null, 1)); } catch {} };
process.on('exit', save);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const mark = (step) => rec.timeline.push({ step, t: Date.now() });
page.on('crash', () => { rec.crashed = 'page crash event'; rec.timeline.push({ step: 'CRASH', t: Date.now() }); save(); });
page.on('pageerror', (e) => rec.errors.push(e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' || /webgl|context|three|render/i.test(m.text())) rec.console.push(m.type() + ': ' + m.text().slice(0, 180)); });

const tap = async (pt) => { if (!pt) return; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] }).catch(() => {}); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); };
const box = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return r.width < 2 ? null : { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top), h: Math.round(r.height) }; }, sel).catch(() => null);
const health = () => page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')];
  return {
    canvases: canvases.length,
    canvasSizes: canvases.map((c) => ({ w: c.width, h: c.height })),
    windows: [...document.querySelectorAll('[data-lelu-module-window]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-lelu-module-window'), presentation: el.getAttribute('data-lelu-module-presentation') ?? el.getAttribute('data-presentation'), host: el.getAttribute('data-lelu-module-host'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }),
    chrome: [...document.querySelectorAll('[data-lelu-module-chrome]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-lelu-module-chrome'), y: Math.round(r.y), h: Math.round(r.height) }; }),
    content: [...document.querySelectorAll('[data-lelu-module-content]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-lelu-module-content'), w: Math.round(r.width), h: Math.round(r.height) }; }),
    visualViewport: window.visualViewport ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height) } : null,
    inner: { w: window.innerWidth, h: window.innerHeight },
  };
}).catch(() => null);
const store = () => page.evaluate(() => {
  const raw = localStorage.getItem('lelu.lelu.layout.v2'); if (!raw) return null;
  const p = JSON.parse(raw); const es = p.entries ?? p.layout?.entries ?? [];
  return es.map((e) => ({ moduleId: e.moduleId, x: e.x ?? e.rect?.x, y: e.y ?? e.rect?.y, w: e.width ?? e.rect?.width, h: e.height ?? e.rect?.height, manual: e.manual, pinned: e.pinned }));
}).catch(() => null);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => rec.errors.push('GOTO'));
await page.waitForTimeout(4200);
mark('loaded');
await tap(await page.evaluate(() => { const g = document.querySelector('[data-lelu-signin-gate]'); const b = g && [...g.querySelectorAll('button')].find((x) => /^Continue/.test((x.textContent || '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null));
await page.waitForTimeout(1000);
mark('gate-dismissed');
if (MODE === 'hidden') {
  await tap(await box('[data-spatial-control="minimise"]'));
  await page.waitForTimeout(1200);
  mark('interface-minimised');
}
await tap(await page.evaluate(() => { const b = [...document.querySelectorAll('button, [role="button"], a')].find((x) => /^(Studio|Genesis Studios)$/i.test((x.textContent || '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return r.width < 2 ? null : { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null));
let opened = null;
for (let i = 0; i < 60 && !opened; i++) { opened = await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => null); if (!opened) await page.waitForTimeout(300); }
mark('module-open-attempted');
rec.checks.healthAfterOpen = await health();
const chrome = await box('[data-lelu-module-chrome]');
rec.checks.handle = chrome;
if (!chrome) { rec.checks.result = 'BLOCKED: no module chrome'; save(); console.log(JSON.stringify({ checks: rec.checks, timeline: rec.timeline })); await browser.close().catch(() => {}); process.exit(0); }

const before = rec.checks.healthAfterOpen?.windows?.find((w) => w.presentation === 'inline') ?? null;
mark('gesture-start');
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: chrome.x - 46, y: chrome.y, button: 'left', clickCount: 1 }).catch(() => {});
rec.checks.healthAfterDown = await health();
for (let k = 1; k <= 6; k++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chrome.x - 46, y: chrome.y - (12 * k), button: 'left', buttons: 1 }).catch(() => {});
  await page.waitForTimeout(90);
  mark(`move-${k}`);
}
rec.checks.healthAfterMoves = await health();
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: chrome.x - 46, y: chrome.y - 72, button: 'left', clickCount: 1 }).catch(() => {});
mark('released');
await page.waitForTimeout(900);
rec.checks.healthAfterRelease = await health();
rec.checks.before = before;
rec.checks.store = await store();
rec.checks.pass = Boolean(before && rec.checks.healthAfterRelease?.windows?.[0] && rec.checks.healthAfterRelease.windows[0].y !== before.y);
save();
console.log(JSON.stringify({ mode: MODE, before, after: rec.checks.healthAfterRelease?.windows?.[0] ?? null, canvases: [rec.checks.healthAfterOpen?.canvases, rec.checks.healthAfterRelease?.canvases], handle: chrome, store: rec.checks.store, crashed: rec.crashed, errors: rec.errors.slice(0, 3), console: rec.console.slice(0, 4), timelineTail: rec.timeline.slice(-4) }, null, 1));
await browser.close().catch(() => {});
