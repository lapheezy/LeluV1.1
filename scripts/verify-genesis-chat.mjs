import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

page.on('pageerror', (error) => {
  pageErrors.push(error.message);
});

await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button', { state: 'visible', timeout: 15000 });
await page.getByRole('button', { name: /open chat/i }).click();
await page.waitForSelector('text=Send pulse', { timeout: 30000 });
await page.locator('input[placeholder="Speak with Lélu..."]').fill('Say hello in one short sentence.');
await page.getByRole('button', { name: /send pulse/i }).click();
await page.waitForSelector('text=Assistant status: Connected', { timeout: 60000 });
const responseVisible = await page.locator('text=/hello/i').first().isVisible().catch(() => false);

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('button', { state: 'visible', timeout: 15000 });
await page.getByRole('button', { name: /open chat/i }).click();
await page.waitForSelector('text=Send pulse', { timeout: 30000 });
await page.locator('input[placeholder="Speak with Lélu..."]').fill('Say hello in one short sentence.');
await page.getByRole('button', { name: /send pulse/i }).click();
await page.waitForSelector('text=Assistant status: Connected', { timeout: 60000 });
const mobileResponseVisible = await page.locator('text=/hello/i').first().isVisible().catch(() => false);

console.log(JSON.stringify({
  responseVisible,
  mobileResponseVisible,
  consoleErrors,
  pageErrors,
}, null, 2));

await browser.close();
