import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'docs/acceptance/spatial-phase-2-15-4';
fs.mkdirSync(OUT, { recursive: true });
const PORT = process.argv[2] ?? '4184';
const VPS = [[360, 640], [375, 812], [390, 844], [430, 932]];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

for (const [W, H] of VPS) {
 const rec = { viewport: `${W}x${H}`, at: new Date().toISOString(), phases: [], errors: [] };
 const save = () => fs.writeFileSync(`${OUT}/lifecycle-${W}x${H}.json`, JSON.stringify(rec, null, 1));
 try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('crash', () => { rec.crash = true; save(); });
  page.on('pageerror', (e) => rec.errors.push(e.message.slice(0, 160)));

  const health = () => page.evaluate(() => {
    const wins = [...document.querySelectorAll('[data-lelu-module-window]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-lelu-module-window'), presentation: el.getAttribute('data-lelu-module-presentation') ?? el.getAttribute('data-presentation'), host: el.getAttribute('data-lelu-module-host'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const ch = document.querySelector('[data-lelu-module-chrome]');
    const cr = ch?.getBoundingClientRect();
    const ctrls = ch ? [...ch.querySelectorAll('button')].map((b) => ({ label: b.getAttribute('title') ?? b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 18) })) : [];
    let store = null;
    try { const p = JSON.parse(localStorage.getItem('lelu.lelu.layout.v2') ?? 'null'); store = (p?.entries ?? []).map((e) => ({ moduleId: e.moduleId, x: e.x ?? e.rect?.x, y: e.y ?? e.rect?.y, w: e.width ?? e.rect?.width, h: e.height ?? e.rect?.height, manual: e.manual, pinned: e.pinned })); } catch {}
    return { canvas: document.querySelectorAll('canvas').length, wins, handle: cr ? { y: Math.round(cr.y + cr.height / 2), x: Math.round(cr.x + cr.width / 2), h: Math.round(cr.height) } : null, content: [...document.querySelectorAll('[data-lelu-module-content]')].map((e) => e.getAttribute('data-lelu-module-content')), controls: ctrls, store, vv: window.visualViewport ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height) } : null };
  }).catch(() => null);
  const rect = (s) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width < 2 ? null : { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, s).catch(() => null);
  const tapPt = async (pt) => { if (!pt) return false; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] }).catch(() => {}); await page.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); return true; };
  const tap = async (s) => tapPt(await rect(s));
  const tapByTitle = async (re) => tapPt(await page.evaluate((src) => { const b = [...document.querySelectorAll('button[title]')].find((x) => new RegExp(src).test(x.getAttribute('title') ?? '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, re.source).catch(() => null));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => rec.errors.push('GOTO'));
  await page.waitForTimeout(4200);
  // Gate dismissal is setup, not the item under test: a JS click avoids
  // landing a synthetic touch on the live canvas before anything is measured.
  await page.evaluate(() => { const g = document.querySelector('[data-lelu-signin-gate]'); const b = g && [...g.querySelectorAll('button')].find((x) => /^Continue/.test((x.textContent || '').trim())); b?.click(); }).catch(() => {});
  await page.waitForTimeout(1200);

  let opened = await tap('[data-spatial-control="creation"]');
  for (let i = 0; i < 20 && !(await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => false)); i++) {
    if (!opened) { opened = await tapPt(await page.evaluate(() => { const b = [...document.querySelectorAll('button, [role="button"]')].find((x) => /^(Studio|Genesis Studios)$/i.test((x.textContent || '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return r.width < 2 ? null : { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).catch(() => null)); }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);
  rec.phases.push({ phase: 'opened', health: await health() });

  const h0 = rec.phases[0].health;
  const win0 = h0?.wins?.find((w) => w.id === 'creation') ?? h0?.wins?.[0];
  rec.identity = { moduleId: win0?.id, presentation: win0?.presentation, host: win0?.host, content: h0?.content, canvases: h0?.canvas };
  if (!win0 || !h0?.handle) { rec.result = 'BLOCKED: no window/handle'; save(); await ctx.close(); continue; }

  const hx = h0.handle.x, hy = h0.handle.y;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hx, y: hy }] });
  await page.waitForTimeout(120);
  const dy = 16 * 5; // toward the bottom dock: the sheet opens docked at the top
  for (let k = 1; k <= 5; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hx, y: hy + dy * k / 5 }] }); await page.waitForTimeout(110); }
  rec.phases.push({ phase: 'dragged', health: await health() });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // The dock commit lands through React state + the store sync; sampling too
  // early reads the pre-commit rectangle and reports false NO MOVEMENT.
  await page.waitForTimeout(1800);
  rec.phases.push({ phase: 'released', health: await health() });

  const h1 = rec.phases.at(-1).health;
  const win1 = h1?.wins?.find((w) => w.id === win0.id);
  rec.placement = { before: { x: win0.x, y: win0.y, w: win0.w, h: win0.h }, after: win1 && { x: win1.x, y: win1.y, w: win1.w, h: win1.h }, dx: win1 ? win1.x - win0.x : null, dy: win1 ? win1.y - win0.y : null, storeEntry: h1?.store?.find((e) => e.moduleId === win0.id) ?? null, safeArea: { top: win1?.y, bottom: H - ((win1?.y ?? 0) + (win1?.h ?? 0)) }, controls: h1?.controls, canvases: [h0.canvas, h1?.canvas] };

  await tapByTitle(/^Pin /);
  await page.waitForTimeout(500);
  rec.phases.push({ phase: 'pinned', health: await health() });
  await tapByTitle(/^Unpin/);
  await page.waitForTimeout(500);
  rec.phases.push({ phase: 'unpinned', health: await health() });
  const h2 = rec.phases.at(-1).health;
  rec.pin = { pinnedEntry: rec.phases.at(-2).health?.store?.find((e) => e.moduleId === win0.id) ?? null, unpinnedEntry: h2?.store?.find((e) => e.moduleId === win0.id) ?? null };

  const pre = { x: win1?.x, y: win1?.y, w: win1?.w, h: win1?.h };
  rec.preReload = { rect: pre, store: h2?.store?.find((e) => e.moduleId === win0.id) ?? null };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // Restoration is only observable once the module is open again: closing it
  // unmounts the window, it does not erase the stored rectangle.
  await page.evaluate(() => { const g = document.querySelector('[data-lelu-signin-gate]'); const b = g && [...g.querySelectorAll('button')].find((x) => /^Continue/.test((x.textContent || '').trim())); b?.click(); }).catch(() => {});
  await page.waitForTimeout(1000);
  if (!(await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => false))) {
    await tap('[data-spatial-control="creation"]');
    for (let i = 0; i < 15 && !(await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => false)); i++) await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  const h3 = await health();
  const win3 = h3?.wins?.find((w) => w.id === win0.id) ?? h3?.wins?.[0] ?? null;
  rec.reload = { rect: win3 && { x: win3.x, y: win3.y, w: win3.w, h: win3.h }, windows: h3?.wins?.length, presentation: win3?.presentation, storeEntry: h3?.store?.find((e) => e.moduleId === win0.id) ?? null, canvases: h3?.canvas,
    delta: win3 ? { dx: win3.x - pre.x, dy: win3.y - pre.y, dw: win3.w - pre.w, dh: win3.h - pre.h } : null };
  rec.result = win1 && (win1.y !== win0.y || win1.x !== win0.x) ? 'MEASURED' : 'NO MOVEMENT';
  save();
  await ctx.close();
 } catch (e) {
  rec.result = 'BLOCKED: ' + String(e.message || e).slice(0, 120);
  try { rec.phases.push({ phase: 'after-failure', health: await health() }); } catch {}
  save();
  try { await ctx.close(); } catch {}
 }
}
await browser.close();
for (const [W, H] of VPS) { try { const r = JSON.parse(fs.readFileSync(`${OUT}/lifecycle-${W}x${H}.json`)); console.log(W + 'x' + H, JSON.stringify({ id: r.identity, place: r.placement && { d: [r.placement.dx, r.placement.dy], after: r.placement.after, store: r.placement.storeEntry, controls: r.placement.controls?.length, canv: r.placement.canvases }, reload: r.reload && { d: r.reload.delta, n: r.reload.windows, canv: r.reload.canvases }, result: r.result, crash: r.crash ?? null, err: r.errors.slice(0, 2) })); } catch (e) { console.log(W + 'x' + H, 'NO RECORD', e.message); } }
