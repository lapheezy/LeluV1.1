/**
 * M22.9 / WP01+WP02 — warm Piper vs the M22.8 cold path, same sentences.
 *
 * Measures, with the real binary and the real voice model:
 *
 *   · cold (`--output_raw`, one process per sentence — the M22.8 path):
 *     spawn → first PCM byte, and full sentence
 *   · warm (persistent `--json-input` worker): submit → complete WAV
 *
 * The comparison is deliberately unfair to the warm path: it is credited
 * with delivering audio only when the WHOLE sentence exists, while the cold
 * path is credited with its first byte. If warm still wins, it wins for real.
 *
 * Usage:
 *   npx tsx MISSION-22.9/scripts/warm-runtime-benchmark.ts [sentences]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getPersistentPiper, shutdownPersistentPipers } from "../../plugins/persistentPiper";

const SENTENCES = Number(process.argv[2] ?? 20);
const BIN = process.env.LELU_LOCAL_TTS_BIN ?? join(process.cwd(), ".piper/piper/piper");
const MODEL = process.env.LELU_LOCAL_TTS_MODEL ?? join(process.cwd(), ".piper/voices/amy-low.onnx");

const TEXTS = [
  "The runtime is warm now.",
  "I kept the model in memory.",
  "This sentence costs only its own synthesis.",
  "No process was restarted between these sentences.",
  "The voice you hear is the same voice every time.",
  "Latency should be measured, not described.",
  "A conversation needs a speaker that is always ready.",
  "That is what a persistent runtime gives her.",
  "The next sentence starts while the last one plays.",
  "Reading and speaking do not have to wait for each other.",
];

function text(index: number): string {
  const base = TEXTS[index % TEXTS.length] ?? "A sentence.";
  return index < TEXTS.length ? base : `${base}`;
}

function stats(values: number[]): { n: number; min: number; median: number; p90: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    median: Math.round(at(0.5)),
    p90: Math.round(at(0.9)),
    max: sorted[sorted.length - 1] ?? 0,
    mean: Math.round(sum / Math.max(1, sorted.length)),
  };
}

/** The M22.8 path: one process per sentence, `--output_raw`, first byte. */
function coldSentence(sentence: string): Promise<{ firstByteMs: number | null; completeMs: number; bytes: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let firstByteMs: number | null = null;
    let bytes = 0;
    const child = execFile(BIN, ["--model", MODEL, "--output_raw"], { encoding: "buffer", timeout: 60_000 });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (firstByteMs === null) firstByteMs = Date.now() - started;
      bytes += chunk.length;
    });
    child.on("close", () => resolve({ firstByteMs, completeMs: Date.now() - started, bytes }));
    child.on("error", () => resolve({ firstByteMs, completeMs: Date.now() - started, bytes }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(sentence);
  });
}

async function main(): Promise<void> {
  if (!existsSync(BIN) || !existsSync(MODEL)) {
    console.error(`SKIP: missing binary (${BIN}) or model (${MODEL})`);
    process.exit(2);
  }
  console.log(`binary ${BIN}\nmodel  ${MODEL}\nsentences ${SENTENCES}\n`);

  // ---- cold -------------------------------------------------------------
  const coldFirstByte: number[] = [];
  const coldComplete: number[] = [];
  const coldStartedAt = Date.now();
  for (let index = 0; index < SENTENCES; index += 1) {
    const result = await coldSentence(text(index));
    if (result.firstByteMs !== null) coldFirstByte.push(result.firstByteMs);
    coldComplete.push(result.completeMs);
    process.stdout.write(`cold[${index + 1}] first=${result.firstByteMs ?? "–"}ms complete=${result.completeMs}ms bytes=${result.bytes}\n`);
  }
  const coldTotalMs = Date.now() - coldStartedAt;

  // ---- warm -------------------------------------------------------------
  const pool = getPersistentPiper({ bin: BIN, model: MODEL });
  const prewarmStarted = Date.now();
  await pool.prewarm();
  const prewarmMs = Date.now() - prewarmStarted;
  const warm: number[] = [];
  const warmStartedAt = Date.now();
  const pids = new Set<number | null>();
  let audioMs = 0;
  for (let index = 0; index < SENTENCES; index += 1) {
    const result = await pool.synthesize(text(index));
    warm.push(result.synthesisMs);
    pids.add(result.workerPid);
    // 16 kHz mono 16-bit: how long this sentence will be audible for.
    audioMs += (result.wav.length - 44) / 2 / 16_000;
    process.stdout.write(`warm[${index + 1}] ${result.synthesisMs}ms pid=${result.workerPid} bytes=${result.wav.length} loads=${result.modelLoads}\n`);
  }
  const warmTotalMs = Date.now() - warmStartedAt;
  const snapshot = pool.stats();

  const report = {
    at: new Date().toISOString(),
    bin: BIN,
    model: MODEL,
    sentences: SENTENCES,
    cold: {
      modelLoads: SENTENCES,
      firstByteMs: stats(coldFirstByte),
      completeMs: stats(coldComplete),
      totalMs: coldTotalMs,
    },
    warm: {
      prewarmMs,
      modelLoads: snapshot.modelLoads,
      workers: snapshot.warmWorkers,
      synthesisMs: stats(warm),
      totalMs: warmTotalMs,
      pids: [...pids],
      rssMiB: snapshot.workers.map((worker) => ({ profile: worker.profile, rssMiB: worker.rssMiB, pid: worker.pid })),
      audioSeconds: Math.round(audioMs * 100) / 100,
      realTimeFactor: Math.round((warm.reduce((sum, value) => sum + value, 0) / 1000 / Math.max(0.01, audioMs)) * 1000) / 1000,
      restarts: snapshot.restarts,
      failures: snapshot.failures,
    },
    comparison: {
      medianFirstAudioMs: { cold: stats(coldFirstByte).median, warm: stats(warm).median },
      medianFullSentenceMs: { cold: stats(coldComplete).median, warm: stats(warm).median },
      totalWallMs: { cold: coldTotalMs, warm: prewarmMs + warmTotalMs },
      modelLoadsPerSession: { cold: SENTENCES, warm: snapshot.modelLoads },
    },
    note:
      "Warm audio is counted at complete WAV (pessimistic for warm); cold audio is counted at its first PCM byte (flattering to cold). Both used the same voice model and sentences.",
  };

  const directory = join(process.cwd(), "MISSION-22.9", "logs");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "warm-runtime.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${JSON.stringify(report.comparison, null, 2)}`);
  console.log(`\nwrote ${path}`);
  pool.stop();
  shutdownPersistentPipers();
}

void main().catch((error: unknown) => {
  console.error(error);
  shutdownPersistentPipers();
  process.exit(1);
});
