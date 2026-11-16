/**
 * ==========================================================
 * LÉLU — SCENE PERFORMANCE HARNESS
 *
 * The claim this mission is about ("the world renders at 0-2 fps and
 * drags the whole interface with it") could not be checked without a
 * number, and a number taken by eye is not a measurement. This is the
 * instrument: it drives the real page in a real Chromium, on the two
 * viewports that matter, and reports what the frame actually costs.
 *
 * It measures — for the world canvas:
 *   painted frames   how many frames the scene ACTUALLY drew in a fixed
 *                    window (0 means it is not consuming the budget)
 *   fps              the scene's own measured rate (AdaptiveQuality)
 *   draw calls       gl.info.render.calls
 *   triangles        gl.info.render.triangles
 *
 * and for the page as a whole:
 *   raf fps          compositor cadence from a probe loop beside the app,
 *                    with the worst gap — this is what a person feels
 *   main thread      TaskDuration / ScriptDuration / LayoutDuration from
 *                    CDP Performance metrics: GPU-independent, so it is
 *                    the honest measure in a container without one
 *   contexts         WebGL contexts created this session, and the canvas
 *                    sizes they belong to (two full-screen contexts is
 *                    the defect; the number says whether it still is)
 *   memory           JS heap and long tasks
 *
 * Usage:  dev server running on :3000, then
 *           node scripts/measure-scene-perf.mjs <url> <label>
 *         writes artifacts/perf/<label>.json and prints the table.
 *
 * It is an instrument, not a gate: it always exits 0 unless the page
 * never booted, so a run cannot be "fixed" by loosening it.
 * ==========================================================
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000";
const LABEL = process.argv[3] ?? "run";
const OUT = "artifacts/perf";

const PROFILES = [
  { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  {
    name: "mobile-390x844",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  },
];

/** Instruments a page before any application code runs. */
function initInstrumentation() {
  const gl = { created: 0, renderer: null, canvases: new Set() };
  window.__gl = gl;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
    const context = original.call(this, type, ...rest);
    if (context && /webgl/i.test(String(type))) {
      gl.created += 1;
      gl.canvases.add(this);
      if (!gl.renderer) {
        try {
          const ext = context.getExtension("WEBGL_debug_renderer_info");
          gl.renderer = ext ? String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
        } catch {
          /* a driver without the extension is not a failure */
        }
      }
    }
    return context;
  };

  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* not exposed everywhere */
  }
}

