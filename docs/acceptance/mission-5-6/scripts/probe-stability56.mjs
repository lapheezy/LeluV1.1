/*
 * MISSION 5.6 — renderer stability + mobile viewport evidence.
 *
 * Two questions, measured rather than assumed:
 *
 *   1. Does the renderer survive a long, interactive session, and how do its
 *      heap / node / listener counts grow while it does?
 *   2. Do the established mobile viewports render the Cosmos with a live
 *      composer and no duplicate surfaces?
 *
 * No model request is needed or made: this is a renderer/layout measurement,
 * so it is labelled as such and never counted as autonomy evidence.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? '3013';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUTDIR ?? 'docs/acceptance/mission-5-6';
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const LONG_MS = Number(process.env.LONG_MS ?? 240_000);
const VIEWPORTS = (process.env.VIEWPORTS ?? '360x640,375x812,390x844,430x932')
  .split(',')
  .map((v) => v.split('x').map(Number));

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const rec = { mission: '5.6', at: new Date().toISOString(), viewports: [], long: null, crashes: [], pageErrors: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'renderer-stability.json'), JSON.stringify(rec, null, 2));

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const DOM = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const text = document.body.innerText;
  let storage = [];
  try { storage = Object.keys(localStorage).filter(k => /environment|workspace|lelu|kv/i.test(k)); } catch {}
  return {
    windows: q('[data-lelu-module-window]'),
    contents: [...document.querySelectorAll('[data-lelu-module-content]')].length,
    canvases: q('canvas'),
    elements: document.querySelectorAll('*').length,
    textLen: text.length,
    composer: q('textarea'),
    blank: text.trim().length < 40,
    hasCosmos: Boolean(document.querySelector('.lch-cosmos, [data-lelu-cosmos]')),
    storage,
    tail: text.split('\\n').map(l => l.trim()).filter(Boolean).slice(-6),
  };
})()`;

const enter = async (page) => {
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
  if (!(await page.locator('textarea').count())) {
    const pill = page.locator('button:has-text("Chat")').first();
    if (await pill.count()) {
      await pill.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
};

try {
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      reducedMotion: 'reduce',
      hasTouch: w < 500,
      isMobile: w < 500,
    });
    const page = await ctx.newPage();
    const errors = [];
    const crashes = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
    page.on('crash', () => crashes.push(Date.now()));
    let entry;
    try {
      await enter(page);
      entry = { viewport: `${w}x${h}`, dom: await page.evaluate(DOM), errors, crashes };
      // Portal/cosmos interaction: the surface must survive a navigation tap.
      const cosmos = page.locator('button.lch-cosmos').first();
      if (await cosmos.count()) {
        await cosmos.click().catch(() => {});
        await page.waitForTimeout(1500);
      }
      entry.afterTap = await page.evaluate(DOM);
      await page.screenshot({ path: path.join(OUT, 'shots', `viewport-${w}x${h}.png`) }).catch(() => {});
      // A fresh load legitimately has ZERO module windows: the Cosmos opens
      // surfaces only once an environment exists. The criteria that actually
      // describe "rendered and usable" are: not blank, a live composer.
      entry.result = entry.dom.blank || entry.dom.composer === 0 ? 'FAIL' : 'PASS';
    } catch (e) {
      entry = { viewport: `${w}x${h}`, result: 'ERROR', error: String(e.message || e).slice(0, 300), errors, crashes };
    }
    rec.viewports.push(entry);
    save();
    console.log(`viewport ${w}x${h}: ${entry.result} windows=${entry.dom?.windows} composer=${entry.dom?.composer}`);
    await ctx.close().catch(() => {});
  }

  // Long interactive session on one page: what Mission 5.5 saw die at ~3 min.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  page.on('crash', () => rec.crashes.push({ at: Date.now(), during: 'long' }));
  const metrics = async (label) => {
    try {
      const { metrics: m } = await cdp.send('Performance.getMetrics');
      const p = (n) => m.find((x) => x.name === n)?.value ?? null;
      return {
        label,
        t: Date.now(),
        heapMB: p('JSHeapUsedSize') ? +(p('JSHeapUsedSize') / 1048576).toFixed(1) : null,
        nodes: p('Nodes'),
        listeners: p('JSEventListeners'),
        layouts: p('LayoutCount'),
      };
    } catch (e) {
      return { label, t: Date.now(), error: String(e.message || e).slice(0, 120) };
    }
  };

  const long = { samples: [], errors, started: Date.now(), endSamples: [] };
  try {
    await enter(page);
    long.samples.push(await metrics('entered'));
    const pills = ['Chat', 'Studio', 'Files'];
    const end = Date.now() + LONG_MS;
    let i = 0;
    while (Date.now() < end) {
      i += 1;
      const pill = page.locator(`button:has-text("${pills[i % pills.length]}")`).first();
      if (await pill.count()) await pill.click({ force: true }).catch(() => {});
      const cosmos = page.locator('button.lch-cosmos').first();
      if (i % 4 === 0 && (await cosmos.count())) await cosmos.click().catch(() => {});
      await page.mouse.wheel(0, 220).catch(() => {});
      await page.waitForTimeout(6000);
      const sample = await metrics(`i${i}`);
      long.samples.push(sample);
      save();
      if (i % 10 === 0) {
        long.endSamples.push({ i, dom: await page.evaluate(DOM) });
        await page.screenshot({ path: path.join(OUT, 'shots', `long-${i}.png`) }).catch(() => {});
      }
    }
    long.survivedMs = Date.now() - long.started;
    long.finalDom = await page.evaluate(DOM);
    long.result = 'SURVIVED';
  } catch (e) {
    long.result = 'ENDED';
    long.error = String(e.message || e).slice(0, 300);
    long.survivedMs = Date.now() - long.started;
  }
  rec.long = long;
  save();
  const first = long.samples[0] ?? {};
  const last = long.samples.at(-1) ?? {};
  console.log(
    JSON.stringify(
      {
        long: long.result,
        survivedMs: long.survivedMs,
        samples: long.samples.length,
        heapMB: [first.heapMB, last.heapMB],
        nodes: [first.nodes, last.nodes],
        listeners: [first.listeners, last.listeners],
        crashes: rec.crashes,
        pageErrors: errors.slice(-3),
      },
      null,
      1,
    ),
  );
  await ctx.close().catch(() => {});
} catch (e) {
  rec.error = String(e.message || e).slice(0, 400);
  save();
  console.log('ERROR', rec.error);
} finally {
  await browser.close().catch(() => {});
  rec.finishedAt = new Date().toISOString();
  save();
}
