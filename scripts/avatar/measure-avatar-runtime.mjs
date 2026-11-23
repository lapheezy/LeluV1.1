/**
 * M15.3 — LÉLU avatar runtime measurement (before/after harness).
 *
 * Drives the real app in Chromium through Home → Chat → Home → Browser →
 * Studio → Code → Her world (Gen V2) → Home, and on each screen records:
 *   - whether her companion is shown, its framing/form, and whether it is a
 *     live canvas or a frozen still;
 *   - her animation rate (frames her own canvas reports per second);
 *   - the page's rAF rate (main-thread responsiveness);
 *   - long tasks during the transition, and transition latency;
 *   - WebGL contexts created (cumulative) and live WebGL canvases;
 *   - texture bytes uploaded (cumulative, from texImage2D/texStorage2D);
 *   - JS heap (Chromium only).
 *
 * Chromium + SwiftShader (software GL) in a container: absolute fps is not a
 * device number; before/after on the same machine is the comparison.
 *
 *   node scripts/avatar/measure-avatar-runtime.mjs <label> [desktop|phone]
 * Output: docs/missions/m15-home/avatar-15.3/measure-<label>-<device>.json (+ pictures).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const label = process.argv[2] ?? "run";
const device = process.argv[3] ?? "desktop";
// A/B control: "--hide-avatar" takes her companion out of the page (CSS
// display:none) on the same build and route — what the screen costs without her.
const hideAvatar = process.argv.includes("--hide-avatar");
const OUT = "docs/missions/m15-home/avatar-15.3";
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
const VP = device === "phone" ? { width: 393, height: 852 } : { width: 1440, height: 900 };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"] });
const ctx = await b.newContext({ viewport: VP, hasTouch: device === "phone", isMobile: device === "phone" });
await ctx.addInitScript(() => {
  const w = window;
  w.__m = { contexts: 0, texBytes: 0, texCalls: 0, longTasks: [], rafTicks: 0 };
  const seen = new WeakSet();
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(String(type)) && !seen.has(c)) {
      seen.add(c); w.__m.contexts++; this.dataset.mWebgl = "1";
      // Who owns it: resolved a moment later, once the canvas is in the page.
      const canvas = this;
      setTimeout(() => {
        const owner = canvas.closest("[data-testid]")?.getAttribute("data-testid") ?? (canvas.isConnected ? "page-canvas" : "detached");
        (w.__m.ctxOwners ??= []).push(`${owner}@${canvas.width}x${canvas.height}`);
      }, 50);
    }
    return c;
  };
  const dims = (args) => {
    // texImage2D(target, level, internalformat, width, height, ...) or (target, level, internalformat, format, type, source)
    if (typeof args[3] === "number" && typeof args[4] === "number" && args.length >= 8) return args[3] * args[4];
    const src = args[args.length - 1];
    if (src && typeof src === "object" && "width" in src && "height" in src) return (src.width || 0) * (src.height || 0);
    return 0;
  };
  for (const C of [w.WebGLRenderingContext, w.WebGL2RenderingContext].filter(Boolean)) {
    const ti = C.prototype.texImage2D;
    C.prototype.texImage2D = function (...a) { const px = dims(a); w.__m.texBytes += px * 4; if (px) w.__m.texCalls++; return ti.apply(this, a); };
    if (C.prototype.texStorage2D) {
      const ts = C.prototype.texStorage2D;
      C.prototype.texStorage2D = function (...a) { w.__m.texBytes += (a[3] || 0) * (a[4] || 0) * 4; w.__m.texCalls++; return ts.apply(this, a); };
    }
  }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__m.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {}
  // Frame times (ms between rAF callbacks), for percentiles and dropped frames.
  w.__m.dts = [];
  let last = 0;
  const tick = (t) => { w.__m.rafTicks++; if (last) w.__m.dts.push(t - last); if (w.__m.dts.length > 4000) w.__m.dts.splice(0, 2000); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
// A/B control: "--no-companion" turns her off through her own setting (unmounted).
if (process.argv.includes("--no-companion")) await ctx.addInitScript(() => localStorage.setItem("lelu.lelu.companion.v1", JSON.stringify({ enabled: false, pinned: false, x: 0.1, y: 0.15, size: "medium", framing: "full", lastMovedBy: "lelu", updatedAt: 1, window: null })));
if (hideAvatar) await ctx.addInitScript(() => { const st = document.createElement("style"); st.textContent = '[data-testid="lelu-companion"]{display:none!important}'; (document.head || document.documentElement).appendChild(st); });
const p = await ctx.newPage();
const consoleErrors = [];
p.on("console", (m) => { if (m.type() === "error" && /lelu|avatar|three|webgl|context/i.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });

async function sample(ms = 3000) {
  const read = () => p.evaluate(() => {
    const c = document.querySelector('[data-testid="lelu-companion-character"]');
    const comp = document.querySelector('[data-testid="lelu-companion"]');
    const still = document.querySelector('[data-testid="lelu-companion-still"]');
    const live = [...document.querySelectorAll("canvas[data-m-webgl]")].filter((x) => x.isConnected);
    const world = document.querySelector("canvas[data-lelu-avatar-model]");
    return {
      t: performance.now(),
      raf: window.__m.rafTicks,
      frames: Number(c?.dataset.frames ?? 0),
      playing: c?.dataset.playing ?? "",
      renderer: c?.dataset.renderer ?? "none",
      framing: comp?.dataset.framing ?? "",
      form: comp?.dataset.form ?? c?.dataset.form ?? "",
      presence: comp?.dataset.presence ?? "absent",
      context: comp?.dataset.context ?? "",
      reason: comp?.dataset.presentationReason ?? "",
      visible: comp ? getComputedStyle(comp).visibility !== "hidden" && Number(getComputedStyle(comp).opacity) > 0.05 : false,
      still: Boolean(still),
      liveCanvases: live.length,
      liveCanvasSizes: live.map((x) => `${x.width}x${x.height}`),
      contexts: window.__m.contexts,
      ctxOwners: (window.__m.ctxOwners ?? []).slice(),
      texBytes: window.__m.texBytes,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      worldAvatar: Boolean(world),
      worldSpatial: world?.dataset.leluSpatial ? JSON.parse(world.dataset.leluSpatial) : null,
    };
  });
  await p.evaluate(() => { window.__m.dts = []; });
  const a = await read();
  await p.waitForTimeout(ms);
  const z = await read();
  const dts = await p.evaluate(() => window.__m.dts.slice());
  const sorted = dts.slice().sort((x, y) => x - y);
  const pct = (q) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1) : null);
  z.p50 = pct(0.5); z.p95 = pct(0.95); z.p99 = pct(0.99);
  // A frame longer than two 60 Hz intervals is a dropped frame.
  z.dropped = dts.filter((d) => d > 33.4).length; z.frames60 = dts.length;
  const s = (z.t - a.t) / 1000;
  return { ...z, pageFps: +((z.raf - a.raf) / s).toFixed(1), avatarFps: +((z.frames - a.frames) / s).toFixed(1) };
}

const results = [];
async function screen(name, action, ready) {
  const lt0 = await p.evaluate(() => window.__m.longTasks.length);
  const t0 = Date.now();
  await action();
  let latency = null;
  for (let i = 0; i < 100; i++) { if (await ready().catch(() => false)) { latency = Date.now() - t0; break; } await p.waitForTimeout(100); }
  // Settle: sample the screen, not the tail of the transition. Wait until no
  // long task has started for 1.5 s (at most 15 s), then sample.
  const settleStart = Date.now();
  for (;;) {
    const quiet = await p.evaluate(() => { const l = window.__m.longTasks; const lastEnd = l.length ? l[l.length - 1].at + l[l.length - 1].ms : 0; return performance.now() - lastEnd; });
    if (quiet > 1500 || Date.now() - settleStart > 15000) break;
    await p.waitForTimeout(250);
  }
  const settleMs = Date.now() - settleStart;
  const lts = await p.evaluate((n) => window.__m.longTasks.slice(n), lt0);
  const s = await sample(5000);
  const row = { screen: name, settleMs, latencyMs: latency, longTasks: lts.length, longTaskMs: lts.reduce((x, y) => x + y.ms, 0), worstLongTaskMs: Math.max(0, ...lts.map((x) => x.ms)), ...s };
  delete row.t; delete row.raf;
  results.push(row);
  await p.screenshot({ path: `${OUT}/${label}-${device}-${String(results.length).padStart(2, "0")}-${name}.png` });
  console.log(`${name.padEnd(14)} lat ${String(latency).padStart(5)}ms  page ${String(row.pageFps).padStart(5)}fps  avatar ${String(row.avatarFps).padStart(5)}fps  ${row.renderer}/${row.context || "-"}/${row.framing}/${row.form || "-"} vis=${row.visible} still=${row.still} ctx=${row.contexts} live=${row.liveCanvases} tex=${Math.round(row.texBytes / 1048576)}MB lt=${row.longTasks}/${row.longTaskMs}ms heap=${row.heap}MB ft p50/p95/p99 ${row.p50}/${row.p95}/${row.p99}ms dropped ${row.dropped}/${row.frames60}`);
}

const tap = async (sel) => { const l = p.locator(sel).first(); if (device === "phone") await l.tap(); else await l.click(); };
const openLibraryApp = async (name) => {
  await tap('button[aria-label="Open the app library"]');
  await p.waitForTimeout(700);
  await p.locator(".lsh-app", { hasText: new RegExp(`^${name}`) }).first().click();
};
const goHome = async () => {
  if (await p.getByRole("button", { name: "Close Chat Universe" }).isVisible().catch(() => false)) {
    await p.getByRole("button", { name: "Close Chat Universe" }).click();
    await p.waitForTimeout(800);
  }
  if (await atHome()) return;
  const home = p.locator('.lsn-item[aria-label="Home"]');
  if (await home.isVisible().catch(() => false)) return tap('.lsn-item[aria-label="Home"]');
  // A window owns the screen and the nav steps aside: the window's own way home.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  if (await home.isVisible().catch(() => false)) return tap('.lsn-item[aria-label="Home"]');
  await p.screenshot({ path: `${OUT}/${label}-${device}-debug-no-home.png` });
  // The window's own close (the workspace bar's ✕), never a browser tab's ×.
  const close = p.locator('.lws-icon[aria-label^="Close "]:visible, [data-lelu-module-window] button[aria-label^="Close "]:not([aria-label^="Close tab"]):visible, button[aria-label="Close window"]:visible').first();
  if (await close.count()) await close.click({ force: true });
  await p.waitForTimeout(600);
  if (!(await atHome()) && (await home.isVisible().catch(() => false))) await tap('.lsn-item[aria-label="Home"]');
};
const atHome = () => p.evaluate(() => Boolean(document.querySelector("[data-lelu-home]")));

const t0 = Date.now();
await p.goto(URL, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true" || (Boolean(document.querySelector("[data-lelu-home]")) && !document.querySelector('[data-testid="lelu-companion"]') && performance.now() > 15000)).catch(() => false)) break;
  await p.waitForTimeout(500);
}
const firstReadyMs = Date.now() - t0;
const save = (error) => fs.writeFileSync(`${OUT}/measure-${label}-${device}.json`, JSON.stringify({ label, device, viewport: VP, firstReadyMs, error: error ? String(error).slice(0, 300) : null, consoleErrors: consoleErrors.slice(0, 20), results, at: new Date().toISOString() }, null, 2));
process.on("unhandledRejection", (e) => { save(e); console.log("partial:", String(e).slice(0, 200)); process.exit(1); });
let failure = null;
try {
await screen("home", async () => {}, atHome);
await screen("chat", async () => p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe"))), () => p.getByRole("button", { name: "Close Chat Universe" }).isVisible());
await screen("home-2", goHome, atHome);
await screen("browser", () => openLibraryApp("Browser"), () => p.evaluate(() => document.body.dataset.genesisPanel === "browser" || Boolean(document.querySelector('[data-panel="browser"], [data-testid*="browser" i]'))));
await screen("home-3", goHome, atHome);
await screen("studio", () => openLibraryApp("Studio"), async () => !(await atHome()));
await screen("home-4", goHome, atHome);
await screen("code", () => openLibraryApp("Code"), async () => !(await atHome()));
await screen("home-5", goHome, atHome);
await screen("world", async () => { await tap('.lsn-item[aria-label="Worlds"]'); await p.waitForTimeout(600); await p.locator('[data-world="genesisv2"]').click(); }, () => p.evaluate(() => Boolean(document.querySelector("canvas[data-lelu-avatar-model]"))));
await screen("home-6", async () => { await tap('.lsn-item[aria-label="Worlds"]'); await p.waitForTimeout(600); await p.locator('[data-world="cosmos"]').click(); }, atHome);

} catch (e) {
  failure = e;
  console.log("partial:", String(e).split("\n")[0].slice(0, 200));
}
save(failure);
console.log(`firstReady ${firstReadyMs}ms; errors ${consoleErrors.length}`);
await b.close();
