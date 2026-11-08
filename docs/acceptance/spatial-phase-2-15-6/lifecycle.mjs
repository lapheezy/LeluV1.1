/*
 * MISSION 2.15.6 — instrumented mobile window lifecycle probe.
 *
 *   OPEN -> POSITION -> DRAG -> LIVE UPDATE -> COMMIT -> SAVE -> RELOAD -> RESTORE
 *
 * Unlike the 2.15.5 probe this one NEVER touches application state: it reads the
 * DOM rectangle, the real pointer event path (captured at window level before React
 * sees it), the pointer-capture flags, and localStorage. It runs the SAME drag
 * twice — once with CDP touch, once with browser pointer input — so the two input
 * paths can be compared instead of one being assumed to be broken.
 *
 * usage: node lifecycle.mjs <port>
 */
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'docs/acceptance/spatial-phase-2-15-6';
fs.mkdirSync(OUT, { recursive: true });
const PORT = process.argv[2] ?? '4196';
const VPS = [[360, 640], [375, 812], [390, 844], [430, 932]];
/* Optional subset, e.g. `node lifecycle.mjs 4199 390x844,430x932`. */
const only = process.argv[3] ? process.argv[3].split(',').map((s) => s.split('x').map(Number)) : null;
const RUNS = only ?? VPS;
const ID = 'creation';

/*
 * ONE browser per viewport.
 *
 * Four software-rendered WebGL scenes in a single process exhausted the
 * renderer: the 390x844 run took its page down mid-gesture and the next
 * `newContext` then failed. A per-viewport browser isolates such a failure to
 * the viewport that caused it instead of losing the rest of the run.
 */
const browserArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];

