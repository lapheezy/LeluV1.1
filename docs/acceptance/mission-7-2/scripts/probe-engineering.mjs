import { chromium } from 'playwright';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const STATE = process.env.STATE;
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, ...(STATE ? { storageState: STATE } : {}) });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3013/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(6000);
for (const label of ['Continue without an account','Continue as guest','Guest']) {
  const g = p.locator(`button:has-text("${label}")`).first();
  if (await g.count().catch(()=>0)) { await g.click({force:true}).catch(()=>{}); await p.waitForTimeout(2500); break; }
}
const dump = async (tag) => {
  const d = await p.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const btns = [...document.querySelectorAll('button')].filter(vis).map((el)=> (el.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
    return { buttons: [...new Set(btns)].filter((t)=>/approv|reject|modify|engineering|waiting/i.test(t)).slice(0,30),
      hasApprove: /✓ Approve/.test(document.body.innerText) };
  });
  console.log(tag, JSON.stringify(d));
  return d;
};
await dump('initial:');
for (const label of ['Engineering']) {
  const btn = p.locator('button', { hasText: label }).first();
  if (await btn.count().catch(()=>0)) { await btn.click({ force: true }).catch(()=>{}); await p.waitForTimeout(3000); console.log('clicked', label); }
}
await dump('after-engineering:');
await p.screenshot({ path: 'docs/acceptance/mission-7-2/shots/engineering-panel.png' }).catch(()=>{});
await b.close();
