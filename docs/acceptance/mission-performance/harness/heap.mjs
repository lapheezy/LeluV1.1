import pw from "playwright"; const { chromium } = pw;
const URL = process.argv[2]; const marks = [10, 30, 60, 120, 180, 240];
const b = await chromium.launch({ executablePath: process.env.CHROME }); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send("HeapProfiler.enable"); const t0 = Date.now(); await page.goto(URL); const out = [];
for (const m of marks) {
  await page.waitForTimeout(Math.max(0, m * 1000 - (Date.now() - t0)));
  const raw = await cdp.send("Runtime.getHeapUsage");
  await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage");
  const gc = await cdp.send("Runtime.getHeapUsage");
  const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, canvases: document.querySelectorAll("canvas").length, listeners: 0, images: document.images.length }));
  const res = await page.evaluate(() => performance.getEntriesByType("resource").length);
  out.push({ t: m, rawMB: +(raw.usedSize / 1048576).toFixed(1), afterGcMB: +(gc.usedSize / 1048576).toFixed(1), totalMB: +(gc.totalSize / 1048576).toFixed(1), ...dom, resources: res });
}
console.log(JSON.stringify({ url: URL, samples: out })); await b.close();
