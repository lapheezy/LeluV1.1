#!/usr/bin/env node
/**
 * LÉLU live conversation — VoxCPM2 latency bench.
 *
 * Measures what decides how soon she is heard on a CPU: synthesis time per
 * text length and per diffusion-step count (inference_timesteps), and whether
 * fewer steps keep the words intelligible (each clip round-trips through the
 * same Groq Whisper the app transcribes with; word accuracy is reported).
 *
 * Usage: node scripts/voice-live-latency-bench.cjs --worker http://127.0.0.1:8788 --out <dir> [--steps 10,6,4]
 * Needs GROQ_API_KEY in the environment for the intelligibility check (never printed).
 */
const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const worker = arg("worker", "http://127.0.0.1:8788");
const out = arg("out", "docs/missions/live-voice-evidence/latency-bench");
const steps = arg("steps", "10,6,4").split(",").map(Number);
fs.mkdirSync(out, { recursive: true });

const texts = [
  { id: "clause", text: "Sure, I can help with that." },
  { id: "sentence", text: "The ocean covers about seventy percent of the planet, and most of it is still unexplored." },
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
function wordAccuracy(ref, hyp) {
  const a = norm(ref);
  const b = norm(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return Math.max(0, 1 - d[a.length][b.length] / a.length);
}

async function transcribe(file) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "en");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) return `HTTP ${res.status}`;
  return (await res.json()).text?.trim() ?? "";
}

(async () => {
  const rows = [];
  for (const n of steps) {
    for (const t of texts) {
      // A unique trailing space-free variant would defeat the worker's
      // identical-text cache only if the text changed; the cache key includes
      // the step count, so each (text, steps) pair is generated for real once.
      const started = Date.now();
      const res = await fetch(`${worker}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: t.text, response_format: "wav", inference_timesteps: n }),
      });
      const wall = Date.now() - started;
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(out, `steps${n}-${t.id}.wav`);
      fs.writeFileSync(file, buf);
      const heard = await transcribe(file).catch((e) => `error ${e.message}`);
      const row = {
        steps: n,
        text: t.id,
        chars: t.text.length,
        status: res.status,
        cached: res.headers.get("x-lelu-cached"),
        wallMs: wall,
        synthesisMs: Number(res.headers.get("x-lelu-synthesis-ms")),
        audioSeconds: Number(res.headers.get("x-lelu-audio-seconds")),
        rtf: Number(res.headers.get("x-lelu-rtf")),
        heard,
        wordAccuracy: typeof heard === "string" ? +wordAccuracy(t.text, heard).toFixed(3) : null,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  fs.writeFileSync(path.join(out, "bench.json"), JSON.stringify({ worker, at: new Date().toISOString(), rows }, null, 1));
})();
