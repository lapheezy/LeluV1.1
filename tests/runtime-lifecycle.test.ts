/**
 * ==========================================================
 * LÉLU — COGNITION RUNTIME LIFECYCLE AND OWNERSHIP
 *
 * CATEGORY: integration. Real runtime, real objective store,
 * real timers. Only the model's reply is substituted
 * (MOCKED-MODEL), because what is under test is the lifecycle
 * around the decision, not the decision.
 *
 * The property being pinned: a cognition loop has an owner and
 * an end. Stopping it stops it — including the cycle already
 * in flight, which is the one that actually causes trouble,
 * because it comes back seconds later and writes into a
 * runtime that no longer exists. And one agent's work is not
 * another agent's: no shared timers, no shared cycle records,
 * no inherited loop.
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

import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentStore from "../src/core/agents/AgentStore";
import AgentEventBus from "../src/core/agent/AgentEvents";
import AIService from "../src/core/AIService";
import { stopBackgroundCognition } from "./support/isolation";

const objectives = AgentObjectives.getInstance();
const runtime = AgentCognitionRuntime.getInstance();
const events = AgentEventBus.getInstance();

await stopBackgroundCognition();

const rest = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace ONLY the model's reply. Optionally make it slow, like a real one. */
function mockModel(reply: string, delayMs = 0, executed: Array<{ tool: string; ok: boolean }> = []) {
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  ai.deliberate = async () => {
    if (delayMs > 0) await rest(delayMs);
    return {
      text: reply,
      provider: "MOCKED-MODEL",
      model: "stub",
      processingTime: delayMs,
      metadata: { toolsExecuted: executed },
    };
  };
  return () => { ai.deliberate = original; };
}

function newAgent(name: string): string {
  return AgentStore.getInstance().create({ name }).id;
}

function cleanSlate(): void {
  runtime.cleanup();
  for (const objective of objectives.list()) {
    if (!["completed", "yielded", "cancelled"].includes(objective.state)) {
      objectives.yieldObjective(objective.id, "cancelled", "cleared by the lifecycle tests");
    }
  }
}

/* ====================================================================
 * START / STOP
 * ==================================================================== */

test("start is idempotent and stop leaves nothing scheduled", async () => {
  cleanSlate();
  runtime.start();
  runtime.start();
  assert.equal(runtime.isRunning(), true);

  const agentId = newAgent("Lifecycle A");
  const objective = objectives.create({ agentId, objective: "LIFECYCLE: something to schedule" });
  await rest(200);
  assert.ok(runtime.activeObjectiveIds().includes(objective.id), "no timer was armed for a new objective");

  runtime.stop();
  assert.equal(runtime.isRunning(), false);
  // Timers go immediately. A cycle already inside a model call cannot be
  // interrupted mid-flight — it runs out and abandons its result, which
  // the next test pins — so the assertion is about what stop() owns.
  assert.deepEqual(runtime.scheduledObjectiveIds(), [], "a timer survived stop()");

  // And nothing fires afterwards.
  const before = objectives.cycles(objective.id).length;
  await rest(2_500);
  assert.equal(objectives.cycles(objective.id).length, before, "a cycle ran after stop()");
  cleanSlate();
});

test("a stopped runtime is deaf: real events on the bus start nothing", async () => {
  cleanSlate();
  runtime.start();
  const agentId = newAgent("Lifecycle B");
  const objective = objectives.create({ agentId, objective: "LIFECYCLE: deaf after stop" });
  runtime.stop();

  const restore = mockModel("DONE: should never happen.");
  // The exact event shape the runtime wakes on.
  events.emit({ type: "task_completed", taskId: "t", label: "something finished" });
  await rest(2_000);
  restore();

  assert.equal(objectives.cycles(objective.id).length, 0, "a stopped runtime still woke on an event");
  cleanSlate();
});

/* ====================================================================
 * THE CYCLE ALREADY IN FLIGHT
 * ==================================================================== */

