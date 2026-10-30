import { createRequire } from "node:module";
const { chromium } = createRequire("/home/user/LeluV1.1/package.json")("playwright");
const OUT = process.argv[2];
const targets = { app: "http://127.0.0.1:5173/", hers: "http://127.0.0.1:5401/" };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const report = {};
for (const [name, url] of Object.entries(targets)) {
  report[name] = [];
  for (let load = 1; load <= 3; load += 1) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 12; i += 1) {
      await page.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((x) => x.textContent.trim() === "Continue"); if (b) b.click(); });
      await page.waitForTimeout(500);
    }
    await page.evaluate(async () => {
      const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
      Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "independent check", initiatedBy: "user" });
    });
    const samples = [];
    for (let t = 0; t < 12; t += 1) {
      await page.waitForTimeout(1500);
      samples.push(await page.evaluate(() => {
        const companion = document.querySelector("[data-testid=lelu-companion]");
        const fig = document.querySelector("[data-testid=lelu-companion-figure]");
        const r = fig?.getBoundingClientRect();
        const controls = [...document.querySelectorAll("button, [role=button], a[href], input, textarea")].filter((el) => {
          if (companion && companion.contains(el)) return false;
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && getComputedStyle(el).visibility !== "hidden";
        });
        const coveredByHer = [];
        for (const el of controls) {
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          if (hit && companion && companion.contains(hit)) coveredByHer.push(el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) || el.tagName);
        }
        return { figure: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, coveredByHer };
      }));
    }
    await page.screenshot({ path: `${OUT}/${name}-load${load}.png`, timeout: 180000 });
    report[name].push(samples);
    await context.close();
    console.log(name, load, JSON.stringify(samples.map((s) => [s.figure?.join(","), s.coveredByHer.join("|")])));
  }
}
await browser.close();
const { writeFileSync } = await import("node:fs");
writeFileSync(`${OUT}/measure.json`, JSON.stringify(report, null, 2));
