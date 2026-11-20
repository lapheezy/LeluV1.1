/**
 * M22.8 browser acceptance harness — 20 consecutive spoken turns.
 *
 * Runs LÉLU in a real Chromium against the real server. The microphone is
 * SIMULATED: Chromium's `--use-file-for-fake-audio-capture` reads a WAV of
 * twenty questions (MISSION-22.8/scripts/build-fake-mic.py). There is no
 * physical microphone or speaker in this container, so this run measures
 * the SOFTWARE pipeline and says so; hardware acceptance stays blocked.
 *
 * Recorded, timestamped, from the page's own events:
 *   · each ASR response (the transcript that starts a turn)
 *   · each /api/voice/tts request (what she asked the speaker to say)
 *   · each HTMLMediaElement play / pause / ended (what actually played)
 *   · window.__leluVoice (the engine's diagnostics and per-turn latency)
 *   · console lines from VoiceEngine (VAD turn logs, fallbacks)
 *
 * Usage: node MISSION-22.8/scripts/voice-latency-acceptance.mjs [maxSeconds] [turns]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "MISSION-22.8");
const LIBS = join(ROOT, ".browser-libs/extract/usr/lib/x86_64-linux-gnu");
const MIC_WAV = process.env.LELU_MIC_WAV || join(ROOT, ".piper/fake-mic-20.wav");
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const MAX_SECONDS = Number(process.argv[2] || 300);
const TARGET_TURNS = Number(process.argv[3] || 20);

mkdirSync(join(OUT, "logs"), { recursive: true });
mkdirSync(join(OUT, "screenshots"), { recursive: true });
mkdirSync(join(OUT, "audio"), { recursive: true });

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

const at = () => Date.now();
const timeline = [];
const consoleLines = [];
page.on("console", (message) => {
  const text = message.text();
  if (/VoiceEngine|transcri|barge|interrupt|tts|speech|stale/i.test(text)) {
    consoleLines.push({ t: at(), level: message.type(), text: text.slice(0, 600) });
  }
});
page.on("pageerror", (error) => timeline.push({ t: at(), kind: "pageerror", text: error.message }));

await page.addInitScript(() => {
  window.__leluAsr = [];
  window.__leluTts = [];
  window.__leluMedia = [];

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url || "";
    const init = args[1] || {};
    const started = Date.now();
    if (url.includes("/api/voice/tts") && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body);
        if (parsed.text) window.__leluTts.push({ t: started, text: String(parsed.text).slice(0, 600) });
      } catch { /* not JSON */ }
    }
    const response = await originalFetch(...args);
    if (url.includes("/api/voice/stt") || url.includes("audio/transcriptions") || url.includes("/api/voice/stt")) {
      if (response.ok) {
        try {
          const data = await response.clone().json();
          if (data?.text) window.__leluAsr.push({ t: started, done: Date.now(), text: String(data.text).slice(0, 400) });
        } catch { /* not JSON */ }
      }
    }
    if (url.includes("/api/voice/tts")) {
      if (response.ok) {
        const ms = response.headers.get("x-lelu-synthesis-ms");
        const provider = response.headers.get("x-lelu-voice-provider");
        window.__leluTts[window.__leluTts.length - 1] = {
          ...(window.__leluTts[window.__leluTts.length - 1] || {}),
          status: response.status,
          synthesisMs: ms ? Number(ms) : null,
          provider,
        };
      } else {
        window.__leluTts[window.__leluTts.length - 1] = {
          ...(window.__leluTts[window.__leluTts.length - 1] || {}),
          status: response.status,
        };
      }
    }
    return response;
  };

  // Incremental speech is scheduled on an AudioContext, not an <audio>
  // element, so its buffers are recorded here: the first start() of a turn
  // IS the moment the user first hears her.
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    const originalCreate = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function (...args) {
      const source = originalCreate.apply(this, args);
      const originalStart = source.start.bind(source);
      source.start = (when, ...rest) => {
        const duration = source.buffer ? source.buffer.duration : 0;
        window.__leluMedia.push({ t: Date.now(), event: "play", src: "pcm", duration });
        // A PCM buffer's natural end is the only proof it played to the end.
        source.onended = () => window.__leluMedia.push({ t: Date.now(), event: "ended", src: "pcm" });
        return originalStart(when, ...rest);
      };
      const originalStop = source.stop.bind(source);
      source.stop = (...stopArgs) => {
        window.__leluMedia.push({ t: Date.now(), event: "pause", src: "pcm" });
        return originalStop(...stopArgs);
      };
      return source;
    };
  }

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const src = this.currentSrc || this.src || "";
    window.__leluMedia.push({ t: Date.now(), event: "play", src: src.slice(0, 60) });
    this.addEventListener("ended", () => window.__leluMedia.push({ t: Date.now(), event: "ended", src: src.slice(0, 60) }), { once: true });
    this.addEventListener("pause", () => window.__leluMedia.push({ t: Date.now(), event: "pause", src: src.slice(0, 60) }));
    return originalPlay.apply(this, args);
  };
});

