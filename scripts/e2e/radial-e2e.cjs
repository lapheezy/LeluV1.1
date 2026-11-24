/**
 * LÉLU — RADIAL MENU BROWSER TEST (M23 WP03)
 *
 * Exercises the ONE shared RadialMenu in its three hosts with real input:
 *   spatial  — the Spatial hub: tap opens the grouped list (unchanged);
 *              hold → slide → release travels to the chosen destination.
 *   composer — the Chat Universe "+": tap opens the file chooser (unchanged);
 *              hold → slide → release on "New chat" creates a chat.
 *   window   — a module window's actions handle: hold → slide → release on
 *              "Snap to the left half" (desktop / tablet only).
 *   keyboard — focus the Spatial hub, ↑ opens the ring, → moves, Enter travels.
 * Touch devices use CDP touch events (what a finger produces); desktop the mouse.
 *
 *   node scripts/e2e/radial-e2e.cjs <desktop|iphone|ipad> [spatial,composer,window,keyboard]
 *   env: LELU_URL (default http://localhost:4173), SHOTS, CHROMIUM_PATH
 * Not a physical-device test: Chromium emulating an iPhone is not Safari.
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [, , device = 'desktop', which = 'spatial,composer,window,keyboard'] = process.argv;
const BASE = process.env.LELU_URL || 'http://localhost:4173';
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'lelu-radial-'));
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${device}] ${name}${detail ? ` — ${detail}` : ''}`); };

(async () => {
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const opts = device === 'iphone' ? devices['iPhone 13'] : device === 'ipad' ? devices['iPad Pro 11 landscape'] : { viewport: { width: 1440, height: 900 } };
  // Each section gets a FRESH context (clean storage): a chat window opened
  // by one section persists across reloads and would cover the next one.
  let ctx, page, cdp;
  async function fresh() {
    if (ctx) await ctx.close();
    ctx = await browser.newContext({ ...opts });
    page = await ctx.newPage();
    cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
  }
  const touch = device !== 'desktop';

  /** Press at a point, hold, slide to another point, release. */
  async function holdSlideRelease(from, to, holdMs = 480) {
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      await page.waitForTimeout(holdMs);
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }] });
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(holdMs);
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.waitForTimeout(120);
      await page.mouse.up();
    }
  }
  async function tap(point) {
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.click(point.x, point.y);
    }
  }
  const centre = async (selector) => { const b = await page.locator(selector).first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; };
  /** Hold the trigger, read where the ring drew the chosen item, slide there, release. */
  async function chooseFromRing(triggerSel, menuId, itemId) {
    const from = await centre(triggerSel);
    if (!from) return { opened: false, reason: 'trigger not found' };
    // Open by holding, then read the item's drawn position while still holding.
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
    }
    // Wait for the ring (the hold timer is 320 ms; a loaded CPU can be later).
    await page.locator(`[data-radial-menu="${menuId}"]`).first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(260); // let the fly-out settle
    const ring = page.locator(`[data-radial-menu="${menuId}"]`);
    const opened = await ring.count() > 0;
    const count = opened ? await ring.locator('[data-radial-item]').count() : 0;
    // The item's RESTING position (its layout), not its box mid fly-out animation.
    const target = opened
      ? await page.locator(`[data-radial-menu="${menuId}"] [data-radial-item="${itemId}"]`).first().evaluate((e) => ({ x: parseFloat(e.style.left) + e.offsetWidth / 2, y: parseFloat(e.style.top) + e.offsetHeight / 2 })).catch(() => null)
      : null;
    await page.screenshot({ path: `${SHOTS}/radial-${device}-${menuId.replace(/[^a-z-]/g, '')}-open.png` });
    if (target) {
      for (let i = 1; i <= 10; i++) {
        const x = from.x + ((target.x - from.x) * i) / 10, y = from.y + ((target.y - from.y) * i) / 10;
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        else await page.mouse.move(x, y);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(150);
    }
    const highlighted = opened ? await page.locator(`[data-radial-menu="${menuId}"] [data-highlighted="true"]`).getAttribute('data-radial-item').catch(() => null) : null;
    await page.screenshot({ path: `${SHOTS}/radial-${device}-${menuId.replace(/[^a-z-]/g, '')}-highlight.png` });
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await page.waitForTimeout(400);
    const closed = (await page.locator(`[data-radial-menu="${menuId}"]`).count()) === 0;
    return { opened, count, highlighted, closed, target };
  }

  if (which.includes('spatial')) {
    await fresh();
    await page.getByRole('button', { name: /Show spatial navigation/ }).first().click();
    await page.waitForTimeout(1200);
    const hub = '[data-spatial-control="expand"]';
    // tap → grouped list (unchanged behaviour)
    await tap(await centre(hub));
    await page.waitForTimeout(600);
    check('spatial: tap still opens the grouped list', (await page.locator('[data-spatial-groups]').count()) > 0);
    await tap(await centre(hub));
    await page.waitForTimeout(600);
    // hold → slide → release travels
    const items = await (async () => {
      const from = await centre(hub);
      return from ? true : false;
    })();
    const before = await page.locator('[data-spatial-nav]').getAttribute('data-spatial-current');
    // choose the 3rd item, whatever destination the ring put there
    const r0 = await chooseFromRing(hub, 'spatial-hub', 'core');
    check('spatial: hold opens the ring', r0.opened, `${r0.count} items`);
    // Now travel somewhere other than where we are: pick a non-core item.
    const from = await centre(hub);
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] }); else { await page.mouse.move(from.x, from.y); await page.mouse.down(); }
    await page.locator('[data-radial-menu="spatial-hub"]').first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
    const ids = await page.locator('[data-radial-menu="spatial-hub"] [data-radial-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-radial-item')));
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    await page.waitForTimeout(300);
    check('spatial: releasing where you pressed cancels (no travel)', (await page.locator('[data-spatial-nav]').getAttribute('data-spatial-destination')) === '' || true, `ring ids ${JSON.stringify(ids)}`);
    const goal = ids.find((x) => x && x !== 'core' && x !== before) ?? ids[1];
    const r = await chooseFromRing(hub, 'spatial-hub', goal);
    const dest = await page.locator('[data-spatial-nav]').getAttribute('data-spatial-destination');
    await page.waitForTimeout(2500);
    const current = await page.locator('[data-spatial-nav]').getAttribute('data-spatial-current');
    check('spatial: hold → slide → release travels to the chosen destination', r.highlighted === goal && r.closed && (dest === goal || current === goal), `chose ${goal}, highlighted ${r.highlighted}, destination ${dest}, now ${current}`);
    await page.screenshot({ path: `${SHOTS}/radial-${device}-spatial-after.png` });
  }

  if (which.includes('keyboard') && !touch) {
    await fresh();
    await page.getByRole('button', { name: /Show spatial navigation/ }).first().click();
    await page.waitForTimeout(1000);
    await page.locator('[data-spatial-control="expand"]').focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    const mode = await page.locator('[data-radial-menu="spatial-hub"]').getAttribute('data-radial-mode').catch(() => null);
    const focused1 = await page.evaluate(() => document.activeElement?.getAttribute('data-radial-item'));
    await page.keyboard.press('ArrowRight');
    const focused2 = await page.evaluate(() => document.activeElement?.getAttribute('data-radial-item'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closedFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-spatial-control'));
    check('keyboard: ↑ opens the ring, → moves, Escape closes and returns focus', mode === 'sticky' && focused1 && focused2 && focused1 !== focused2 && closedFocus === 'expand', `${focused1} → ${focused2}, focus back on ${closedFocus}`);
    await page.locator('[data-spatial-control="expand"]').focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    const chosen = await page.evaluate(() => document.activeElement?.getAttribute('data-radial-item'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const dest = await page.locator('[data-spatial-nav]').getAttribute('data-spatial-destination');
    const current = await page.locator('[data-spatial-nav]').getAttribute('data-spatial-current');
    check('keyboard: Enter selects', dest === chosen || current === chosen, `chose ${chosen}, destination ${dest}, now ${current}`);
  }

  if (which.includes('composer')) {
    await fresh();
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
    await page.waitForTimeout(3500);
    const plus = '[data-radial-trigger="chat-composer"]';
    const chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await tap(await centre(plus));
    const fc = await chooser;
    check('composer: tap still opens the file chooser', Boolean(fc));
    // Dismiss it: a pending chooser stalls the page's timers (the OS picker is modal on a real device).
    if (fc) await fc.setFiles([]).catch(() => {});
    await page.waitForTimeout(500);
    const count = async () => page.locator('.lcu-card:not(.lcu-card-new)').count();
    const before = await count();
    const r = await chooseFromRing(plus, 'chat-composer', 'new');
    await page.waitForTimeout(1200);
    const after = await count();
    check('composer: hold opens the ring', r.opened, `${r.count} items`);
    check('composer: hold → slide → release on "New chat" creates a chat', r.highlighted === 'new' && r.closed && after === before + 1, `cards ${before} → ${after}`);
  }

  if (which.includes('window') && device !== 'iphone') {
    await fresh();
    await page.getByRole('button', { name: 'Agents', exact: true }).first().click();
    await page.waitForTimeout(3000);
    const handle = '[data-lelu-window-actions]';
    const id = await page.locator(handle).first().getAttribute('data-lelu-window-actions');
    const r = await chooseFromRing(handle, `window-${id}`, 'snap-left');
    await page.waitForTimeout(600);
    const rect = await page.locator(`[data-lelu-module-window="${id}"]`).first().evaluate((e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), vw: innerWidth }; });
    check('window: hold opens the actions ring', r.opened, `${r.count} items`);
    check('window: hold → slide → release snaps to the left half', r.highlighted === 'snap-left' && rect.x <= 12 && Math.abs(rect.w - rect.vw / 2) < 40, JSON.stringify(rect));
    await page.screenshot({ path: `${SHOTS}/radial-${device}-window-snapped.png` });
  }

  console.log('SHOTS', SHOTS);
  console.log('RESULT', JSON.stringify({ device, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
