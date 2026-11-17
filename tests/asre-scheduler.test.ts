/**
 * LÉLU ASRE — WP4 scheduler: dependency order, gain/cost priority,
 * capacity limits, learned costs, anytime deadlines. Uses a fake clock
 * where tasks advance time by their true cost — deterministic.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CostModel, Scheduler, expectedGain, type SchedTask } from "../src/core/asre/scheduler/Scheduler";

function clockTasks(spec: Array<{ id: string; deps?: string[]; gain: number; ms: number; mem?: number }>, clock: { t: number }): SchedTask<string>[] {
  return spec.map((s) => ({
    id: s.id, kind: s.id, deps: s.deps ?? [], gain: s.gain, size: 1, priorMs: s.ms, memoryMB: s.mem,
    run: async () => {
      // single-slot fake: advance time by the task's true cost
      clock.t += s.ms;
      return s.id;
    },
  }));
}

test("expected gain is zero for certain, complete work", () => {
  assert.equal(expectedGain({ importance: 1, confidence: 1, missing: 1 }), 0);
  assert.equal(expectedGain({ importance: 1, confidence: 0.2, missing: 0 }), 0);
  assert.ok(expectedGain({ importance: 1, confidence: 0.2, missing: 1 }) > expectedGain({ importance: 0.3, confidence: 0.2, missing: 1 }));
});

test("dependencies are always respected", async () => {
  const clock = { t: 0 };
  const r = await new Scheduler().run(clockTasks([
    { id: "torso", gain: 0.1, ms: 10 },
    { id: "top", deps: ["torso", "arms"], gain: 9, ms: 1 },
    { id: "arms", deps: ["torso"], gain: 0.1, ms: 10 },
  ], clock), { slots: 1, now: () => clock.t });
  assert.deepEqual(r.order, ["torso", "arms", "top"]);
});

test("gain-per-cost puts the most informative cheap work first and reaches usable output sooner than FIFO", async () => {
  const spec = [
    { id: "background-detail", gain: 0.05, ms: 50 },
    { id: "pose-refine", gain: 0.1, ms: 40 },
    { id: "face", gain: 0.9, ms: 5 },
    { id: "hair", gain: 0.6, ms: 8 },
  ];
  const c1 = { t: 0 }, c2 = { t: 0 };
  const smart = await new Scheduler().run(clockTasks(spec, c1), { slots: 1, now: () => c1.t, usableAfter: ["face", "hair"] });
  const fifo = await new Scheduler().run(clockTasks(spec, c2), { slots: 1, now: () => c2.t, policy: "fifo", usableAfter: ["face", "hair"] });
  assert.deepEqual(smart.order.slice(0, 2), ["face", "hair"]);
  assert.equal(smart.firstUsableMs, 13);
  assert.equal(fifo.firstUsableMs, 103);
  assert.equal(smart.makespanMs, fifo.makespanMs, "same total work");
});

test("anytime mode: a deadline keeps the high-value work and skips the rest", async () => {
  const clock = { t: 0 };
  const r = await new Scheduler().run(clockTasks([
    { id: "low", gain: 0.05, ms: 50 },
    { id: "high", gain: 0.9, ms: 5 },
    { id: "mid", gain: 0.4, ms: 10 },
  ], clock), { slots: 1, deadlineMs: 12, now: () => clock.t });
  assert.deepEqual(r.order, ["high", "mid"]);
  assert.deepEqual(r.skipped, ["low"]);
});

test("memory budget limits concurrency; slots run tasks in parallel", async () => {
  let live = 0, peak = 0;
  const mk = (id: string, mem: number): SchedTask => ({
    id, kind: "k", deps: [], gain: 1, size: 1, memoryMB: mem,
    run: async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 20));
      live--;
    },
  });
  await new Scheduler().run(["a", "b", "c", "d"].map((id) => mk(id, 600)), { slots: 4, memoryBudgetMB: 1300 });
  assert.equal(peak, 2, "1300 MB fits two 600 MB tasks");
  peak = 0;
  await new Scheduler().run(["a", "b", "c", "d"].map((id) => mk(id, 100)), { slots: 4, memoryBudgetMB: 1300 });
  assert.equal(peak, 4);
});

test("the cost model learns from measurements", () => {
  const m = new CostModel(0.5);
  assert.equal(m.predict("hair", 1000, 7), 7, "prior until measured");
  m.observe("hair", 1000, 100);
  assert.equal(m.predict("hair", 2000), 200);
  m.observe("hair", 1000, 50);
  assert.ok(Math.abs(m.predict("hair", 1000) - 75) < 1e-9);
});
