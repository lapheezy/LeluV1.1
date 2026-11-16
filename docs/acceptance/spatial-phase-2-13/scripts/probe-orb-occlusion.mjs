import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ["--no-sandbox","--headless=new","--enable-unsafe-swiftshader","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => { [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").toLowerCase().includes("continue without an account"))?.click(); });
await page.waitForTimeout(2000);
console.log(JSON.stringify(await page.evaluate(() => {
  const orb = document.querySelector(".lsn-orb");
  const r = orb.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  return document.elementsFromPoint(cx, cy).slice(0, 5).map(el => ({ tag: el.tagName, cls: el.className, id: el.id, attrs: [...el.attributes].filter(a => a.name.startsWith("data-")).map(a => `${a.name}=${a.value}`), pe: getComputedStyle(el).pointerEvents, z: getComputedStyle(el).zIndex, html: el.outerHTML.slice(0, 160) }));
}), null, 1));
await browser.close();
