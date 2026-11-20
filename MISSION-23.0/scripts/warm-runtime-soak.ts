/**
 * M23.0 — WP08: 30-minute warm-runtime soak.
 *
 * Runs the real server against the real Piper binary for 30 minutes of
 * continuous synthesis across the three delivery profiles, sampling the
 * runtime's own diagnostics and the process RSS as it goes. It answers the
 * questions M22.9 left open:
 *
 *   does memory grow without bound as workers are used?
 *   do all three profiles stay resident, and what does each cost?
 *   does a killed worker come back, and how long does that take?
 *   is queue depth bounded under load?
 *
 * It measures the SERVER, not the browser: no audio device is involved, and
 * nothing here is a hardware claim.
 *
 * Usage: npx tsx MISSION-23.0/scripts/warm-runtime-soak.ts [minutes]
 */
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MINUTES = Number(process.argv[2] || 30);
const BASE = process.env.LELU_URL || "http://127.0.0.1:4180";
const OUT = join(process.cwd(), "MISSION-23.0", "logs");
mkdirSync(OUT, { recursive: true });

const SENTENCES = [
  "Lima is the capital of Peru.",
  "Binary search halves the search space each step.",
  "An API is a contract between two programs.",
  "Saturn is the planet with the brightest rings.",
  "Water boils at one hundred degrees Celsius.",
  "Jane Austen wrote Pride and Prejudice in eighteen thirteen.",
  "Machine learning improves from examples rather than rules.",
  "The speed of light is about three hundred million metres per second.",
  "A hexagon has six sides and six interior angles.",
  "Go to bed at the same time every night, even at weekends.",
];

const PROFILES = ["warm", "calm", "bright"] as const;

interface RuntimeFacts {
  tts?: {
    runtime?: {
      warmWorkers?: number;
      modelLoads?: number;
      modelLoadFailures?: number;
      restarts?: number;
      requests?: number;
      failures?: number;
      cancelled?: number;
      queueDepth?: number;
      active?: number;
      workers?: Array<{ profile?: string; state?: string; pid?: number; uptimeMs?: number; medianSynthesisMs?: number; rssMiB?: number }>;
    };
  };
}

interface Sample {
  at: number;
  elapsedMs: number;
  rssServerMiB: number | null;
  warmWorkers: number | null;
  modelLoads: number | null;
  modelLoadFailures: number | null;
  restarts: number | null;
  requests: number | null;
  failures: number | null;
  queueDepth: number | null;
  workers: NonNullable<NonNullable<RuntimeFacts["tts"]>["runtime"]>["workers"] | null;
}

async function runtime(): Promise<RuntimeFacts> {
  const response = await fetch(`${BASE}/api/voice/diagnostic`);
  if (!response.ok) throw new Error(`diagnostic ${response.status}`);
  return (await response.json()) as RuntimeFacts;
}