/** Reads the DOM state the harness needs, without trusting the app to say it. */
function readState() {
  const gl = window.__gl;
  const canvases = [...gl.canvases].map((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  return {
    stats: window.__leluRenderStats ?? null,
    contextsCreated: gl.created,
    canvases,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
}

/** Samples the scene and the compositor for `ms`. */
async function sampleWindow(ms) {
  const before = { ...(window.__leluRenderStats ?? {}) };
  const start = performance.now();
  let frames = 0;
  let worstGap = 0;
  let previous = start;
  let running = true;
  const probe = (now) => {
    frames += 1;
    worstGap = Math.max(worstGap, now - previous);
    previous = now;
    if (running) requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);

  const fpsSamples = [];
  while (performance.now() - start < ms) {
    const stats = window.__leluRenderStats;
    if (stats && typeof stats.fps === "number") fpsSamples.push(stats.fps);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  running = false;
  const elapsed = (performance.now() - start) / 1000;
  return {
    seconds: Number(elapsed.toFixed(2)),
    rafFps: Number((frames / elapsed).toFixed(1)),
    worstGapMs: Math.round(worstGap),
    paintedFrames: typeof before.frames === "number" ? (window.__leluRenderStats?.frames ?? 0) - before.frames : null,
    statsFps: fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : null,
    state: readState(),
  };
}

/** Main-thread time from the browser itself: GPU-independent. */
async function mainThread(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const pick = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    task: pick("TaskDuration"),
    script: pick("ScriptDuration"),
    layout: pick("LayoutDuration"),
    style: pick("RecalcStyleDuration"),
  };
}

function delta(after, before) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, Number((after[key] - before[key]).toFixed(3))]));
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile ?? false,
    hasTouch: profile.hasTouch ?? false,
    deviceScaleFactor: profile.deviceScaleFactor ?? 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));

  await page.addInitScript(initInstrumentation);

  const bootAt = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const booted = await page
    .waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, { timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  const bootMs = Date.now() - bootAt;

  // The real first-run choice, never a test shortcut.
  await page
    .evaluate(() => {
      const gate = document.querySelector("[data-lelu-signin-gate]");
      const button = gate && [...gate.querySelectorAll("button")].find((b) => /Continue/.test(b.innerText));
      button?.click();
    })
    .catch(() => {});
  await page.waitForTimeout(5000);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  // HOME: the Cosmos is the screen.
  const homeThreadBefore = await mainThread(cdp);
  const home = await page.evaluate(sampleWindow, 4000);
  const homeThread = delta(await mainThread(cdp), homeThreadBefore);

  // CHAT: the conversation takes priority over the world.
  await page
    .evaluate(() => {
      const target =
        document.querySelector('[aria-label="LÉLU"]') ??
        document.querySelector("[data-lelu-dock] button");
      target?.click();
      const composer = document.querySelector("[data-lelu-composer] textarea, [data-lelu-composer] input");
      if (!composer) {
        const chat = [...document.querySelectorAll("button")].find((b) => /^(Chat|chat)$/.test(b.innerText.trim()));
        chat?.click();
      }
    })
    .catch(() => {});
  const chatOpened = await page
    .waitForSelector("[data-lelu-composer] textarea, [data-lelu-composer] input", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(2500);

  const chatThreadBefore = await mainThread(cdp);
  const chat = await page.evaluate(sampleWindow, 4000);
  const chatThread = delta(await mainThread(cdp), chatThreadBefore);

  const longTasks = await page.evaluate(() => [...(window.__longTasks ?? [])]);
  const result = {
    profile: profile.name,
    booted,
    bootMs,
    chatOpened,
    home: { ...home, thread: homeThread },
    chat: { ...chat, thread: chatThread },
    longTasks: { count: longTasks.length, blockedMs: longTasks.reduce((sum, ms) => sum + ms, 0) },
    consoleErrors: consoleErrors.slice(0, 8),
  };

  await context.close();
  return result;
}

function render(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`\n=== ${result.profile} ===`);
    lines.push(`  boot                ${result.booted ? `${result.bootMs}ms to first paint of #root` : "DID NOT BOOT"}`);
    lines.push(`  interactive chat    ${result.chatOpened ? "opened" : "never opened"}`);
    for (const phase of ["home", "chat"]) {
      const window = result[phase];
      const state = window.state;
      const stats = state.stats ?? {};
      const painted = window.paintedFrames;
      const perSecond = painted === null ? "n/a" : (painted / window.seconds).toFixed(1);
      lines.push(
        `\n  ${phase.toUpperCase()}` +
          `\n    world painted     ${painted === null ? "n/a" : `${painted} frames (${perSecond}/s)`}` +
          `\n    world fps         ${window.statsFps ?? "n/a"}` +
          `\n    draw calls        ${stats.calls ?? "n/a"}` +
          `\n    triangles         ${stats.triangles ?? "n/a"}` +
          `\n    dpr / buffer      ${stats.dpr ?? "n/a"} / ${(stats.buffer ?? []).join("x") || "n/a"}` +
          `\n    raf fps           ${window.rafFps}  (worst gap ${window.worstGapMs}ms)` +
          `\n    main thread       task ${window.thread.task}s  script ${window.thread.script}s` +
          `  layout ${window.thread.layout}s  style ${window.thread.style}s` +
          `\n    contexts          ${state.contextsCreated} created` +
          `\n    canvas sizes      ${state.canvases.map((c) => `${c.width}x${c.height}`).join(", ") || "none"}` +
          `\n    js heap           ${state.heap ?? "n/a"}MB`,
      );
    }
    lines.push(
      `\n  long tasks          ${result.longTasks.count} tasks, ${result.longTasks.blockedMs}ms blocked` +
        (result.consoleErrors.length ? `\n  console errors      ${result.consoleErrors.join(" | ")}` : ""),
    );
  }
  return lines.join("\n");
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const results = [];
let fatal = null;
for (const profile of PROFILES) {
  try {
    results.push(await runProfile(browser, profile));
  } catch (error) {
    fatal = fatal ?? String(error);
    results.push({ profile: profile.name, booted: false, bootMs: -1, error: String(error) });
  }
}
await browser.close();

console.log(render(results));
mkdirSync(OUT, { recursive: true });
const file = `${OUT}/${LABEL}.json`;
writeFileSync(file, JSON.stringify({ label: LABEL, base: BASE, at: new Date().toISOString(), results }, null, 2));
console.log(`\nwritten: ${file}`);

if (fatal && results.every((r) => !r.booted)) {
  console.error(`\nThe page never booted: ${fatal}`);
  process.exit(1);
}
