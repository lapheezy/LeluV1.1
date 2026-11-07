/**
 * Mission 10 — live voice conversation through the REAL app.
 *
 *   node scripts/verify-voice-e2e.cjs <mic.wav> <outDir> [durationSeconds]
 *
 * Chromium's microphone is a WAV file of real speech (synthesised by
 * ElevenLabs in a different voice from hers). Nothing is mocked:
 * VoiceEngine records the utterance, ElevenLabs Scribe transcribes it,
 * AIService.chat (the existing cognition) answers through the configured
 * provider chain, ElevenLabs speaks the reply and the page plays it.
 *
 * Writes <outDir>/voice-e2e.json: an event timeline (engine phases,
 * utterances, turns, network calls with timings), the usage ledger
 * events, and derived latencies. Needs the dev server (LELU_BASE).
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [micWav, outDir, durationArg] = process.argv.slice(2);
const duration = Number(durationArg ?? 140) * 1000;

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${path.resolve(micWav)}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timeline = [];
  const log = (kind, detail) => timeline.push({ t: Date.now() - t0, kind, ...detail });
  page.on("console", (m) => { if (/VoiceEngine|elevenlabs|ElevenLabs|Whisper/i.test(m.text())) log("console", { text: m.text().slice(0, 240) }); });
  page.on("pageerror", (e) => log("pageerror", { text: String(e).slice(0, 240) }));
  const pending = new Map();
  page.on("request", (r) => {
    const u = r.url();
    if (/\/api\/voice\/(stt|tts)|\/api\/model\//.test(u)) { pending.set(r, Date.now()); log("request", { url: u.replace(BASE, "/").slice(0, 80) }); }
  });
  page.on("requestfinished", async (r) => {
    if (!pending.has(r)) return;
    const resp = await r.response();
    log("response", { url: r.url().replace(BASE, "/").slice(0, 80), status: resp?.status(), ms: Date.now() - pending.get(r), usage: resp?.headers()["x-lelu-usage"] });
  });
  await page.exposeFunction("__leluLog", (kind, detail) => log(kind, detail));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { state: "attached", timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    [...(gate?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click();
  });
  await page.waitForTimeout(4000);

  await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const engine = VoiceEngine.getInstance();
    engine.onStateChange((s) => window.__leluLog("state", { phase: s.phase, active: s.active, error: s.error }));
    engine.onUtterance((u) => window.__leluLog("utterance", { text: typeof u === "string" ? u : JSON.stringify(u).slice(0, 200) }));
    engine.onTurn((turn) => window.__leluLog("turn", { user: turn.user, response: turn.response ? String(turn.response).slice(0, 300) : null }));
    engine.onError((e) => window.__leluLog("engine-error", { error: JSON.stringify(e).slice(0, 240) }));
    await engine.toggle();
    // Speaking boundaries from the audio element itself.
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      this.addEventListener("playing", () => window.__leluLog("audio-playing", { src: String(this.currentSrc).slice(0, 30) }), { once: true });
      this.addEventListener("ended", () => window.__leluLog("audio-ended", {}), { once: true });
      return origPlay.apply(this, args);
    };
  });
  log("voice-started", {});
  await page.waitForTimeout(duration);

  const finals = await page.evaluate(async () => {
    const { default: VoiceEngine } = await import("/src/core/voice/VoiceEngine.ts");
    const engine = VoiceEngine.getInstance();
    const ledger = JSON.parse(localStorage.getItem("lelu.usage.v1") || "{}");
    const last = engine.getLastTranscription?.() ?? null;
    if (engine.getState().active) await engine.toggle();
    return { state: engine.getState(), lastTranscription: last, bargeIns: engine.getBargeInCount(), events: ledger.events ?? [] };
  });
  log("voice-stopped", {});
  await page.screenshot({ path: path.join(outDir, "voice-e2e-desktop.png") });
  const report = { base: BASE, micWav: path.basename(micWav), ranAt: new Date().toISOString(), timeline, ...finals };
  fs.writeFileSync(path.join(outDir, "voice-e2e.json"), JSON.stringify(report, null, 1) + "\n");
  for (const e of timeline.filter((x) => x.kind !== "console" || /fail|error|budget/i.test(x.text))) console.log(String(e.t).padStart(6), e.kind, JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["t", "kind"].includes(k)))).slice(0, 220));
  console.log("ledger:", finals.events.map((e) => `${e.kind}:${e.source}:${e.operation ?? ""}:${e.ok ? "ok" : "fail"}:${e.inputTokens ?? "-"}/${e.outputTokens ?? "-"}:${e.results ?? ""}:${e.costKind}`).join(" | "));
  await browser.close();
})();
