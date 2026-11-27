#!/usr/bin/env node
/**
 * LÉLU live conversation — what a person would wait for with the worker on a
 * whole server (all cores), replayed from a real browser run.
 *
 *   node scripts/voice-latency-replay.cjs --run <run.json> --mode buffered|wav --label <name> --out <dir>
 *
 * In the browser runs the VoxCPM2 worker has only 2 of the container's 4
 * cores (the software-rendered browser needs the other 2). A person's browser
 * runs on their own phone, so a deployed worker has the whole machine. This
 * takes each turn's page-side timings from a real run (speech end -> first
 * TTS request) and replays that turn's first spoken piece through the real
 * app route (/api/voice/tts) against the worker as it is configured now:
 *
 *   buffered  stream + the page's own start rule (estimateSpeechSeconds,
 *             pcmStartReady: same constants), i.e. the current code;
 *   wav       one whole WAV per sentence, i.e. the code before this change.
 *
 * Projected first audio = (page: speech end -> TTS request) + (replay: request
 * -> first sound). Labelled a replay wherever it is reported.
 */
const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:4173";
const run = JSON.parse(fs.readFileSync(arg("run"), "utf8"));
const mode = arg("mode", "buffered");
const out = arg("out", ".");
fs.mkdirSync(out, { recursive: true });

// Same rule and constants as src/core/voice/elevenLabsTts.ts.
const estimateSpeechSeconds = (text) => Math.max(0.6, text.trim().length * 0.068);
function pcmStartReady({ producedSeconds, expectedSeconds, pace, complete }) {
  if (complete) return producedSeconds > 0;
  if (pace === null || !Number.isFinite(pace) || pace >= 1) return producedSeconds > 0;
  const expected = Math.max(expectedSeconds, producedSeconds);
  return producedSeconds >= expected * (1 - Math.max(0, pace)) + 0.3;
}

async function replay(text) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode === "buffered" ? { text, stream: true, buffered: true } : { text }),
  });
  const type = res.headers.get("content-type") ?? "";
  const streaming = res.headers.get("x-lelu-streaming");
  if (!/l16/i.test(type)) {
    const body = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    return { mode: "wav", streaming, startMs: ms, doneMs: ms, audioSeconds: +((body.length - 44) / 2 / 48000).toFixed(2), engine: res.headers.get("x-lelu-engine") };
  }
  const rate = Number(res.headers.get("x-lelu-sample-rate")) || 48000;
  const rtf = Number(res.headers.get("x-lelu-worker-rtf")) || null;
  const expected = estimateSpeechSeconds(text);
  const reader = res.body.getReader();
  let produced = 0;
  let firstAt = null;
  let startMs = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value || !value.length) continue;
    const now = Date.now();
    if (firstAt === null) firstAt = now;
    produced += value.length / 2 / rate;
    const since = (now - firstAt) / 1000;
    const pace = since >= 1 ? produced / since : rtf ? 1 / rtf : null;
    if (startMs === null && pcmStartReady({ producedSeconds: produced, expectedSeconds: expected, pace, complete: false })) startMs = now - t0;
  }
  const doneMs = Date.now() - t0;
  if (startMs === null) startMs = doneMs;
  return { mode: "buffered", streaming, firstChunkMs: firstAt - t0, startMs, doneMs, audioSeconds: +produced.toFixed(2), engine: res.headers.get("x-lelu-engine") };
}

(async () => {
  const tl = run.timeline;
  const trackAt = run.tracks.find((t) => t.kind === "audio")?.at ?? 0;
  const items = (run.scenario?.timeline ?? []).filter((i) => !/^(sil|noise|clicks|burst):/.test(i.item));
  const users = run.messages.filter((m) => m.role === "user");
  const rows = [];
  for (let i = 0; i < users.length; i += 1) {
    const next = users[i + 1]?.firstSeen ?? Infinity;
    const request = tl.find((e) => e.kind === "request" && /\/api\/voice\/tts/.test(e.url) && e.t >= users[i].firstSeen - 2 && e.t < next);
    if (!request || !items[i]) continue;
    const speechEnd = trackAt + items[i].at + items[i].seconds;
    const pageMs = Math.round((request.t - speechEnd) * 1000);
    const r = await replay(request.text);
    rows.push({ heard: users[i].text, firstPiece: request.text, pageSpeechEndToTtsRequestMs: pageMs, ...r, projectedSpeechEndToFirstAudioS: +((pageMs + r.startMs) / 1000).toFixed(2) });
    console.log(JSON.stringify(rows.at(-1)));
  }
  const file = path.join(out, `${arg("label", mode)}.json`);
  fs.writeFileSync(file, JSON.stringify({ source: arg("run"), mode, base: BASE, at: new Date().toISOString(), note: "replay: page timings from the real run, voice from the worker as configured now", rows }, null, 1));
})();
