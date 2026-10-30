import { createRequire } from "node:module";
const { chromium } = createRequire("/home/user/LeluV1.1/package.json")("playwright");
const OUT = process.argv[2];
const targets = { app: "http://127.0.0.1:5173/", hers: "http://127.0.0.1:5401/" };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const out = {};
for (const [vpName, vp] of [["desktop-a",{ width: 1280, height: 800, mobile: false }],["desktop-b",{ width: 1280, height: 800, mobile: false }],["desktop-c",{ width: 1280, height: 800, mobile: false }]]) {
  for (const [name, url] of Object.entries(targets)) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 12; i += 1) {
      await page.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((x) => x.textContent.trim() === "Continue"); if (b) b.click(); });
      await page.waitForTimeout(500);
    }
    // In-page sampler: every animation frame for 8 s after the chat opens.
    const result = await page.evaluate(async () => {
      const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
      const sample = () => {
        const companion = document.querySelector("[data-testid=lelu-companion]");
        const covered = [];
        for (const el of document.querySelectorAll("button, [role=button], a[href], input, textarea")) {
          if (companion && companion.contains(el)) continue;
          const b = el.getBoundingClientRect();
          if (!(b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth)) continue;
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          if (hit && companion && companion.contains(hit)) covered.push(el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) || el.tagName);
        }
        return covered;
      };
      const t0 = performance.now();
      const beforeOpen = sample();
      Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "independent check", initiatedBy: "user" });
      const spans = [];
      let coveredMs = 0, last = t0, n = 0, worst = [];
      while (performance.now() - t0 < 8000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        const c = sample();
        n += 1;
        if (c.length) { coveredMs += now - last; if (c.length > worst.length) worst = c; spans.push(Math.round(now - t0)); }
        last = now;
      }
      return { beforeOpen, frames: n, coveredMs: Math.round(coveredMs), firstCovered: spans[0] ?? null, lastCovered: spans[spans.length - 1] ?? null, worst };
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${vpName}-${name}-chat.png`, timeout: 180000 });
    out[`${vpName}/${name}`] = result;
    console.log(vpName, name, JSON.stringify(result));
    await context.close();
  }
}
await browser.close();
(await import("node:fs")).writeFileSync(`${OUT}/timing-desktop.json`, JSON.stringify(out, null, 2));
