import { chromium } from 'playwright';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://127.0.0.1:3013/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
const dump = async (tag) => {
  const d = await p.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')].map((e) => (e.innerText || e.getAttribute('aria-label') || e.className).trim().slice(0, 60)).filter(Boolean).slice(0, 30),
    textareas: [...document.querySelectorAll('textarea, input[type="text"]')].map((e) => ({
      tag: e.tagName, ph: e.getAttribute('placeholder'), composer: e.hasAttribute('data-lelu-composer') || Boolean(e.closest('[data-lelu-composer]')),
    })).slice(0, 10),
    dialogs: [...document.querySelectorAll('[role="dialog"], [aria-label]')].map((e) => e.getAttribute('aria-label')).filter(Boolean).slice(0, 12),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
  }));
  console.log(tag, JSON.stringify(d, null, 1).slice(0, 2200));
};
await dump('initial:');
await p.locator('button.lch-cosmos').first().click().catch(() => {});
await p.waitForTimeout(3000);
await dump('after cosmos:');
for (const name of [/without/i, /guest/i, /skip/i, /explore/i, /enter/i, /continue/i]) {
  const btn = p.getByRole('button', { name }).first();
  if (await btn.count()) { await btn.click().catch(() => {}); await p.waitForTimeout(2500); await dump(`after click ${name}:`); break; }
}
await b.close();
