/**
 * M23.0 — WP04: 100 consecutive spoken turns, every turn accounted for.
 *
 * Runs LÉLU in a real Chromium against the real server, with a SIMULATED
 * microphone (`--use-file-for-fake-audio-capture`, built by
 * build-fake-mic-100.py). No physical device exists in this container, so
 * this measures the SOFTWARE pipeline and says so.
 *
 * What it adds over the M22.9 harness: the engine now keeps a per-turn ledger
 * (window.__leluVoice.turns). Every transcript appears there with the reason
 * it did or did not end in speech, so a silent turn is a CLASSIFIED event
 * rather than an absence. The run fails loudly if any turn is left unexplained.
 *
 * Recorded per turn: transcript, TTS requests, player events, and the ledger
 * outcome. Recorded for the run: latencies, holding lines spoken, failures.
 *
 * Usage:
 *   node MISSION-23.0/scripts/silent-turn-regression.mjs [maxSeconds] [turns]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "MISSION-23.0");
const LIBS = join(ROOT, ".browser-libs/extract/usr/lib/x86_64-linux-gnu");
const MIC_WAV = process.env.LELU_MIC_WAV || join(ROOT, ".piper/fake-mic-100.wav");
const URL = process.env.LELU_URL || "http://127.0.0.1:4180/";
const MAX_SECONDS = Number(process.argv[2] || 1800);
const TARGET_TURNS = Number(process.argv[3] || 100);
const LABEL = process.env.LELU_RUN_LABEL || "m23.0-100-turn";

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

const at = () => Date.now();
const timeline = [];
const consoleLines = [];

page.on("console", (message) => {
  const text = message.text();
  if (/VoiceEngine|transcri|barge|interrupt|tts|speech|stale|notice|holding/i.test(text)) {
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
      } catch {
        /* not JSON */
      }
    }
    const response = await originalFetch(...args);
    if (url.includes("/api/voice/stt") || url.includes("audio/transcriptions")) {
      if (response.ok) {
        try {
          const data = await response.clone().json();
          if (data?.text) window.__leluAsr.push({ t: started, done: Date.now(), text: String(data.text).slice(0, 400) });
        } catch {
          /* not JSON */
        }
      }
    }
    if (url.includes("/api/voice/tts")) {
      const last = window.__leluTts[window.__leluTts.length - 1] || {};
      const ms = response.headers.get("x-lelu-synthesis-ms");
      window.__leluTts[window.__leluTts.length - 1] = {
        ...last,
        status: response.status,
        synthesisMs: ms ? Number(ms) : null,
        provider: response.headers.get("x-lelu-voice-provider"),
      };
    }
    return response;
  };

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    const originalCreate = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function (...args) {
      const source = originalCreate.apply(this, args);
      const originalStart = source.start.bind(source);
      source.start = (when, ...rest) => {
        window.__leluMedia.push({ t: Date.now(), event: "play", src: "pcm", duration: source.buffer ? source.buffer.duration : 0 });
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
timeline.push({ t: t0, kind: "harness", text: `run started; SIMULATED mic ${MIC_WAV}; target ${TARGET_TURNS} turns` });

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(9000);
await page.click('button[aria-label*="open chat"]');
await page.waitForTimeout(2500);
await page.click('button[aria-label="Talk to LÉLU"]');
timeline.push({ t: at(), kind: "harness", text: "voice session started" });

let lastAsr = 0;
const progress = [];
while (at() - t0 < MAX_SECONDS * 1000) {
  await page.waitForTimeout(1500);
  const snap = await page.evaluate(() => ({
    asr: (window.__leluAsr || []).length,
    tts: (window.__leluTts || []).length,
    outcome: window.__leluVoice?.diagnostics?.speechOutcome ?? null,
  }));
  if (snap.asr !== lastAsr) {
    lastAsr = snap.asr;
    timeline.push({ t: at(), kind: "turn", text: `transcript ${snap.asr}` });
    progress.push({ t: at(), asr: snap.asr, spoken: snap.outcome?.spoken ?? null, silent: snap.outcome?.silent ?? null, unexplained: snap.outcome?.unexplained ?? null });
    if (snap.asr % 25 === 0) {
      await page.screenshot({ path: join(OUT, "screenshots", `turn-${String(snap.asr).padStart(3, "0")}.png`) });
    }
    if (snap.asr >= TARGET_TURNS) break;
  }
}

await page.screenshot({ path: join(OUT, "screenshots", "run-final.png") });
await page.click('button[aria-label="Talk to LÉLU"]');
timeline.push({ t: at(), kind: "harness", text: "voice session ended" });
await page.waitForTimeout(2000);

const collected = await page.evaluate(() => ({
  asr: window.__leluAsr || [],
  tts: window.__leluTts || [],
  media: window.__leluMedia || [],
  voice: window.__leluVoice || null,
}));

/* ---------------- per-turn join ---------------- */
const ledger = collected.voice?.turns ?? [];
const outcomes = collected.voice?.diagnostics?.speechOutcome ?? null;

const turns = [];
for (let index = 0; index < collected.asr.length; index += 1) {
  const asr = collected.asr[index];
  const nextAsrAt = collected.asr[index + 1]?.t ?? Number.POSITIVE_INFINITY;
  const tts = collected.tts.filter((entry) => entry.t >= asr.done && entry.t < nextAsrAt);
  const first = tts[0] ?? null;
  // The ledger entry for this transcript: matched by text, nearest in time.
  const entry = ledger.find((item) => item.text.trim() === asr.text.trim() && item.at <= asr.done + 15_000) ?? null;
  turns.push({
    index: index + 1,
    transcript: asr.text.trim(),
    asrMs: asr.done - asr.t,
    ttsRequests: tts.length,
    transcriptToFirstTtsMs: first ? first.t - asr.done : null,
    synthesisMs: first?.synthesisMs ?? null,
    provider: first?.provider ?? null,
    outcome: entry?.outcome ?? null,
    outcomeKnown: Boolean(entry),
  });
}

const spokenTexts = collected.tts.map((entry) => entry.text);
const holdingLines = spokenTexts.filter((text) => /model providers right now|took too long on my side|lost the network while I was answering|couldn't make out that audio|don't have a good answer to that one/i.test(text));

const summary = {
  ranAt: new Date().toISOString(),
  runLabel: LABEL,
  url: URL,
  simulatedMicrophone: MIC_WAV,
  physicalMicrophone: false,
  physicalSpeaker: false,
  durationSeconds: Math.round((at() - t0) / 1000),
  turnsRequested: TARGET_TURNS,
  transcriptsMeasured: turns.length,
  ledgerEntries: ledger.length,
  outcomeSummary: outcomes,
  holdingLinesSpoken: holdingLines.length,
  holdingLineTexts: [...new Set(holdingLines)],
  playback: {
    plays: collected.media.filter((entry) => entry.event === "play").length,
    ended: collected.media.filter((entry) => entry.event === "ended").length,
    pauses: collected.media.filter((entry) => entry.event === "pause").length,
  },
  silentTurns: turns.filter((turn) => turn.ttsRequests === 0).map((turn) => ({
    index: turn.index,
    transcript: turn.transcript,
    outcome: turn.outcome,
  })),
  turns,
  progress,
  timeline,
  console: consoleLines,
};

writeFileSync(join(OUT, "logs", `${LABEL}.json`), JSON.stringify(summary, null, 2));

const unexplained = turns.filter((turn) => turn.ttsRequests === 0 && !turn.outcome).length;
console.log(JSON.stringify({
  runLabel: LABEL,
  durationSeconds: summary.durationSeconds,
  transcripts: turns.length,
  ledger: ledger.length,
  spoken: outcomes?.spoken ?? null,
  silent: outcomes?.silent ?? null,
  unexplainedLedger: outcomes?.unexplained ?? null,
  unexplainedTurns: unexplained,
  byOutcome: outcomes?.byOutcome ?? null,
  holdingLines: holdingLines.length,
  plays: summary.playback.plays,
}, null, 2));

await browser.close();
// Zero unexplained silences is the acceptance criterion, not a nice-to-have.
process.exit(unexplained === 0 ? 0 : 1);
