/**
 * VoxCPM2 worker lifecycle, as the app's compute pool sees it.
 *
 * The sidecar (services/voxcpm/server.py) reports
 * STARTING → LOADING → INITIALIZING → READY | FAILED, and says READY only
 * after a real generation produced non-silent audio. These tests pin that
 * the pool trusts that word and nothing weaker:
 *
 *   · a loaded-but-unproven worker (INITIALIZING) is NOT available;
 *   · READY is available and is what `select()` picks;
 *   · FAILED carries its reason into `detail`;
 *   · an older worker with no lifecycle still works on `loaded`;
 *   · the bearer token reaches the worker and never the snapshot.
 *
 * Offline against a fake sidecar. Set VOXCPM_LIVE_URL (e.g.
 * http://127.0.0.1:8788) to also probe a real running worker.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { VoxcpmPool, probeVoxcpmWorker, type VoxcpmWorker } from "../src/core/voice/gpuWorkers";

async function fakeSidecar(health: Record<string, unknown>) {
  const seen: { authorization?: string } = {};
  const server = http.createServer((request, response) => {
    seen.authorization = request.headers.authorization;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, engine: "voxcpm2", device: "cpu", ...health }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const worker: VoxcpmWorker = { id: "local", kind: "local", url: `http://127.0.0.1:${port}`, token: "s3cret-token" } as VoxcpmWorker;
  return { worker, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("a loaded worker still running its self-test is not available", async () => {
  const fake = await fakeSidecar({ state: "INITIALIZING", ready: false, loaded: true });
  try {
    const health = await probeVoxcpmWorker(fake.worker);
    assert.equal(health.available, false);
    assert.equal(health.state, "INITIALIZING");
    assert.equal(health.reason, "model-unavailable");
    assert.match(health.detail, /INITIALIZING/);
  } finally {
    await fake.close();
  }
});

test("READY is available and selected", async () => {
  const fake = await fakeSidecar({ state: "READY", ready: true, loaded: true, sampleRate: 48000 });
  try {
    const pool = new VoxcpmPool([fake.worker]);
    const chosen = await pool.select();
    assert.ok(chosen);
    assert.equal(chosen.available, true);
    assert.equal(chosen.state, "READY");
    assert.equal(chosen.sampleRate, 48000);
  } finally {
    await fake.close();
  }
});

test("FAILED is unavailable and says why", async () => {
  const fake = await fakeSidecar({ state: "FAILED", ready: false, loaded: false, stateError: "selftest: silent output" });
  try {
    const health = await probeVoxcpmWorker(fake.worker);
    assert.equal(health.available, false);
    assert.match(health.detail, /FAILED: selftest: silent output/);
  } finally {
    await fake.close();
  }
});

test("an older worker without a lifecycle is judged on loaded", async () => {
  const fake = await fakeSidecar({ loaded: true });
  try {
    const health = await probeVoxcpmWorker(fake.worker);
    assert.equal(health.available, true);
    assert.equal(health.state, null);
  } finally {
    await fake.close();
  }
});

test("the token reaches the worker and never the snapshot", async () => {
  const fake = await fakeSidecar({ state: "READY", ready: true, loaded: true });
  try {
    const pool = new VoxcpmPool([fake.worker]);
    await pool.select();
    assert.equal(fake.seen.authorization, "Bearer s3cret-token");
    assert.doesNotMatch(JSON.stringify(pool.snapshot()), /s3cret-token/);
  } finally {
    await fake.close();
  }
});

const live = process.env.VOXCPM_LIVE_URL;
test("live worker is READY through the pool", { skip: !live && "VOXCPM_LIVE_URL not set" }, async () => {
  const pool = new VoxcpmPool([{ id: "live", kind: "local", url: String(live), token: process.env.VOXCPM_TOKEN ?? "" } as VoxcpmWorker]);
  const chosen = await pool.select({ timeoutMs: 5000 });
  assert.ok(chosen, "the live worker should be selectable");
  assert.equal(chosen.state, "READY");
  assert.equal(chosen.loaded, true);
});