const t0 = at();
timeline.push({ t: t0, kind: "harness", text: `run started; simulated microphone ${MIC_WAV}; target ${TARGET_TURNS} turns` });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(9000);
await page.click('button[aria-label*="open chat"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "screenshots", "01-before-voice.png") });

await page.click('button[aria-label="Talk to LÉLU"]');
timeline.push({ t: at(), kind: "harness", text: "voice session started" });

let lastAsr = 0;
let lastShot = 0;
const snapshots = [];
while (at() - t0 < MAX_SECONDS * 1000) {
  await page.waitForTimeout(1500);
  const snap = await page.evaluate(() => ({
    asr: (window.__leluAsr || []).length,
    tts: (window.__leluTts || []).length,
    media: (window.__leluMedia || []).length,
    voice: window.__leluVoice || null,
  }));
  snapshots.push({ t: at(), ...snap });
  if (snap.asr !== lastAsr) {
    lastAsr = snap.asr;
    timeline.push({ t: at(), kind: "turn", text: `transcript ${snap.asr}` });
    if (snap.asr === 1 && lastShot < 1) {
      lastShot = 1;
      await page.screenshot({ path: join(OUT, "screenshots", "02-first-turn.png") });
    }
    if (snap.asr === 10 && lastShot < 2) {
      lastShot = 2;
      await page.screenshot({ path: join(OUT, "screenshots", "03-tenth-turn.png") });
    }
    if (snap.asr === TARGET_TURNS) break;
  }
}

await page.screenshot({ path: join(OUT, "screenshots", "04-final-turn.png") });
// End the session with the same control that started it.
await page.click('button[aria-label="Talk to LÉLU"]');
timeline.push({ t: at(), kind: "harness", text: "voice session ended" });
await page.waitForTimeout(1500);

const collected = await page.evaluate(() => ({
  asr: window.__leluAsr || [],
  tts: window.__leluTts || [],
  media: window.__leluMedia || [],
  voice: window.__leluVoice || null,
}));

/* ---------------- per-turn measurements ---------------- */
const turns = [];
for (let index = 0; index < collected.asr.length; index += 1) {
  const asr = collected.asr[index];
  const nextAsrAt = collected.asr[index + 1]?.t ?? Number.POSITIVE_INFINITY;
  const tts = collected.tts.filter((entry) => entry.t >= asr.done && entry.t < nextAsrAt);
  const firstTts = tts[0] ?? null;
  const play = collected.media.find((entry) => entry.event === "play" && entry.t >= asr.done && entry.t < nextAsrAt) ?? null;
  const paused = collected.media.filter((entry) => entry.event === "pause" && entry.t >= asr.done && entry.t < nextAsrAt).length;
  turns.push({
    index: index + 1,
    transcript: asr.text,
    asrMs: asr.done - asr.t,
    transcriptToFirstTtsMs: firstTts ? firstTts.t - asr.done : null,
    transcriptToFirstAudioMs: play ? play.t - asr.done : null,
    sentencesSpoken: tts.length,
    synthesisMs: firstTts?.synthesisMs ?? null,
    provider: firstTts?.provider ?? null,
    pausedDuringTurn: paused,
  });
}

function stats(values) {
  const usable = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (usable.length === 0) return { count: 0, median: null, p90: null, max: null, min: null };
  const sorted = [...usable].sort((a, b) => a - b);
  const at = (quantile) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * (sorted.length - 1)))];
  return {
    count: usable.length,
    min: sorted[0],
    median: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
  };
}

const summary = {
  ranAt: new Date().toISOString(),
  url: URL,
  simulatedMicrophone: MIC_WAV,
  physicalMicrophone: false,
  physicalSpeaker: false,
  durationSeconds: Math.round((at() - t0) / 1000),
  turnsRequested: TARGET_TURNS,
  turnsMeasured: turns.length,
  playbackTransport: "pcm16 via AudioContext (incremental); blob via HTMLAudioElement (fallback)",
  latency: {
    asr: stats(turns.map((turn) => turn.asrMs)),
    transcriptToFirstTts: stats(turns.map((turn) => turn.transcriptToFirstTtsMs)),
    transcriptToFirstAudio: stats(turns.map((turn) => turn.transcriptToFirstAudioMs)),
  },
  playback: {
    plays: collected.media.filter((entry) => entry.event === "play").length,
    ended: collected.media.filter((entry) => entry.event === "ended").length,
    pauses: collected.media.filter((entry) => entry.event === "pause").length,
    sentencesSpoken: collected.tts.length,
  },
  diagnostics: collected.voice?.diagnostics ?? null,
  turnLatency: collected.voice?.turnLatency ?? null,
  turns,
  // Every play/pause/ended event, so buffer gaps can be measured after the run.
  media: collected.media,
  timeline,
  console: consoleLines.slice(-200),
};

const logName = process.env.LELU_RUN_LABEL ? `${process.env.LELU_RUN_LABEL}.json` : "latency-acceptance.json";
summary.runLabel = logName.replace(/\.json$/, "");
writeFileSync(join(OUT, "logs", logName), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      turnsMeasured: summary.turnsMeasured,
      durationSeconds: summary.durationSeconds,
      latency: summary.latency,
      playback: summary.playback,
      staleStreamsDropped: summary.diagnostics?.staleStreamsDropped ?? null,
      bargeIns: summary.diagnostics?.bargeIns ?? null,
      firstAudioLatencyMs: summary.diagnostics?.firstAudioLatencyMs ?? null,
    },
    null,
    2,
  ),
);
await browser.close();
