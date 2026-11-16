/**
 * Mission 10 — screen awareness through the REAL app and the real
 * browser screen-capture API (getDisplayMedia).
 *
 *   node scripts/verify-screen-e2e.cjs <outDir>
 *
 * A second tab plays "the user's screen" (an inbox, then an error
 * dialog). LÉLU's page shares that tab through getDisplayMedia (Chromium
 * auto-selects it by title — the only automated stand-in for the user
 * picking it), and the questions go through the existing
 * AIService.chat(prompt, media) with ScreenShare's frames attached.
 * Nothing is mocked: the model that answers is whichever the provider
 * chain picks for an image (OpenRouter → its vision model here).
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [outDir] = process.argv.slice(2);
const TITLE = "LELU-SHARED-SCREEN";

const inbox = `<!doctype html><title>${TITLE}</title><body style="font:28px system-ui;background:#f4f6fb;padding:40px">
<h1>Mail — Inbox</h1><ul><li><b>Priya</b>: Quarterly report draft</li><li><b>Sam</b>: Lunch on Friday?</li><li><b>Billing</b>: Invoice #4471 paid</li></ul>
<p style="color:#555">3 unread messages</p></body>`;
const errorView = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center">
<div style="background:#fff;border:3px solid #c62828;border-radius:12px;padding:32px;width:640px;font:26px system-ui">
<h2 style="color:#c62828;margin:0 0 12px">Error 503 — Service Unavailable</h2>
<p>The payment service did not respond. Your card was <b>not</b> charged.</p><p>Retry in 30 seconds.</p>
<button style="font:24px system-ui;padding:8px 20px">Retry</button></div></div>`;

(async () => {
  // Headed (under xvfb-run): headless Chromium cannot start a capture source
  // ("NotReadableError: Could not start video source", observed).
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    headless: process.env.LELU_HEADED !== "1",
    // LELU_CAPTURE=desktop captures the whole (virtual) display instead of
    // selecting the tab by title; tab selection could not start a source here.
    // NOT --use-fake-ui-for-media-stream: with it every capture fails with
    // "NotReadableError: Could not start video source" (measured).
    args: ["--no-sandbox", "--enable-usermedia-screen-capturing",
      process.env.LELU_CAPTURE === "desktop" ? "--auto-select-desktop-capture-source=Entire screen" : `--auto-select-tab-capture-source-by-title=${TITLE}`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const target = await ctx.newPage();
  await target.setContent(inbox);
  const page = await ctx.newPage();
  const log = [];
  const t0 = Date.now();
  const note = (step, detail) => { log.push({ t: Date.now() - t0, step, ...detail }); console.log(String(Date.now() - t0).padStart(6), step, JSON.stringify(detail).slice(0, 300)); };
  page.on("pageerror", (e) => note("pageerror", { text: String(e).slice(0, 200) }));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    [...(gate?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click();
  });
  await page.waitForTimeout(3000);

  // A real user gesture starts sharing (getDisplayMedia requires one).
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "__share"; b.textContent = "share"; b.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
    b.onclick = async () => {
      const { default: ScreenShare } = await import("/src/core/perception/ScreenShare.ts");
      try { window.__shareResult = await ScreenShare.getInstance().start(); } catch (e) { window.__shareResult = { error: String(e) }; }
    };
    document.body.appendChild(b);
  });
  await page.click("#__share");
  // On a desktop capture the user's screen is whatever window is in front.
  if (process.env.LELU_CAPTURE === "desktop") await target.bringToFront();
  await page.waitForFunction(() => window.__shareResult, null, { timeout: 15000 });
  note("share-started", await page.evaluate(() => window.__shareResult));
  await page.waitForTimeout(2500);

  const ask = async (prompt) => page.evaluate(async (p) => {
    const { default: ScreenShare } = await import("/src/core/perception/ScreenShare.ts");
    const { default: AIService } = await import("/src/core/AIService.ts");
    const media = ScreenShare.getInstance().attachmentsFor(p);
    const t = performance.now();
    const r = await AIService.getInstance().chat(p, media);
    return { prompt: p, frames: media.map((m) => m.label), provider: r.provider, model: r.model, ms: Math.round(performance.now() - t), answer: r.text.slice(0, 600), stats: ScreenShare.getInstance().getStats() };
  }, prompt);

  note("ask-1", await ask("Look at my shared screen. In one or two sentences, what am I looking at?"));
  await target.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), errorView);
  await page.waitForTimeout(3000);
  note("ask-2", await ask("What changed on my screen just now, and what does the message mean for me?"));
  await page.screenshot({ path: path.join(outDir, "screen-share-lelu.png") });
  await target.screenshot({ path: path.join(outDir, "screen-share-target.png") });

  note("stop", await page.evaluate(async () => {
    const { default: ScreenShare } = await import("/src/core/perception/ScreenShare.ts");
    const s = ScreenShare.getInstance();
    const before = s.captureLive();
    s.stop();
    return { liveBeforeStop: before, liveAfterStop: s.captureLive(), active: s.isActive(), framesAfterStop: s.attachmentsFor("anything").length };
  }));
  const ledger = await page.evaluate(() => (JSON.parse(localStorage.getItem("lelu.usage.v1") || "{}").events ?? []).filter((e) => e.kind === "ai").map((e) => ({ source: e.source, model: e.model, ok: e.ok, in: e.inputTokens, out: e.outputTokens, cost: e.costKind, usd: e.costUsd })));
  note("ledger", { ai: ledger });
  fs.writeFileSync(path.join(outDir, "screen-e2e.json"), JSON.stringify({ ranAt: new Date().toISOString(), log }, null, 1) + "\n");
  await browser.close();
})();
