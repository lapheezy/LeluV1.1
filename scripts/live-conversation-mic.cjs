#!/usr/bin/env node
/**
 * LÉLU live conversation — the TEST SPEAKER's microphone input.
 *
 * This container has no microphone. The acceptance runs feed Chromium's
 * capture device a WAV file instead (the page still calls getUserMedia and
 * records a real MediaStream). This script makes that file:
 *
 *   gen      voice each question with a speech worker conditioned on a
 *            NON-HUMAN reference (the public Piper "amy" sample), so the test
 *            speaker is plainly synthetic and does not sound like LÉLU;
 *   compose  join clips, silences and noise into one capture file, e.g.
 *            "a1,sil:40,a2,sil:40,a3,sil:60".
 *
 *   node scripts/live-conversation-mic.cjs gen --worker http://127.0.0.1:8789 --questions q.json --dir <dir>
 *   node scripts/live-conversation-mic.cjs compose --dir <dir> --spec "a1,sil:40,a2" --out scenario.wav
 *
 * Spec items: <id> (a generated clip), sil:<s>, noise:<s> (pink noise at a
 * room-ish level), burst:<s> (a short loud noise, like a cough or a clatter),
 * clicks:<s> (sharp transients, like a keyboard).
 * Clips are kept at 24 kHz; the composed capture file is 48 kHz mono PCM16, followed by a timeline (<out>.json) of where each
 * item starts, so a run can be read against what was "said" when.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const [mode, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const dir = path.resolve(opt("dir", "docs/missions/live-voice-evidence/mic"));
fs.mkdirSync(dir, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

async function gen() {
  const worker = opt("worker", "http://127.0.0.1:8789");
  const questions = JSON.parse(fs.readFileSync(opt("questions"), "utf8"));
  const manifest = {};
  for (const [id, text] of Object.entries(questions)) {
    const res = await fetch(`${worker}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "wav" }),
    });
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const raw = path.join(dir, `${id}.raw.wav`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    // Normalised to a speaking level and to the capture format.
    const file = path.join(dir, `${id}.wav`);
    ff(["-i", raw, "-af", "loudnorm=I=-20:TP=-3", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", file]);
    fs.unlinkSync(raw);
    manifest[id] = { text, seconds: +duration(file).toFixed(2) };
    console.log(id, manifest[id]);
  }
  fs.writeFileSync(path.join(dir, "questions.json"), JSON.stringify({ speaker: "VoxCPM2 conditioned on the Piper 'amy' sample (synthetic test speaker, not a person, not LÉLU)", clips: manifest }, null, 1));
}

function compose() {
  const spec = opt("spec").split(",").map((s) => s.trim()).filter(Boolean);
  const out = path.resolve(opt("out"));
  const tmp = fs.mkdtempSync(path.join(path.dirname(out), ".compose-"));
  const parts = [];
  const timeline = [];
  let t = 0;
  spec.forEach((item, index) => {
    const [kind, arg] = item.split(":");
    const part = path.join(tmp, `${String(index).padStart(3, "0")}.wav`);
    const pcm = ["-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le"];
    if (kind === "sil") ff(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono`, "-t", arg, ...pcm, part]);
    else if (kind === "noise") ff(["-f", "lavfi", "-i", `anoisesrc=c=pink:r=48000:a=0.06`, "-t", arg, ...pcm, part]);
    // A louder, short burst: a cough, a clatter — sound with no words in it.
    else if (kind === "burst") ff(["-f", "lavfi", "-i", `anoisesrc=c=pink:r=48000:a=0.25`, "-t", arg, ...pcm, part]);
    else if (kind === "clicks")
      ff(["-f", "lavfi", "-i", `aevalsrc='if(lt(mod(t\\,0.7)\\,0.012)\\,0.5*sin(2*PI*1800*t)\\,0)':s=48000`, "-t", arg, ...pcm, part]);
    else ff(["-i", path.join(dir, `${kind}.wav`), ...pcm, part]);
    const seconds = duration(part);
    timeline.push({ item, at: +t.toFixed(2), seconds: +seconds.toFixed(2) });
    t += seconds;
    parts.push(part);
  });
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(`${out}.json`, JSON.stringify({ spec: spec.join(","), totalSeconds: +t.toFixed(2), timeline }, null, 1));
  console.log(JSON.stringify({ out, totalSeconds: +t.toFixed(2), timeline }));
}

if (mode === "gen") gen().catch((e) => (console.error(e), process.exit(1)));
else if (mode === "compose") compose();
else {
  console.error("usage: gen | compose");
  process.exit(2);
}
