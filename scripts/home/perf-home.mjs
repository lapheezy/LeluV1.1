/** Mission 15 — Home runtime cost, production builds, iPhone profile, 4× CPU throttle.
 *  node scripts/home/perf-home.mjs <label>=<url> [...]  */
import { launch } from "../evolution/harness.mjs";
import { devices } from "playwright";
const targets = process.argv.slice(2).map((a) => a.split("="));
const b = await launch();
const out = {};
for (const [label, url] of targets) {
  const runs = [];
  for (let r = 0; r < Number(process.env.RUNS ?? 3); r++) {
    const ctx = await b.newContext({ ...devices["iPhone 15 Pro"] });
    await ctx.addInitScript(() => localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"));
    const p = await ctx.newPage();
    const c = await ctx.newCDPSession(p);
    await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await c.send("Performance.enable");
    const t0 = Date.now();
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForSelector("[data-lelu-home]", { timeout: 120000 });
    const home = Date.now() - t0;
    await p.waitForTimeout(3000);
    const m = Object.fromEntries((await c.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const dom = await p.$$eval("[data-lelu-home] *", (e) => e.length);
    // Re-render cost of the Home itself: toggle it away and back (immersive) and time the frame.
    const remount = await p.evaluate(async () => {
      const btn = document.querySelector('[data-lelu-home] .lch-cosmos');
      btn.click(); await new Promise((r) => setTimeout(r, 300));
      const t = performance.now();
      document.querySelector('.lsn-orb')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
      document.querySelector('.lsn-orb')?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 }));
      for (let i = 0; i < 200 && !document.querySelector("[data-lelu-home]"); i++) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t);
    });
    runs.push({ homeVisibleMs: home, domNodes: dom, jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), layoutMs: Math.round(m.LayoutDuration * 1000), recalcStyleMs: Math.round(m.RecalcStyleDuration * 1000), scriptMs: Math.round(m.ScriptDuration * 1000), homeRemountMs: remount });
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  out[label] = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, med(k)]));
  console.log(label, JSON.stringify(out[label]));
}
await b.close();