test("a cycle in flight when the runtime stops is abandoned, not recorded", async () => {
  cleanSlate();
  runtime.start();
  const agentId = newAgent("Lifecycle C");
  const objective = objectives.create({ agentId, objective: "LIFECYCLE: slow model, fast shutdown" });

  // A model call slow enough to still be running at teardown — which is
  // the real case: a provider takes seconds, a shutdown takes none.
  const restore = mockModel("DONE: finished after the runtime was gone.", 3_000);
  const cycle = runtime.runCycle(objective.id, "test:in-flight");
  await rest(300);
  assert.equal(runtime.activeObjectiveIds().includes(objective.id), true, "the cycle did not start");

  runtime.stop();
  const outcome = await cycle;
  restore();

  assert.equal(outcome, null, "the abandoned cycle still returned an outcome");
  assert.equal(objectives.cycles(objective.id).length, 0, "the abandoned cycle wrote a record");
  assert.equal(objectives.get(objective.id)?.state, "active", "the abandoned cycle changed the objective");
  assert.equal(objectives.get(objective.id)?.cyclesRun, 0, "the abandoned cycle spent budget");
  cleanSlate();
});

/* ====================================================================
 * PAUSE / RESUME
 * ==================================================================== */

test("pause holds the work and resume picks up the same objective", async () => {
  cleanSlate();
  runtime.start();
  const agentId = newAgent("Lifecycle D");
  const restore = mockModel("Working on it.", 0, [{ tool: "project_manage", ok: true }]);
  const objective = objectives.create({ agentId, objective: "LIFECYCLE: pause and resume" });

  await rest(400);
  runtime.pause();
  assert.equal(runtime.isPaused(), true);
  assert.equal(runtime.isRunning(), true, "pausing must not stop the runtime");
  assert.deepEqual(runtime.scheduledObjectiveIds(), [], "a timer survived pause()");

  const whilePaused = objectives.cycles(objective.id).length;
  await rest(2_500);
  assert.equal(objectives.cycles(objective.id).length, whilePaused, "a cycle ran while paused");
  // The objective is untouched — paused is not cancelled.
  assert.equal(objectives.get(objective.id)?.state, "active");

  runtime.resume();
  assert.equal(runtime.isPaused(), false);
  await rest(2_500);
  restore();
  assert.ok(
    objectives.cycles(objective.id).length > whilePaused,
    "resume did not pick the objective back up",
  );
  cleanSlate();
});

/* ====================================================================
 * CANCELLATION
 * ==================================================================== */

test("cancelling one objective ends that one and leaves the others alone", async () => {
  cleanSlate();
  runtime.start();
  const agentId = newAgent("Lifecycle E");
  const restore = mockModel("Working on it.", 0, [{ tool: "project_manage", ok: true }]);

  const doomed = objectives.create({ agentId, objective: "LIFECYCLE: to be cancelled" });
  const spared = objectives.create({ agentId, objective: "LIFECYCLE: to be left alone" });
  await rest(400);

  runtime.cancel(doomed.id, "the user changed their mind");

  const cancelled = objectives.get(doomed.id)!;
  // Cancelled work is never reported as work that succeeded.
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.yieldReason, "cancelled");
  assert.match(String(cancelled.conclusion), /changed their mind/);
  assert.equal(runtime.scheduledObjectiveIds().includes(doomed.id), false, "a cancelled objective kept its timer");

  const doomedCycles = objectives.cycles(doomed.id).length;
  await rest(2_500);
  restore();
  assert.equal(objectives.cycles(doomed.id).length, doomedCycles, "a cancelled objective kept working");
  assert.ok(objectives.cycles(spared.id).length > 0, "cancelling one objective stopped another");
  cleanSlate();
});

/* ====================================================================
 * CLEANUP LEAVES NO TRANSIENT STATE
 * ==================================================================== */

