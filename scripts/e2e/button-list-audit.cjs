/**
 * LÉLU — BUTTON-LIST AUDIT (M23 WP03/WP04)
 *
 * Opens each major environment and finds every "basic button list": a
 * container holding 4+ visible sibling buttons laid out in a row or grid.
 * Reports where it is, how many buttons, their labels, whether it wraps or
 * overflows, and how small its touch targets are. Read-only: it changes
 * nothing. The findings drive which lists become contextual controls.
 *
 *   node scripts/e2e/button-list-audit.cjs [desktop|iphone] > audit.json
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.LELU_URL || 'http://localhost:4173';
const [, , device = 'iphone'] = process.argv;
const ENVIRONMENTS = [
  ['Home', null],
  ['Chat Universe', 'Chat'],
  ['Browser', 'Browser'],
  ['Studio', 'Studio'],
  ['Workspaces', 'Workspaces'],
  ['Agents', 'Agents'],
  ['Files', 'Files'],
  ['Spatial bar', 'SPATIAL'],
  ['Settings', 'Settings'],
];
(async () => {
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const b = await chromium.launch(executablePath ? { executablePath } : {});
  const out = [];
  for (const [name, opener] of ENVIRONMENTS) {
    const ctx = await b.newContext(device === 'iphone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(6500);
    try {
      if (opener === 'SPATIAL') await p.getByRole('button', { name: /Show spatial navigation/ }).first().click();
      else if (opener) await p.getByRole('button', { name: opener, exact: true }).first().click();
      await p.waitForTimeout(3000);
    } catch (e) { out.push({ environment: name, error: `could not open: ${String(e.message).slice(0, 80)}` }); await ctx.close(); continue; }
    const lists = await p.evaluate(() => {
      const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
      const seen = new Set(); const found = [];
      for (const parent of document.querySelectorAll('*')) {
        if (seen.has(parent)) continue;
        const kids = [...parent.children].filter((c) => (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button' || (c.tagName === 'A' && c.getAttribute('href'))) && visible(c));
        if (kids.length < 4) continue;
        seen.add(parent);
        const rects = kids.map((k) => k.getBoundingClientRect());
        const rows = new Set(rects.map((r) => Math.round(r.top / 8))).size;
        const minTarget = Math.round(Math.min(...rects.map((r) => Math.min(r.width, r.height))));
        const pr = parent.getBoundingClientRect();
        const cs = getComputedStyle(parent);
        const label = (k) => (k.getAttribute('aria-label') || k.innerText || k.title || '').trim().replace(/\s+/g, ' ').slice(0, 22);
        const path = []; let n = parent; while (n && n !== document.body && path.length < 3) { path.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : '') + (n.getAttribute('aria-label') ? `[aria-label="${n.getAttribute('aria-label').slice(0, 20)}"]` : '')); n = n.parentElement; }
        found.push({
          where: path.join(' > '),
          buttons: kids.length,
          rows,
          overflowsX: parent.scrollWidth > parent.clientWidth + 2 && /(auto|scroll|hidden)/.test(cs.overflowX),
          minTargetPx: minTarget,
          box: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
          labels: kids.slice(0, 10).map(label),
        });
      }
      return found;
    });
    out.push({ environment: name, lists });
    await ctx.close();
  }
  console.log(JSON.stringify({ device, environments: out }, null, 1));
  await b.close();
})();