for (const [W, H] of RUNS) {
  const rec = { viewport: `${W}x${H}`, at: new Date().toISOString(), phases: [], errors: [] };
  const save = () => fs.writeFileSync(`${OUT}/lifecycle-${W}x${H}.json`, JSON.stringify(rec, null, 1));
  let ctx = null;
  let browser = null;
  /* A software-rendered scene sometimes takes its renderer down mid-run; retry once. */
  for (let attempt = 1; attempt <= 2; attempt++) {
  rec.attempt = attempt;
  try {
    browser = await chromium.launch({ headless: true, args: browserArgs });
    ctx = await browser.newContext({
      viewport: { width: W, height: H },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    page.on('pageerror', (e) => rec.errors.push(String(e.message || e).slice(0, 200)));
    page.on('crash', () => { rec.crash = true; save(); });

    /* Capture the REAL event path before any React handler runs. */
    await page.addInitScript(() => {
      const log = (window.__leluEv = []);
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        window.addEventListener(
          type,
          (e) => {
            if (log.length > 600) return;
            const t = e.target;
            log.push({
              t: type,
              id: e.pointerId,
              pt: e.pointerType,
              x: Math.round(e.clientX),
              y: Math.round(e.clientY),
              btn: e.button,
              chrome: Boolean(t && t.closest && t.closest('[data-lelu-module-chrome]')),
              control: Boolean(t && t.closest && t.closest('button, input, select, textarea, a')),
              tag: t ? String(t.tagName || '').slice(0, 12) : '',
              defaultPrevented: e.defaultPrevented,
            });
          },
          true,
        );
      }
    });

    const health = () =>
      page
        .evaluate((ID) => {
          const readStore = () => {
            try {
              const raw = JSON.parse(localStorage.getItem('lelu.lelu.layout.v2') ?? 'null');
              const entry = (raw?.entries ?? []).find((e) => e.moduleId === ID);
              if (!entry) return null;
              const r = entry.rect ?? entry;
              return { moduleId: entry.moduleId, x: r.x, y: r.y, w: r.width ?? r.w, h: r.height ?? r.h, manual: entry.manual, pinned: entry.pinned };
            } catch {
              return 'UNREADABLE';
            }
          };
          const wins = [...document.querySelectorAll('[data-lelu-module-window]')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              id: el.getAttribute('data-lelu-module-window'),
              presentation: el.getAttribute('data-lelu-module-presentation') ?? el.getAttribute('data-presentation'),
              host: el.getAttribute('data-lelu-module-host'),
              interacting: el.getAttribute('data-lelu-interacting') !== null,
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          });
          const chrome = document.querySelector('[data-lelu-module-chrome]');
          const cr = chrome?.getBoundingClientRect();
          const ids = [...new Set(((window.__leluEv ?? []).filter((e) => e.t === 'pointerdown').map((e) => e.id)))];
          return {
            canvas: document.querySelectorAll('canvas').length,
            hosts: document.querySelectorAll('[data-lelu-module-host]').length,
            contents: [...document.querySelectorAll('[data-lelu-module-content]')].map((e) => e.getAttribute('data-lelu-module-content')),
            wins,
            chrome: cr
              ? {
                  x: Math.round(cr.x + cr.width / 2),
                  y: Math.round(cr.y + cr.height / 2),
                  left: Math.round(cr.x),
                  right: Math.round(cr.x + cr.width),
                  w: Math.round(cr.width),
                  h: Math.round(cr.height),
                }
              : null,
            capture: ids.map((id) => ({ id, held: Boolean(chrome?.hasPointerCapture?.(id)) })),
            store: readStore(),
            vv: { w: Math.round(window.visualViewport?.width ?? innerWidth), h: Math.round(window.visualViewport?.height ?? innerHeight) },
          };
        }, ID)
        .catch(() => null);

    const tapControl = async (sel) =>
      page
        .evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 2) return false;
          el.click();
          return true;
        }, sel)
        .catch(() => false);

    const tapButtonByTitle = async (src) =>
      page
        .evaluate((src) => {
          const b = [...document.querySelectorAll('button[title]')].find((x) => new RegExp(src).test(x.getAttribute('title') ?? ''));
          if (!b) return false;
          b.click();
          return true;
        }, src.source)
        .catch(() => false);

    const openModule = async () => {
      await tapControl(`[data-spatial-control="${ID}"]`);
      for (let i = 0; i < 20; i++) {
        if (await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => false)) return true;
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button, [role="button"]')].find((x) => /^(Studio|Genesis Studios)$/i.test((x.textContent || '').trim()));
          b?.click();
        }).catch(() => {});
        await page.waitForTimeout(350);
      }
      return false;
    };

    const dismissGate = () =>
      page
        .evaluate(() => {
          const g = document.querySelector('[data-lelu-signin-gate]');
          const b = g && [...g.querySelectorAll('button')].find((x) => /^Continue/.test((x.textContent || '').trim()));
          b?.click();
        })
        .catch(() => {});

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => rec.errors.push('GOTO'));
    await page.waitForTimeout(4200);
    await dismissGate();
    await page.waitForTimeout(1200);
    const opened = await openModule();
    await page.waitForTimeout(1200);
    rec.phases.push({ phase: 'opened', health: await health() });
    const h0 = rec.phases.at(-1).health;
    const win0 = h0?.wins?.find((w) => w.id === ID);
    rec.identity = { moduleId: win0?.id, presentation: win0?.presentation, host: win0?.host, canvases: h0?.canvas, contents: h0?.contents };
    if (!win0 || !h0?.chrome) {
      rec.result = opened ? 'BLOCKED: no window chrome' : 'BLOCKED: module did not open';
      save();
      await ctx.close();
      continue;
    }
    /*
     * Press the TITLE area, not the chrome centre.
     *
     * The centre of a 346 px chrome sits under the control cluster (pin /
     * minimize / expand / close occupy the right ~150 px), and the drag handler
     * correctly refuses to start a gesture on a button. A press on the title is
     * what a person does to move a window.
     */
    /*
     * The press point must be measured PER GESTURE.
     *
     * Reusing the first gesture's coordinates left the second press in empty
     * scene once the window had moved — a harness artefact that read as "the
     * drag engine is broken". A person always presses the chrome where it is.
     */
    const pressPoint = async () => {
      const h = await health();
      const c = h?.chrome;
      if (!c) return null;
      return {
        x: Math.round(c.left + Math.min(40, Math.max(12, c.w * 0.15))),
        y: c.y,
        rect: h.wins?.find((w) => w.id === ID) ?? null,
      };
    };

    /* ------------- gesture 1: CDP touch ------------- */
    const touchDrag = async (dyTotal) => {
      await page.evaluate(() => { if (window.__leluEv) window.__leluEv.length = 0; });
      const p = await pressPoint();
      if (!p) throw new Error('no chrome to press');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await page.waitForTimeout(120);
      const captureAfterDown = (await health())?.capture ?? [];
      let mid = null;
      for (let k = 1; k <= 6; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: Math.round(p.y + (dyTotal * k) / 6) }] });
        await page.waitForTimeout(90);
        if (k === 3) mid = await health();
      }
      const during = await health();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const atRelease = await health();
      await page.waitForTimeout(400);
      const settled = await health();
      const ev = await page.evaluate(() => window.__leluEv ?? []);
      return { captureAfterDown, mid, during, atRelease, settled, ev, startRect: p.rect };
    };

    /* ------------- gesture 2: real browser pointer input ------------- */
    const pointerDrag = async (dyTotal) => {
      await page.evaluate(() => { if (window.__leluEv) window.__leluEv.length = 0; });
      const p = await pressPoint();
      if (!p) throw new Error('no chrome to press');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(120);
      const captureAfterDown = (await health())?.capture ?? [];
      let mid = null;
      for (let k = 1; k <= 6; k++) {
        await page.mouse.move(p.x, Math.round(p.y + (dyTotal * k) / 6), { steps: 2 });
        await page.waitForTimeout(90);
        if (k === 3) mid = await health();
      }
      const during = await health();
      await page.mouse.up();
      const atRelease = await health();
      await page.waitForTimeout(400);
      const settled = await health();
      const ev = await page.evaluate(() => window.__leluEv ?? []);
      return { captureAfterDown, mid, during, atRelease, settled, ev, startRect: p.rect };
    };

    const summarise = (g) => {
      const win = (h) => h?.wins?.find((w) => w.id === ID) ?? null;
      const start = g.startRect ?? win(h0);
      const first = g.ev.find((e) => e.t === 'pointerdown');
      return {
        pointer: first ? { id: first.id, type: first.pt, target: first.tag, onChrome: first.chrome, onControl: first.control } : null,
        events: {
          down: g.ev.filter((e) => e.t === 'pointerdown').length,
          move: g.ev.filter((e) => e.t === 'pointermove').length,
          up: g.ev.filter((e) => e.t === 'pointerup').length,
          cancel: g.ev.filter((e) => e.t === 'pointercancel').length,
        },
        moveOnChrome: g.ev.filter((e) => e.t === 'pointermove' && e.chrome).length,
        capture: g.captureAfterDown,
        live: g.during ? win(g.during) : null,
        liveDelta: g.during ? (() => { const w = win(g.during); return w ? { dx: w.x - start.x, dy: w.y - start.y } : null; })() : null,
        atRelease: g.atRelease ? win(g.atRelease) : null,
        atReleaseStore: g.atRelease?.store ?? null,
        settled: g.settled ? win(g.settled) : null,
        settledStore: g.settled?.store ?? null,
        committedSameGesture: Boolean(
          g.settled?.store &&
            g.settled.wins?.find((w) => w.id === ID) &&
            Math.abs(g.settled.store.x - g.settled.wins.find((w) => w.id === ID).x) <= 1 &&
            Math.abs(g.settled.store.y - g.settled.wins.find((w) => w.id === ID).y) <= 1 &&
            Math.abs(g.settled.store.h - g.settled.wins.find((w) => w.id === ID).h) <= 2,
        ),
      };
    };

    const touch = summarise(await touchDrag(80));
    rec.phases.push({ phase: 'touch-release', health: await health() });
    rec.touch = touch;
    const afterTouch = (await health())?.wins?.find((w) => w.id === ID) ?? null;

    const pointer = summarise(await pointerDrag(72));
    rec.phases.push({ phase: 'pointer-release', health: await health() });
    rec.pointer = pointer;
    const committed = pointer.settled?.wins?.find((w) => w.id === ID) ?? afterTouch;

    /* ------------- gesture 3: the next drag must start from the commit ------------- */
    const before2 = await health();
    const second = summarise(await pointerDrag(-64));
    rec.secondDrag = {
      startedAt: before2?.wins?.find((w) => w.id === ID) ?? null,
      committedBefore: before2?.store ?? null,
      startedFromCommit: Boolean(
        before2?.wins?.find((w) => w.id === ID) && before2.store && Math.abs(before2.wins.find((w) => w.id === ID).y - before2.store.y) <= 1,
      ),
      ...second,
    };
    rec.phases.push({ phase: 'second-release', health: await health() });
    const committed2 = (await health())?.wins?.find((w) => w.id === ID) ?? committed;

    /* ------------- pin / unpin ------------- */
    const beforePin = (await health())?.wins?.find((w) => w.id === ID) ?? null;
    const pinnedOk = await tapButtonByTitle(/^Pin /);
    await page.waitForTimeout(400);
    const pinned = await health();
    const unpinnedOk = await tapButtonByTitle(/^Unpin/);
    await page.waitForTimeout(400);
    const unpinned = await health();
    const rp = (h) => h?.wins?.find((w) => w.id === ID) ?? null;
    rec.pin = {
      tapped: { pin: pinnedOk, unpin: unpinnedOk },
      before: beforePin,
      pinnedRect: rp(pinned),
      unpinnedRect: rp(unpinned),
      pinnedFlag: pinned?.store?.pinned,
      unpinnedFlag: unpinned?.store?.pinned,
      geometryUnchanged: Boolean(
        beforePin && rp(unpinned) && rp(unpinned).x === beforePin.x && rp(unpinned).y === beforePin.y && rp(unpinned).w === beforePin.w && rp(unpinned).h === beforePin.h,
      ),
    };

    /* ------------- reload ------------- */
    const preReload = rp(unpinned) ?? committed2;
    rec.preReload = { rect: preReload, store: unpinned?.store ?? null };
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => rec.errors.push('RELOAD'));
    await page.waitForTimeout(5000);
    await dismissGate();
    await page.waitForTimeout(1000);
    if (!(await page.evaluate(() => Boolean(document.querySelector('[data-lelu-module-window]'))).catch(() => false))) await openModule();
    await page.waitForTimeout(1500);
    /*
     * The scene's WebGL canvas mounts asynchronously after the window. Sampling
     * surface health immediately counted 0 canvases and read as a missing
     * renderer, so wait for the canvas to exist before measuring.
     */
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: 8000 }).catch(() => {});
    const h3 = await health();
    const win3 = rp(h3);
    rec.reload = {
      rect: win3,
      presentation: win3?.presentation,
      host: win3?.host,
      windows: h3?.wins?.length,
      hosts: h3?.hosts,
      contents: h3?.contents,
      canvases: h3?.canvas,
      store: h3?.store ?? null,
      delta: win3 && preReload
        ? { dx: win3.x - preReload.x, dy: win3.y - preReload.y, dw: win3.w - preReload.w, dh: win3.h - preReload.h }
        : null,
    };
    const d = rec.reload.delta;
    rec.restoredWithin1px = Boolean(d && Math.abs(d.dx) <= 1 && Math.abs(d.dy) <= 1 && Math.abs(d.dw) <= 1 && Math.abs(d.dh) <= 1);
    rec.samePresenter = rec.reload.presentation === rec.identity?.presentation;
    rec.singleSurface = h3?.canvas === 1 && h3?.hosts === 1;

    const movedVisibly = Boolean(
      pointer.liveDelta && (pointer.liveDelta.dy !== 0 || pointer.liveDelta.dx !== 0),
    );
    const touchMovedVisibly = Boolean(touch.liveDelta && (touch.liveDelta.dy !== 0 || touch.liveDelta.dx !== 0));
    rec.result =
      movedVisibly && pointer.committedSameGesture && rec.restoredWithin1px && rec.samePresenter && rec.singleSurface
        ? 'ACCEPTED'
        : `NOT ACCEPTED (pointer live ${JSON.stringify(pointer.liveDelta)}, touch live ${JSON.stringify(touch.liveDelta)}, sameGestureCommit ${pointer.committedSameGesture}, restored ${JSON.stringify(d)})`;
    rec.verdicts = { movedVisibly, touchMovedVisibly, sameGestureCommit: pointer.committedSameGesture, restoredWithin1px: rec.restoredWithin1px, samePresenter: rec.samePresenter, singleSurface: rec.singleSurface };
    save();
    await ctx.close();
    await browser.close();
  } catch (e) {
    rec.result = 'BLOCKED: ' + String(e.message || e).slice(0, 160);
    rec.blockedAttempts = [...(rec.blockedAttempts ?? []), rec.result];
    try {
      if (ctx) await ctx.close();
      if (browser) await browser.close();
    } catch {}
    save();
  }
  if (rec.verdicts) break;
  }
}

