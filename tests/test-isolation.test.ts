/**
 * ==========================================================
 * LÉLU — TEST ISOLATION IS ITSELF TESTED
 *
 * CATEGORY: integration. Real loops, real engine, no mocks.
 *
 * Several suites drive cognition one cycle at a time and
 * assert on what that cycle produced. That is only meaningful
 * when nothing else is running cycles, and the way it breaks
 * is silent: SelfStudyEngine.runCycle() never overlaps cycles,
 * so a call made while one is in flight returns the PREVIOUS
 * report instead of running. The hand-driven cycle does
 * nothing, the state read afterwards is blank, and the
 * assertion fails a millisecond later pointing at the wrong
 * thing.
 *
 * This file pins both halves: that the failure mode is real,
 * and that stopBackgroundCognition() removes it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import CognitiveLoop from "../src/core/cognition/CognitiveLoop";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import { stopBackgroundCognition, backgroundCognitionIsQuiet } from "./support/isolation";

const engine = SelfStudyEngine.getInstance();

await stopBackgroundCognition();

test("a cycle driven while another is in flight does nothing, and says so", { timeout: 180_000 }, async () => {
  assert.equal(engine.isBusy(), false, "a cycle was already running before this test");

  // Start one WITHOUT awaiting it, so a second call lands mid-cycle —
  // exactly what a background loop does to a hand-driven test.
  const inFlight = engine.runCycle();
  assert.equal(engine.isBusy(), true, "the first cycle did not take the lock");
  const cycleDuringFlight = engine.getCycle();

  const swallowed = await engine.runCycle();
  assert.equal(
    engine.getCycle(),
    cycleDuringFlight,
    "a second cycle ran concurrently — cycles must never overlap",
  );
  assert.match(
    String(swallowed.note),
    /already in progress/i,
    "the swallowed cycle did not say it had been swallowed",
  );

  await inFlight;
});

test("stopping background cognition really stops it, in-flight cycles included", { timeout: 180_000 }, async () => {
  // Start everything a booted LÉLU would start.
  CognitiveLoop.getInstance().start();
  engine.start(100);
  AgentCognitionRuntime.getInstance().start();
  assert.equal(engine.isRunning(), true, "the study loop did not start");
  assert.equal(AgentCognitionRuntime.getInstance().isRunning(), true, "the objective runtime did not start");

  // Let a cycle actually get going, so the wait has something to wait for.
  const deadline = Date.now() + 30_000;
  while (!engine.isBusy() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const settled = await stopBackgroundCognition();
  assert.equal(settled, true, "a cycle was still in flight after the wait");
  assert.equal(backgroundCognitionIsQuiet(), true, "something was still scheduling cognition");

  // And it STAYS quiet: nothing reschedules itself behind the helper.
  const cycleAfterStop = engine.getCycle();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  assert.equal(engine.getCycle(), cycleAfterStop, "cognition advanced after being stopped");
});

test("after isolation a hand-driven cycle really runs", { timeout: 180_000 }, async () => {
  await stopBackgroundCognition();
  const before = engine.getCycle();

  const report = await engine.runCycle();

  assert.equal(engine.getCycle(), before + 1, "the hand-driven cycle did not advance the counter");
  assert.equal(report.cycle, before + 1, "the report is of the previous cycle, not this one");
  assert.equal(
    /already in progress/i.test(String(report.note ?? "")),
    false,
    "the cycle was swallowed even after isolation",
  );
  // A cycle that really ran has a question it worked on.
  assert.ok(report.objective, "the cycle produced no objective");
});
