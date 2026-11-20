/**
 * ==========================================================
 * LÉLU — HER SPEECH RUNTIME STAYS WARM (and recovers)
 *
 * CATEGORY: worker lifecycle, offline. Real child processes running the
 * `--json-input` protocol, a fake voice that patches its WAV header last
 * exactly as Piper does, and no model, network or audio device.
 *
 * Mission 22.9 WP01 asks for facts, not intentions: the model is
 * initialised once, twenty sentences share that one process, concurrent
 * requests are safe, a cancellation does not cost the warm model, and a
 * crashed or unloadable worker is reported and replaced.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPersistentPiper, shutdownPersistentPipers, PiperError } from "../plugins/persistentPiper";

const FAKE = join(process.cwd(), "MISSION-22.9", "scripts", "fake-piper.mjs");

interface Harness {
  bin: string;
  model: string;
  log: string;
  directory: string;
}

/** A wrapper so the pool can spawn "piper" while a Node script does the work. */
function harness(env: Record<string, string> = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), "lelu-warm-piper-"));
  const model = join(directory, "voice.onnx");
  writeFileSync(model, "not a real model");
  writeFileSync(`${model}.json`, JSON.stringify({ audio: { sample_rate: 16_000 } }));
  const bin = join(directory, "piper");
  writeFileSync(
    bin,
    `#!/bin/sh\n${Object.entries(env)
      .map(([key, value]) => `${key}='${value}'`)
      .join(" ")} exec "${process.execPath}" "${FAKE}" "$@"\n`.replace(/^ /, ""),
  );
  chmodSync(bin, 0o755);
  const log = join(directory, "spawns.log");
  writeFileSync(log, "");
  return { bin, model, log, directory };
}

function spawnLines(log: string): string[] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("spawn "));
}

function requestLines(log: string): string[] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("request "));
}

function cleanup(h: Harness): void {
  shutdownPersistentPipers();
  rmSync(h.directory, { recursive: true, force: true });
}

test("one model load serves twenty consecutive sentences", async () => {
  const h = harness({ FAKE_PIPER_LOG: "LOG" });
  // The log path is only known after the directory exists; patch it in.
  writeFileSync(
    h.bin,
    `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' exec "${process.execPath}" "${FAKE}" "$@"\n`,
  );
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4 });
  try {
    await pool.prewarm();
    const results = [];
    for (let index = 0; index < 20; index += 1) {
      results.push(await pool.synthesize(`Sentence number ${index + 1}.`));
    }
    const stats = pool.stats();
    assert.equal(stats.modelLoads, 1, "the voice was loaded exactly once");
    assert.equal(stats.warmWorkers, 1);
    assert.equal(results.length, 20, "twenty sentences were answered");
    assert.equal(stats.requests, 21, "twenty sentences plus the prewarm came out of the warm worker");
    assert.equal(spawnLines(h.log).length, 1, "one process was spawned for the whole session");
    assert.equal(requestLines(h.log).length, 21, "one prewarm request + twenty sentences");
    const pids = new Set(results.map((result) => result.workerPid));
    assert.equal(pids.size, 1, "every sentence came from the same process");
    assert.ok(results.every((result) => result.wav.length > 44), "each answer is a real WAV");
    assert.equal(results[0]?.wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(stats.workers[0]?.medianSynthesisMs !== null, true, "synthesis time is measured, not assumed");
    assert.equal(pool.stats().failures, 0);
  } finally {
    cleanup(h);
  }
});

test("concurrent requests are serialised safely through one warm worker", async () => {
  const h = harness();
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_DELAY_MS=60 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4, maxQueuePerProfile: 8 });
  try {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => pool.synthesize(`Concurrent sentence ${index + 1}.`)),
    );
    const elapsed = Date.now() - started;
    assert.equal(results.length, 5);
    assert.ok(results.every((result) => result.wav.length > 44), "no request was corrupted by its neighbour");
    assert.equal(new Set(results.map((result) => result.workerPid)).size, 1, "one worker served all five");
    // Serialised: five 60 ms syntheses cannot have overlapped.
    assert.ok(elapsed >= 250, `expected serialised work, measured ${elapsed} ms`);
    assert.equal(pool.stats().queueDepth, 0, "the queue drained");
    assert.equal(pool.stats().active, 0, "no worker is left marked busy");
  } finally {
    cleanup(h);
  }
});

