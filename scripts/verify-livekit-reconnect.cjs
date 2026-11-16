/**
 * LÉLU — LiveKit voice reconnection, in a headless browser (iPhone 13 profile).
 * NOT A REAL-DEVICE TEST: the microphone is a WAV file.
 *
 *   node scripts/verify-livekit-reconnect.cjs MIC.wav OUT_DIR
 *   env: LIVEKIT_RESTART_CMD (stops and restarts OUR livekit-server)
 *
 * Passes only if: the session is connected and listening → the server is
 * killed → the page OBSERVES the loss (state leaves "connected") → it comes
 * back to "connected" with the agent listening, by itself → a question asked
 * AFTER recovery is transcribed and answered (MIC.wav holds it late).
 */
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const [micWav, outDir] = process.argv.slice(2);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(micWav)}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["microphone"] });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timeline = [];
  const log = (kind, detail = {}) => {
    timeline.push({ t: Date.now() - t0, kind, ...detail });
    console.log(String(Date.now() - t0).padStart(7), kind, JSON.stringify(detail).slice(0, 220));
  };
  await page.exposeFunction("__lk", (kind, detail) => log(kind, detail));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break;
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForFunction(async () => { try { await import("/src/core/cognition/UIActionBus.ts"); return true; } catch { return false; } }, null, { timeout: 240000 });
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "user" });
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const engine = VoiceEngine.getInstance();
    window.__connections = [];
    engine.onLivekitStatus((s) => { if (s) { window.__connections.push(s.connection); window.__lk("livekit", { connection: s.connection, listening: s.agentListening, rejoins: s.rejoins, error: s.error }); } });
    engine.onUtterance((u) => window.__lk("utterance", { text: String(u) }));
    engine.onTurn((turn) => turn?.response && window.__lk("reply", { text: String(turn.response).slice(0, 200) }));
  });
  await page.waitForSelector('button[aria-label="Talk to LÉLU"]', { timeout: 240000 });
  await page.tap('button[aria-label="Talk to LÉLU"]');
  const listening = (timeout) => page.waitForFunction(() => { const s = document.querySelector('[data-testid="lk-status"]'); return s?.dataset.connection === "connected" && s?.dataset.listening === "1"; }, null, { timeout });
  await listening(60000);
  log("listening-before");

  log("kill-livekit-server");
  const killedAt = Date.now();
  execSync(process.env.LIVEKIT_RESTART_CMD, { stdio: "inherit" });
  // The loss must be OBSERVED, not assumed.
  await page.waitForFunction(() => (window.__connections ?? []).some((c) => c === "reconnecting" || c === "rejoining" || c === "disconnected"), null, { timeout: 60000 });
  log("loss-observed", { connections: await page.evaluate(() => window.__connections) });
  await listening(180000);
  const recoveredMs = Date.now() - killedAt;
  log("recovered", { recoveredMs });

  // A question asked after recovery must still be heard and answered.
  await page.waitForFunction(() => document.querySelector('[data-testid="lk-status"]')?.dataset.phase === "processing" || false, null, { timeout: 240000 });
  log("post-recovery-utterance-processing");
  await page.waitForFunction(() => document.querySelector('[data-testid="lk-status"]')?.dataset.phase === "listening", null, { timeout: 300000 });
  const report = { realDevice: false, recoveredMs, connections: await page.evaluate(() => window.__connections), timeline };
  report.pass = timeline.some((e) => e.kind === "utterance" && e.t > killedAt - t0) && timeline.some((e) => e.kind === "reply" && e.t > killedAt - t0);
  log("result", { pass: report.pass });
  await page.tap('[data-testid="lk-end"]').catch(() => {});
  fs.writeFileSync(path.join(outDir, "reconnect-report.json"), JSON.stringify(report, null, 1));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
})().catch((error) => {
  console.error("reconnect test failed:", error);
  process.exit(1);
});