test("cleanup clears runtime state without destroying persisted work", async () => {
  cleanSlate();
  runtime.start();
  const agentId = newAgent("Lifecycle F");
  const restore = mockModel("Working on it.", 0, [{ tool: "project_manage", ok: true }]);
  const objective = objectives.create({ agentId, objective: "LIFECYCLE: cleanup" });
  await rest(2_200);
  restore();

  const cyclesBefore = objectives.cycles(objective.id).length;
  assert.ok(cyclesBefore > 0, "nothing ran, so cleanup would prove nothing");

  runtime.cleanup();
  assert.equal(runtime.isRunning(), false);
  assert.equal(runtime.isPaused(), false);
  assert.deepEqual(runtime.scheduledObjectiveIds(), []);
  // What was recorded is history, and history is not transient state.
  assert.equal(objectives.cycles(objective.id).length, cyclesBefore);
  assert.ok(objectives.get(objective.id), "cleanup destroyed the objective itself");
  cleanSlate();
});

/* ====================================================================
 * CROSS-AGENT ISOLATION
 * ==================================================================== */

test("one agent's cognition never becomes another agent's", async () => {
  cleanSlate();
  runtime.start();
  const alice = newAgent("Agent Alice");
  const bob = newAgent("Agent Bob");

  // The reply names the agent it was given, so a crossed identity shows.
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  const systemsSeen: string[] = [];
  ai.deliberate = async (_prompt: string, options?: { system?: string }) => {
    systemsSeen.push(String(options?.system ?? ""));
    return {
      text: "Working on it.",
      provider: "MOCKED-MODEL",
      model: "stub",
      processingTime: 0,
      metadata: { toolsExecuted: [{ tool: "project_manage", ok: true }] },
    };
  };

  const aliceObjective = objectives.create({ agentId: alice, objective: "ISOLATION: Alice's own work" });
  const bobObjective = objectives.create({ agentId: bob, objective: "ISOLATION: Bob's own work" });
  await rest(2_500);
  ai.deliberate = original;

  // Ownership is observable, and correct.
  assert.deepEqual(runtime.activeObjectiveIdsFor(alice).filter((id) => id === bobObjective.id), []);
  assert.deepEqual(runtime.activeObjectiveIdsFor(bob).filter((id) => id === aliceObjective.id), []);

  // Objectives are scoped by agent, in the store both of them read.
  assert.deepEqual(objectives.list(alice).map((o) => o.id).filter((id) => id === bobObjective.id), []);
  assert.deepEqual(objectives.list(bob).map((o) => o.id).filter((id) => id === aliceObjective.id), []);

  // Cycle records carry the agent that produced them, and only that one.
  const aliceCycles = objectives.cycles(aliceObjective.id);
  const bobCycles = objectives.cycles(bobObjective.id);
  assert.ok(aliceCycles.length > 0 && bobCycles.length > 0, "both agents must have worked");
  assert.ok(aliceCycles.every((cycle) => cycle.agentId === alice), "Alice's records name another agent");
  assert.ok(bobCycles.every((cycle) => cycle.agentId === bob), "Bob's records name another agent");
  assert.equal(
    aliceCycles.some((cycle) => bobCycles.some((other) => other.cycleId === cycle.cycleId)),
    false,
    "the two agents shared a cycle record",
  );

  // Each was given its OWN identity in the prompt, never the other's.
  assert.ok(systemsSeen.some((system) => system.includes("Agent Alice")), "Alice never got her identity");
  assert.ok(systemsSeen.some((system) => system.includes("Agent Bob")), "Bob never got his identity");
  for (const system of systemsSeen) {
    assert.equal(
      system.includes("Agent Alice") && system.includes("Agent Bob"),
      false,
      "one cycle was given both agents' identities",
    );
  }
  cleanSlate();
});

test("teardown leaves nothing running", async () => {
  cleanSlate();
  assert.equal(runtime.isRunning(), false);
  assert.deepEqual(runtime.scheduledObjectiveIds(), []);
});