test("each delivery profile is its own warm process, with its own flags", async () => {
  const h = harness();
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4 });
  try {
    const calm = await pool.synthesize("Let me walk through the measurement.", { profile: "calm" });
    const bright = await pool.synthesize("That is wonderful news!", { profile: "bright" });
    const stats = pool.stats();
    assert.equal(calm.profile, "calm");
    assert.equal(bright.profile, "bright");
    assert.equal(stats.modelLoads, 2, "two deliveries, two workers, one model load each");
    const spawns = spawnLines(h.log);
    assert.equal(spawns.length, 2);
    assert.ok(spawns.some((line) => line.includes("--length_scale 1.12")), "calm is spawned slower");
    assert.ok(spawns.some((line) => line.includes("--length_scale 0.92")), "bright is spawned quicker");
    assert.notEqual(calm.workerPid, bright.workerPid, "the profiles never share a process");
  } finally {
    cleanup(h);
  }
});

test("a cancelled sentence is dropped and does not cost the warm model", async () => {
  const h = harness();
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_DELAY_MS=250 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4 });
  try {
    await pool.prewarm();
    const controller = new AbortController();
    const pending = pool.synthesize("A sentence the user will interrupt.", { signal: controller.signal });
    setTimeout(() => controller.abort(), 40);
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof PiperError);
      assert.equal(error.code, "cancelled");
      return true;
    });
    assert.equal(pool.stats().cancelled, 1);
    // The loaded model survives a barge-in: no reload, same process.
    const after = await pool.synthesize("The next thing she says.");
    assert.ok(after.wav.length > 44);
    assert.equal(pool.stats().modelLoads, 1, "a cancellation must not reload the voice");
    assert.equal(after.workerPid, pool.stats().workers[0]?.pid);
    assert.equal(pool.stats().restarts, 0);
  } finally {
    cleanup(h);
  }
});

test("a crashed worker is reported, and the next sentence replaces it", async () => {
  const h = harness();
  // Dies on its SECOND request: the process had already proven it could
  // speak, so this is a crash mid-session, not a model that never loaded.
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_DIE_ON=2 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4 });
  try {
    const first = await pool.synthesize("The sentence before the crash.");
    assert.ok(first.wav.length > 44, "the worker was healthy first");
    await assert.rejects(pool.synthesize("This sentence kills the worker."), (error: unknown) => {
      assert.ok(error instanceof PiperError);
      assert.equal(error.code, "worker-crashed");
      return true;
    });
    assert.equal(pool.stats().restarts >= 1, true, "the crash is counted, not hidden");
    const recovered = await pool.synthesize("The runtime recovered.");
    assert.ok(recovered.wav.length > 44, "the application speaks again after the crash");
    assert.equal(pool.stats().modelLoads, 2, "a new process means one new model load, reported");
    assert.equal(existsSync(h.model), true);
  } finally {
    cleanup(h);
  }
});

test("a worker that cannot load its model is a load failure, not a slow voice", async () => {
  const h = harness({ FAKE_PIPER_EXIT_NOW: "1" });
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_EXIT_NOW=1 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4, loadGraceMs: 2_000 });
  try {
    await assert.rejects(pool.synthesize("Nothing will come of this."));
    const stats = pool.stats();
    assert.equal(stats.modelLoadFailures, 1, "an unloadable model is reported as such");
    assert.equal(stats.warmWorkers, 0);
    assert.match(String(stats.workers[0]?.lastError), /model load failed/);
  } finally {
    cleanup(h);
  }
});

test("the queue is bounded, so a runaway client cannot grow memory", async () => {
  const h = harness();
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_DELAY_MS=150 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4, maxQueuePerProfile: 2 });
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => pool.synthesize(`Sentence ${index + 1}.`)),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled").length;
    const rejected = results.filter((result) => result.status === "rejected");
    assert.ok(fulfilled >= 2 && fulfilled <= 3, `expected the queue to cap acceptance, got ${fulfilled}`);
    assert.ok(rejected.length >= 3, "the rest were refused rather than queued forever");
    assert.ok(
      rejected.every((result) => (result as PromiseRejectedResult).reason instanceof PiperError &&
        (result as PromiseRejectedResult).reason.code === "queue-full"),
      "a refused request says it was refused",
    );
  } finally {
    cleanup(h);
  }
});

test("shutdown rejects work instead of leaving a caller waiting", async () => {
  const h = harness();
  writeFileSync(h.bin, `#!/bin/sh\nFAKE_PIPER_LOG='${h.log}' FAKE_PIPER_DELAY_MS=400 exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(h.bin, 0o755);
  const pool = getPersistentPiper({ bin: h.bin, model: h.model, pollMs: 4 });
  try {
    const pending = pool.synthesize("A sentence the runtime will not finish.");
    setTimeout(() => pool.stop(), 30);
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof PiperError);
      assert.equal(error.code, "shutting-down");
      return true;
    });
    await assert.rejects(pool.synthesize("After shutdown."), /shutting down/i);
  } finally {
    cleanup(h);
  }
});