for (const [W, H] of RUNS) {
  try {
    const r = JSON.parse(fs.readFileSync(`${OUT}/lifecycle-${W}x${H}.json`, 'utf8'));
    console.log(
      `${W}x${H}`,
      JSON.stringify({
        id: r.identity,
        touch: r.touch && { ev: r.touch.events, moved: r.touch.liveDelta, cap: r.touch.capture },
        pointer: r.pointer && { ev: r.pointer.events, onChrome: r.pointer.moveOnChrome, moved: r.pointer.liveDelta, rel: r.pointer.atRelease, store: r.pointer.settledStore, same: r.pointer.committedSameGesture },
        second: r.secondDrag && { fromCommit: r.secondDrag.startedFromCommit, moved: r.secondDrag.liveDelta },
        pin: r.pin && { flags: [r.pin.pinnedFlag, r.pin.unpinnedFlag], same: r.pin.geometryUnchanged },
        reload: r.reload && { rect: r.reload.rect, store: r.reload.store, d: r.reload.delta, canv: r.reload.canvases, hosts: r.reload.hosts },
        verdicts: r.verdicts,
        result: r.result,
        err: (r.errors ?? []).slice(0, 2),
      }),
    );
  } catch (e) {
    console.log(`${W}x${H}`, 'NO RECORD', e.message);
  }
}