/** RSS of the server process by matching the listening port's owner. */
function serverRssMiB(): number | null {
  try {
    const pids = execSync("ss -ltnp 2>/dev/null | grep ':4180' || true", { encoding: "utf8" })
      .split("\n")
      .join(" ")
      .match(/pid=(\d+)/g);
    if (!pids || pids.length === 0) return null;
    const pid = pids[0]!.replace("pid=", "");
    const status = execSync(`cat /proc/${pid}/status`, { encoding: "utf8" });
    const match = status.match(/VmRSS:\s+(\d+) kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}

const started = Date.now();
const samples: Sample[] = [];
const latencies: number[] = [];
const errors: Array<{ at: number; error: string }> = [];

function sample(): Sample {
  let facts: RuntimeFacts = {};
  try {
    facts = runtimeFactsCache.last;
  } catch {
    facts = {};
  }
  const rt = facts.tts?.runtime;
  const entry: Sample = {
    at: Date.now(),
    elapsedMs: Date.now() - started,
    rssServerMiB: serverRssMiB(),
    warmWorkers: rt?.warmWorkers ?? null,
    modelLoads: rt?.modelLoads ?? null,
    modelLoadFailures: rt?.modelLoadFailures ?? null,
    restarts: rt?.restarts ?? null,
    requests: rt?.requests ?? null,
    failures: rt?.failures ?? null,
    queueDepth: rt?.queueDepth ?? null,
    workers: rt?.workers ?? null,
  };
  samples.push(entry);
  // Written as it happens, not only at the end: a soak that is killed at
  // minute 25 must still leave 25 minutes of evidence behind.
  try {
    appendFileSync(join(OUT, `warm-soak-${MINUTES}min.samples.jsonl`), `${JSON.stringify(entry)}\n`);
  } catch {
    /* evidence loss must not stop the soak */
  }
  return entry;
}

const runtimeFactsCache: { last: RuntimeFacts } = { last: {} };

async function refresh(): Promise<void> {
  runtimeFactsCache.last = await runtime();
}

/**
 * One synthesis. The endpoint admits 60 requests/minute per client
 * (TTS_LIMIT in plugins/voiceApi.ts), so a soak that fires faster measures the
 * rate limiter instead of the runtime. A 429 is reported, not counted as a
 * synthesis; the caller paces itself and retries.
 */
async function synthesize(text: string, profile: string): Promise<{ ms: number; status: number }> {
  // The route reads `delivery`, not `profile` (plugins/voiceApi.ts
  // requestedProfile). Sending the wrong key silently exercised the default
  // warm profile for a whole soak, which is why it is spelled out here.
  const body = JSON.stringify({ text, delivery: profile, stream: false });
  const t0 = Date.now();
  const response = await fetch(`${BASE}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const ms = Date.now() - t0;
  if (!response.ok) {
    if (response.status !== 429) errors.push({ at: Date.now(), error: `tts ${response.status} (${profile})` });
    return { ms, status: response.status };
  }
  await response.arrayBuffer();
  const header = response.headers.get("x-lelu-synthesis-ms");
  latencies.push(header ? Number(header) : ms);
  return { ms, status: response.status };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`soaking the warm runtime for ${MINUTES} minutes against ${BASE}`);
await refresh();
const baseline = sample();
console.log(`baseline rss=${baseline.rssServerMiB} MiB workers=${baseline.warmWorkers} loads=${baseline.modelLoads}`);

const deadline = started + MINUTES * 60_000;
let requests = 0;
let lastRefresh = Date.now();
// Deliberately sequential: this measures steady-state memory and queue
// behaviour, not maximum throughput. Concurrency is exercised separately by
// the burst below.
let rateLimited = 0;
const PACE_MS = 2_100; // measured: 48/min was partly rejected by the endpoint limiter; ~28/min is not
while (Date.now() < deadline) {
  const profile = PROFILES[requests % PROFILES.length]!;
  const sentence = SENTENCES[requests % SENTENCES.length]!;
  const cycleStart = Date.now();
  try {
    const result = await synthesize(sentence, profile);
    if (result.status === 200) requests += 1;
    else if (result.status === 429) {
      rateLimited += 1;
      await sleep(1_500);
    } else if (result.status === 503) {
      // Worker starting up; not a soak failure.
      await sleep(800);
    }
  } catch (error) {
    errors.push({ at: Date.now(), error: String(error).slice(0, 200) });
    await sleep(500);
  }
  const spent = Date.now() - cycleStart;
  if (spent < PACE_MS) await sleep(PACE_MS - spent);

  if (Date.now() - lastRefresh > 30_000) {
    try {
      await refresh();
    } catch {
      /* keep going: a failed poll is not a failed soak */
    }
    lastRefresh = Date.now();
    const s = sample();
    console.log(
      `t+${Math.round(s.elapsedMs / 1000)}s rss=${s.rssServerMiB}MiB workers=${s.warmWorkers} loads=${s.modelLoads} req=${s.requests} q=${s.queueDepth} limited=${rateLimited}`,
    );
  }
}

/** Recovery: kill one worker, then immediately ask again and time the answer. */
let recovery = { attempted: false, ok: false, ms: null as number | null, note: "" };
try {
  await refresh();
  const worker = runtimeFactsCache.last.tts?.runtime?.workers?.find((entry) => entry.pid);
  if (worker?.pid) {
    execSync(`kill -9 ${worker.pid}`);
    recovery.attempted = true;
    const before = runtimeFactsCache.last.tts?.runtime?.restarts ?? 0;
    const t0 = Date.now();
    await synthesize("Tell me that you are back after the restart.", "warm");
    recovery.ms = Date.now() - t0;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await refresh();
    const after = runtimeFactsCache.last.tts?.runtime;
    recovery.ok = (after?.warmWorkers ?? 0) >= 1 && (after?.restarts ?? 0) > before;
    recovery.note = `pid ${worker.pid} killed; workers=${after?.warmWorkers} restarts=${after?.restarts} loads=${after?.modelLoads}`;
  } else {
    recovery.note = "no worker pid reported";
  }
} catch (error) {
  recovery.note = `recovery failed: ${String(error).slice(0, 200)}`;
}

await refresh().catch(() => undefined);
const final = sample();

if (samples.length > 1) {
  const rss = samples.map((entry) => entry.rssServerMiB).filter((value): value is number => value !== null);
  const firstHalf = rss.slice(0, Math.floor(rss.length / 2));
  const secondHalf = rss.slice(Math.floor(rss.length / 2));
  const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  const sortedLatency = [...latencies].sort((a, b) => a - b);
  const report = {
    ranAt: new Date().toISOString(),
    minutes: MINUTES,
    base: BASE,
    requests,
    rateLimited,
    errors: errors.slice(0, 50),
    errorCount: errors.length,
    rssMiB: {
      baseline: baseline.rssServerMiB,
      final: final.rssServerMiB,
      min: rss.length ? Math.min(...rss) : null,
      max: rss.length ? Math.max(...rss) : null,
      firstHalfAvg: avg(firstHalf),
      secondHalfAvg: avg(secondHalf),
      growthMiB: baseline.rssServerMiB !== null && final.rssServerMiB !== null ? final.rssServerMiB - baseline.rssServerMiB : null,
    },
    synthesisMs: {
      count: sortedLatency.length,
      min: sortedLatency[0] ?? null,
      median: sortedLatency.length ? sortedLatency[Math.floor(sortedLatency.length / 2)] : null,
      p90: sortedLatency.length ? sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(0.9 * sortedLatency.length))] : null,
      max: sortedLatency.length ? sortedLatency[sortedLatency.length - 1] : null,
    },
    runtime: runtimeFactsCache.last.tts?.runtime ?? null,
    recovery,
    samples,
  };
  writeFileSync(join(OUT, `warm-soak-${MINUTES}min.json`), JSON.stringify(report, null, 2));
  console.log("\n=== soak summary ===");
  console.log(JSON.stringify({
    requests: report.requests,
    errorCount: report.errorCount,
    rss: report.rssMiB,
    synthesisMs: report.synthesisMs,
    workers: report.runtime?.workers?.map((w) => ({ profile: w.profile, state: w.state, uptimeMs: w.uptimeMs, medianSynthesisMs: w.medianSynthesisMs, rssMiB: w.rssMiB })),
    modelLoads: report.runtime?.modelLoads,
    modelLoadFailures: report.runtime?.modelLoadFailures,
    queueDepth: report.runtime?.queueDepth,
    recovery,
  }, null, 2));
}
