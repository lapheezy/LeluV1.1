#!/usr/bin/env node
/**
 * ==========================================================
 * HER VOICE, FROM THE CLIP IN THIS REPOSITORY
 *
 * `public/audio/voice/lelu-voice-reference.m4a` is the only voice asset
 * committed here, and until now nothing read it. This script turns it into
 * a speakable voice and points her identity at the result:
 *
 *   1. find an existing clone named "Lélu" (idempotent — safe to re-run)
 *   2. otherwise upload the clip to ElevenLabs as an instant clone
 *   3. write ELEVENLABS_VOICE_ID into .env.local, which
 *      src/core/voice/voiceIdentity.ts already honours
 *   4. synthesise one short line so the clone is proven to speak
 *
 * Instant voice cloning is a paid-plan feature (ElevenLabs Starter and up).
 * On the free tier the API answers HTTP 400 `paid_plan_required` and this
 * script says so instead of pretending the voice exists.
 *
 * No secret is ever printed: credentials are read from .env.local and only
 * the resulting voice id is shown.
 * ==========================================================
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const CLIP_PATH = path.join(ROOT, "public/audio/voice/lelu-voice-reference.m4a");
const CLONE_NAME = "L\u00e9lu";
const API = "https://api.elevenlabs.io/v1";
const MODEL = "eleven_v3";
const CHECK_LINE = "This is my voice now.";

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Every distinct ElevenLabs synthesis credential, in file order. */
function credentials(env) {
  const seen = new Set();
  const list = [];
  for (const [name, value] of Object.entries(env)) {
    if (!/^eleven/i.test(name) || /stt|model|voice_id/i.test(name)) continue;
    if (typeof value !== "string" || value.length < 8 || seen.has(value)) continue;
    seen.add(value);
    list.push({ name, key: value });
  }
  return list;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

async function findClone(key) {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) return null;
  const { voices = [] } = await readJson(res);
  return (
    voices.find((voice) => {
      const category = String(voice.category || "").toLowerCase();
      if (category !== "cloned" && category !== "professional") return false;
      return String(voice.name || "").toLowerCase().includes("lu");
    }) || null
  );
}

async function cloneFromClip(key) {
  const form = new FormData();
  form.append("name", CLONE_NAME);
  form.append(
    "description",
    "Cloned from public/audio/voice/lelu-voice-reference.m4a, the reference clip committed to this repository.",
  );
  form.append(
    "files",
    new Blob([fs.readFileSync(CLIP_PATH)], { type: "audio/mp4" }),
    "lelu-voice-reference.m4a",
  );
  const res = await fetch(`${API}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  return { status: res.status, body: await readJson(res) };
}

/** Point her identity at `voiceId`; leave every other line untouched. */
function writeVoiceId(voiceId) {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const at = lines.findIndex((line) => /^\s*ELEVENLABS_VOICE_ID\s*=/.test(line));
  const entry = `ELEVENLABS_VOICE_ID=${voiceId}`;
  if (at >= 0) lines[at] = entry;
  else lines.push(entry);
  fs.writeFileSync(ENV_PATH, lines.join("\n"));
}

/** Spend one short sentence to prove the clone actually speaks. */
async function proveItSpeaks(key, voiceId) {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: CHECK_LINE,
      model_id: MODEL,
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), bytes: bytes.byteLength };
}

async function main() {
  if (!fs.existsSync(CLIP_PATH)) {
    console.error(`Reference clip missing: ${path.relative(ROOT, CLIP_PATH)}`);
    return 2;
  }
  const accounts = credentials(readEnv());
  if (accounts.length === 0) {
    console.error("No ElevenLabs credential found in .env.local (expected Elevenlabs, Elevenlabs2, ...).");
    return 2;
  }
  console.log(`Reference clip: ${path.relative(ROOT, CLIP_PATH)} (${fs.statSync(CLIP_PATH).size} bytes)`);
  console.log(`ElevenLabs credentials: ${accounts.length}`);
  let planBlocked = 0;
  for (const { name, key } of accounts) {
    const existing = await findClone(key);
    if (existing) {
      writeVoiceId(existing.voice_id);
      console.log(`${name}: already cloned as "${existing.name}" → ${existing.voice_id}`);
      console.log(`Wrote ELEVENLABS_VOICE_ID=${existing.voice_id} to .env.local`);
      const check = await proveItSpeaks(key, existing.voice_id);
      console.log(`Synthesis check: HTTP ${check.status}, ${check.type}, ${check.bytes} bytes`);
      return check.status === 200 && check.bytes > 0 ? 0 : 1;
    }
    const { status, body } = await cloneFromClip(key);
    if (status === 200 && body && body.voice_id) {
      writeVoiceId(body.voice_id);
      console.log(`${name}: cloned from the clip → ${body.voice_id}`);
      console.log(`Wrote ELEVENLABS_VOICE_ID=${body.voice_id} to .env.local`);
      const check = await proveItSpeaks(key, body.voice_id);
      console.log(`Synthesis check: HTTP ${check.status}, ${check.type}, ${check.bytes} bytes`);
      console.log("Restart the dev server so vite re-reads .env.local, then she speaks in this voice.");
      return check.status === 200 && check.bytes > 0 ? 0 : 1;
    }
    const detail = (body && body.detail) || {};
    const code = detail.code || detail.status || `HTTP ${status}`;
    if (String(code).includes("instant_voice_cloning")) planBlocked += 1;
    console.log(`${name}: clone refused — ${code}${detail.message ? ` — ${detail.message}` : ""}`);
  }
  if (planBlocked === accounts.length) {
    console.error(
      `\nAll ${accounts.length} accounts are on a plan without instant voice cloning. ` +
        "Upgrade one to ElevenLabs Starter (\u00241 first month, then \u00246) and re-run: node scripts/voice-clone-reference.cjs",
    );
  }
  return 1;
}

main().then((code) => process.exit(code));
