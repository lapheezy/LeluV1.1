/**
 * M22.7 live voice acceptance harness.
 *
 * Runs LÉLU in a real Chromium against the real server, with Chromium's
 * fake audio device fed by a real WAV file (SIMULATED microphone input —
 * there is no physical microphone in this container; the report says so).
 *
 * What it records, all timestamped:
 *  - VoiceEngine turn diagnostics and transcript/chat requests
 *  - every /api/voice/tts response, saved byte-for-byte as a WAV
 *  - HTMLMediaElement play/ended events (playback actually started)
 *  - screenshots at each phase
 *
 * Usage: node MISSION-22.7/scripts/voice-acceptance.mjs [seconds]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "MISSION-22.7");
const LIBS = join(ROOT, ".browser-libs/extract/usr/lib/x86_64-linux-gnu");
const MIC_WAV = join(ROOT, ".piper/fake-mic-5.wav");
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const RUN_SECONDS = Number(process.argv[2] || 75);

mkdirSync(join(OUT, "audio"), { recursive: true });
mkdirSync(join(OUT, "logs"), { recursive: true });
mkdirSync(join(OUT, "screenshots"), { recursive: true });

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${MIC_WAV}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
  env: { ...process.env, LD_LIBRARY_PATH: LIBS },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const timeline = [];
const at = () => new Date().toISOString();
page.on("console", (m) => {
  const text = m.text();
  if (/VoiceEngine|transcri|barge|interrupt|tts|speech|Voice\b/i.test(text)) {
    timeline.push({ at: at(), kind: "console", level: m.type(), text: text.slice(0, 500) });
  }
});
page.on("pageerror", (e) => timeline.push({ at: at(), kind: "pageerror", text: e.message }));

await page.addInitScript(() => {
  window.__leluAudio = [];
  window.__leluPlay = [];
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const src = this.currentSrc || this.src || "";
    window.__leluPlay.push({ t: Date.now(), event: "play", src: src.slice(0, 80) });
    this.addEventListener("ended", () => window.__leluPlay.push({ t: Date.now(), event: "ended", src: src.slice(0, 80) }), { once: true });
    this.addEventListener("pause", () => window.__leluPlay.push({ t: Date.now(), event: "pause", src: src.slice(0, 80) }));
    return origPlay.apply(this, args);
  };
  window.__leluTurns = [];
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url || "";
    const started = Date.now();
    const init = args[1] || {};
    // The transcript reaches the model as the last user message; the spoken
    // reply reaches TTS as {"text"}. Record both without touching the app.
    try {
      if (url.includes("/api/voice/tts") && typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        if (parsed.text) window.__leluTurns.push({ t: started, kind: "spoken", text: String(parsed.text).slice(0, 800) });
      }
    } catch { /* non-JSON body: ignore */ }
    const res = await origFetch(...args);
    // The recogniser's own answer is the transcript evidence.
    if (url.includes("audio/transcriptions") && res.ok) {
      try {
        const data = await res.clone().json();
        if (data?.text) window.__leluTurns.push({ t: started, kind: "asr", text: String(data.text).slice(0, 500) });
      } catch { /* non-JSON: ignore */ }
    }
    if (url.includes("/api/voice/tts") && res.ok) {
      try {
        const buf = await res.clone().arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        window.__leluAudio.push({ t: started, status: res.status, provider: res.headers.get("x-lelu-voice-provider"), ms: res.headers.get("x-lelu-synthesis-ms"), b64: btoa(binary) });
      } catch (error) {
        window.__leluAudio.push({ t: started, error: String(error) });
      }
    }
    if (/chat\/completions|audio\/transcriptions|voice\/tts/.test(url)) {
      window.__leluRequests = window.__leluRequests || [];
      window.__leluRequests.push({ t: started, url: url.replace(location.origin, ""), status: res.status });
    }
    return res;
  };
});

const t0 = Date.now();
timeline.push({ at: at(), kind: "harness", text: `run started (${RUN_SECONDS}s)` });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);
await page.click('button[aria-label*="open chat"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "screenshots", "01-chat-before-voice.png") });

const micSelector = 'button[aria-label="Talk to LÉLU"]';
if (!(await page.$(micSelector))) throw new Error("voice control not found");
await page.click(micSelector);
timeline.push({ at: at(), kind: "harness", text: "voice session started (mic clicked)" });

const snapshots = [];
for (let elapsed = 0; elapsed < RUN_SECONDS; elapsed += 5) {
  await page.waitForTimeout(5000);
  const snap = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).filter((a) => a && /talk|stop|speak|voice|listen|interrupt/i.test(a)),
    audio: (window.__leluAudio || []).length,
    plays: (window.__leluPlay || []).length,
    turns: (window.__leluTurns || []).length,
    requests: (window.__leluRequests || []).slice(-6),
  }));
  snapshots.push({ at: at(), elapsed: Math.round((Date.now() - t0) / 1000), ...snap });
  if (elapsed === 20) await page.screenshot({ path: join(OUT, "screenshots", "02-conversation.png") });
}

// Interruption: click the voice control while she is speaking/session active.
const labels = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).filter(Boolean),
);
timeline.push({ at: at(), kind: "harness", text: `controls before interrupt: ${JSON.stringify(labels.filter((l) => /talk|stop|speak|voice|listen/i.test(l)))}` });
const stopLabel = labels.find((l) => /stop|interrupt/i.test(l)) || null;
if (stopLabel) {
  await page.click(`button[aria-label="${stopLabel}"]`);
  timeline.push({ at: at(), kind: "harness", text: `clicked ${stopLabel}` });
} else {
  await page.click(micSelector);
  timeline.push({ at: at(), kind: "harness", text: "clicked the voice control to end the session (no separate stop control)" });
}
await page.waitForTimeout(2000);
await page.screenshot({ path: join(OUT, "screenshots", "03-after-interrupt.png") });

// Reopen a fresh session to prove repeated activation.
await page.click(micSelector);
timeline.push({ at: at(), kind: "harness", text: "second session started" });
await page.waitForTimeout(12000);
await page.screenshot({ path: join(OUT, "screenshots", "04-second-session.png") });
await page.click(micSelector);
timeline.push({ at: at(), kind: "harness", text: "second session ended" });

const collected = await page.evaluate(() => ({ audio: window.__leluAudio || [], plays: window.__leluPlay || [], requests: window.__leluRequests || [], turns: window.__leluTurns || [] }));
const audioFiles = [];
collected.audio.forEach((entry, index) => {
  if (!entry.b64) return;
  const file = join(OUT, "audio", `reply-${String(index + 1).padStart(2, "0")}.wav`);
  writeFileSync(file, Buffer.from(entry.b64, "base64"));
  audioFiles.push({ file, ms: entry.ms, provider: entry.provider });
});

const evidence = {
  ranAt: at(),
  url: URL,
  simulatedMicrophone: MIC_WAV,
  durationSeconds: Math.round((Date.now() - t0) / 1000),
  timeline,
  snapshots,
  turns: collected.turns,
  audioFiles,
  playback: collected.plays,
  requests: collected.requests,
};
writeFileSync(join(OUT, "logs", "voice-acceptance.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ turns: snapshots.length, audioFiles: audioFiles.length, playbackEvents: collected.plays.length, durationSeconds: evidence.durationSeconds }, null, 2));
await browser.close();
