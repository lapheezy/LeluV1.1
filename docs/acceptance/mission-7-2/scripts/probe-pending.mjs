import { chromium } from 'playwright';
import fs from 'fs';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const prompt = 'Find a maintained open-source library that could improve LÉLU typo-tolerant search. Compare candidates, inspect licenses, recommend the best fit.';
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3013/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
for (const label of ['Continue without an account','Continue as guest','Guest']) {
  const g = p.locator(`button:has-text("${label}")`).first();
  if (await g.count().catch(()=>0)) { await g.click({force:true}).catch(()=>{}); await p.waitForTimeout(2500); break; }
}
const box = p.locator('textarea[placeholder*="Message"]:visible, textarea:visible').first();
await box.fill(prompt); await p.waitForTimeout(400); await p.keyboard.press('Enter');
await p.waitForTimeout(70000);
const info = await p.evaluate(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const buttons = [...document.querySelectorAll('button')].filter(vis).map((el)=> (el.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const text = document.body.innerText;
  return {
    buttons: [...new Set(buttons)].slice(0,90),
    expanders: [...document.querySelectorAll('button[aria-expanded]')].map((el)=>({expanded: el.getAttribute('aria-expanded'), text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,90), visible: vis(el)})).slice(0,10),
    approvalLines: text.split('\n').map((l)=>l.trim()).filter((l)=>/approv|waiting|pending|repo\./i.test(l)).slice(0,16),
    hasCheck: text.includes('\u2713 Approve'),
  };
});
console.log(JSON.stringify(info,null,1));
await p.screenshot({ path: 'docs/acceptance/mission-7-2/shots/probe-pending.png' }).catch(()=>{});
await b.close();
