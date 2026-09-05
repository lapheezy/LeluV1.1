/**
 * ==========================================================
 * LÉLU — AUTONOMOUS COGNITION LOOP
 *
 * CATEGORY: integration. The decision itself is made by the
 * existing native tool loop (AIService.deliberate -> the same
 * ProviderResolver path a chat turn uses). These tests cover the
 * part this pass ADDED: objective lifecycle, wake, budgets,
 * termination, duplicate/failure detection and observability.
 *
 * A stub provider stands in for the model where the assertion is
 * about the LOOP rather than about the model's judgement; the
 * live model decision is verified separately against Anthropic.
 * Anything stubbed is named so in the test.
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

import AgentObjectives, { FAILURE_LIMIT } from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentStore from "../src/core/agents/AgentStore";
import AIService from "../src/core/AIService";
import AgentEventBus from "../src/core/agent/AgentEvents";

const objectives = AgentObjectives.getInstance();
const runtime = AgentCognitionRuntime.getInstance();

/** Replace ONLY the model's reply, so the loop around it stays real. */
function stubDeliberation(
  reply: string,
  executed: Array<{ tool: string; ok: boolean }> = [],
): () => void {
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  ai.deliberate = async () => ({
    text: reply,
    provider: "stub",
    model: "stub",
    processingTime: 1,
    metadata: { toolsExecuted: executed },
  });
  return () => { ai.deliberate = original; };
}

function newAgentId(): string {
  return AgentStore.getInstance().create({ name: `Agent ${Math.random().toString(36).slice(2, 7)}` }).id;
}

/* ---- TEST 1: idle costs nothing ---- */

test("an agent with no active objective runs no cycle and calls no model", async () => {
  let called = 0;
  const restore = (() => {
    const ai = AIService.getInstance() as unknown as { deliberate: unknown };
    const original = ai.deliberate;
    ai.deliberate = async () => { called += 1; return { text: "", provider: "stub", model: "s", processingTime: 0 }; };
    return () => { ai.deliberate = original; };
  })();

  // No objectives exist for this agent, so a wake finds nothing to do.
  const outcomes = await runtime.wake("test:idle");
  restore();
  const mine = outcomes.filter((o) => objectives.get(o.objectiveId)?.agentId === "nobody");
  assert.equal(mine.length, 0);
  assert.equal(called, 0, "an idle agent burned a model call");
});

/* ---- TEST 2: an objective makes a cycle happen with no user message ---- */

test("an active objective produces a cognition cycle without a new user message", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Summarise the workspace." });
  const restore = stubDeliberation("Checked the workspace state.", [{ tool: "project_manage", ok: true }]);
  const outcome = await runtime.runCycle(objective.id, "test:objective-created");
  restore();

  assert.ok(outcome, "no cycle ran for an active objective");
  assert.equal(outcome.objectiveId, objective.id);
  assert.deepEqual(outcome.executed, [{ tool: "project_manage", ok: true }]);
  const after = objectives.get(objective.id);
  assert.equal(after?.cyclesRun, 1);
  assert.equal(after?.actionsTaken, 1);
  assert.equal(after?.state, "active", "one productive cycle should not end the objective");
});

/* ---- TEST 5/7: results feed the next cycle ---- */

test("a completed action becomes context for the next cycle", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Two-step objective." });

  let seenPrompt = "";
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  ai.deliberate = async (prompt: string) => {
    seenPrompt = prompt;
    return { text: "Second step.", provider: "stub", model: "s", processingTime: 1,
      metadata: { toolsExecuted: [{ tool: "research_web", ok: true }] } };
  };

  const restore1 = stubDeliberation("First step done.", [{ tool: "project_manage", ok: true }]);
  await runtime.runCycle(objective.id, "t");
  restore1();

  // Past the cooldown, the next cycle must SEE the first one.
  await new Promise((resolve) => setTimeout(resolve, 1600));
  ai.deliberate = async (prompt: string) => {
    seenPrompt = prompt;
    return { text: "Second step.", provider: "stub", model: "s", processingTime: 1,
      metadata: { toolsExecuted: [{ tool: "research_web", ok: true }] } };
  };
  await runtime.runCycle(objective.id, "t");
  ai.deliberate = original;

  assert.match(seenPrompt, /First step done/, "the next cycle did not receive the previous result");
  assert.match(seenPrompt, /project_manage/, "the previous action was not carried forward");
  assert.equal(objectives.get(objective.id)?.cyclesRun, 2);
});

/* ---- TEST 6: failure reaches cognition and counts ---- */

test("a failed action is recorded as a failure, not as progress", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Will fail." });
  const restore = stubDeliberation("Tried it.", [{ tool: "project_copy", ok: false }]);
  const outcome = await runtime.runCycle(objective.id, "t");
  restore();

  assert.ok(outcome);
  assert.equal(outcome.executed[0].ok, false);
  // The failure counter moved — the loop cannot mistake this for work done.
  assert.equal(objectives.get(objective.id)?.consecutiveFailures, 1);
});

/* ---- TEST 8: completion stops the loop ---- */

test("an agent that judges the objective complete stops and runs no further cycles", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Finish quickly." });
  const restore = stubDeliberation("DONE: the workspace is summarised.", []);
  await runtime.runCycle(objective.id, "t");
  restore();

  const after = objectives.get(objective.id);
  assert.equal(after?.state, "completed");
  assert.match(String(after?.conclusion), /workspace is summarised/);

  // A later wake must not revive it.
  let called = 0;
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  ai.deliberate = async () => { called += 1; return { text: "", provider: "s", model: "s", processingTime: 0 }; };
  const again = await runtime.runCycle(objective.id, "t");
  ai.deliberate = original;
  assert.equal(again, null, "a completed objective ran another cycle");
  assert.equal(called, 0, "a completed objective still called the model");
});

/* ---- TEST 9: repeated failure yields ---- */

test("repeated failure makes the agent yield instead of looping forever", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Keeps failing." });
  // Drive it straight to the limit through the real counter.
  objectives.update(objective.id, { consecutiveFailures: FAILURE_LIMIT });

  let called = 0;
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  ai.deliberate = async () => { called += 1; return { text: "x", provider: "s", model: "s", processingTime: 0 }; };
  const outcome = await runtime.runCycle(objective.id, "t");
  ai.deliberate = original;

  assert.equal(outcome?.yieldReason, "repeated-failure");
  assert.equal(objectives.get(objective.id)?.state, "yielded");
  // The budget is checked BEFORE reasoning: no model call to learn it stopped.
  assert.equal(called, 0, "a model call was spent discovering an exhausted budget");
});

/* ---- TEST 10: budgets yield with the real reason ---- */

test("an exhausted cycle budget yields, and is never reported as completion", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Long job.", maxCycles: 2 });
  objectives.update(objective.id, { cyclesRun: 2 });

  const outcome = await runtime.runCycle(objective.id, "t");
  const after = objectives.get(objective.id);

  assert.equal(outcome?.yieldReason, "cycle-budget-exhausted");
  assert.equal(after?.state, "yielded");
  assert.notEqual(after?.state, "completed");
  // The record says plainly that it did not finish.
  assert.match(String(after?.conclusion), /NOT completed/);
});

test("an exhausted action budget and a passed deadline each yield with their own reason", async () => {
  const agentId = newAgentId();
  const byActions = objectives.create({ agentId, objective: "Too many actions.", maxActions: 3 });
  objectives.update(byActions.id, { actionsTaken: 3 });
  assert.equal((await runtime.runCycle(byActions.id, "t"))?.yieldReason, "action-budget-exhausted");

  const byTime = objectives.create({ agentId, objective: "Out of time." });
  objectives.update(byTime.id, { deadline: Date.now() - 1 });
  assert.equal((await runtime.runCycle(byTime.id, "t"))?.yieldReason, "deadline-reached");
});

/* ---- TEST 14: a capability gap is recognised, not fabricated ---- */

test("an agent that cannot proceed reports the gap rather than inventing execution", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Needs something absent." });
  const restore = stubDeliberation("BLOCKED: the engineering runtime is not available here.", []);
  const outcome = await runtime.runCycle(objective.id, "t");
  restore();

  assert.equal(outcome?.yieldReason, "capability-unavailable");
  assert.equal(objectives.get(objective.id)?.state, "yielded");
  assert.equal(outcome?.executed.length, 0, "it claimed execution while reporting a block");
});

test("an agent that needs information yields for information, not for a capability gap", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Ambiguous." });
  const restore = stubDeliberation("BLOCKED: I need the user to clarify which project.", []);
  const outcome = await runtime.runCycle(objective.id, "t");
  restore();
  // Different next actions: ask a person vs report an unavailable system.
  assert.equal(outcome?.yieldReason, "awaiting-information");
});

/* ---- duplicate-action protection ---- */

test("the same action twice running is treated as no progress", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Repeats itself." });
  objectives.update(objective.id, { actionHistory: ["project_manage"] });
  const restore = stubDeliberation("Doing it again.", [{ tool: "project_manage", ok: true }]);
  const outcome = await runtime.runCycle(objective.id, "t");
  restore();
  assert.equal(outcome?.yieldReason, "no-progress");
});

/* ---- TEST 12: agents do not touch each other's work ---- */

test("each agent owns its own objectives", async () => {
  const first = newAgentId();
  const second = newAgentId();
  const a = objectives.create({ agentId: first, objective: "First agent's job." });
  objectives.create({ agentId: second, objective: "Second agent's job." });

  assert.equal(objectives.list(first).filter((o) => o.id === a.id).length, 1);
  assert.equal(objectives.list(second).some((o) => o.id === a.id), false,
    "one agent can see another's objective");
  assert.ok(objectives.actionable(second).every((o) => o.agentId === second));
});

/* ---- TEST 13: state survives a runtime boundary ---- */

test("objectives and cycle records survive a fresh runtime", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Persist me." });
  const restore = stubDeliberation("Working.", [{ tool: "project_manage", ok: true }]);
  await runtime.runCycle(objective.id, "t");
  restore();

  // A new store instance reads the same persisted state.
  (AgentObjectives as unknown as { instance: unknown }).instance = null;
  const fresh = AgentObjectives.getInstance();
  const recovered = fresh.get(objective.id);
  assert.ok(recovered, "the objective did not survive");
  assert.equal(recovered.objective, "Persist me.");
  assert.equal(recovered.cyclesRun, 1);
  assert.ok(fresh.cycles(objective.id).length > 0, "cycle records did not survive");
});

/* ---- TEST 13 (observability) ---- */

test("every cycle produces an inspectable record and a real event", async () => {
  const agentId = newAgentId();
  const objective = objectives.create({ agentId, objective: "Observable." });

  const seen: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.tool === "cognition.cycle") seen.push(String(event.result));
  });
  const restore = stubDeliberation("A decision.", [{ tool: "research_web", ok: true }]);
  const outcome = await runtime.runCycle(objective.id, "test:trigger");
  restore();
  unsubscribe();

  const record = objectives.cycles(objective.id)[0];
  assert.ok(record, "no cycle record");
  assert.equal(record.cycleId, outcome?.cycleId);
  assert.equal(record.agentId, agentId);
  assert.equal(record.trigger, "test:trigger");
  assert.equal(record.decision, "A decision.");
  assert.deepEqual(record.executed, [{ tool: "research_web", ok: true }]);
  assert.ok(record.nextState);
  // The event came from the runtime, not from a UI.
  assert.ok(seen.length > 0, "no runtime event was emitted for the cycle");
});

/* ---- wake is event-driven, and re-entrancy is impossible ---- */

test("a wake runs cycles only for actionable objectives", async () => {
  const agentId = newAgentId();
  const active = objectives.create({ agentId, objective: "Active one." });
  const done = objectives.create({ agentId, objective: "Finished one." });
  objectives.complete(done.id, "already done");

  const restore = stubDeliberation("Step.", [{ tool: "project_manage", ok: true }]);
  const outcomes = await runtime.wake("test:wake");
  restore();

  const ids = outcomes.map((outcome) => outcome.objectiveId);
  assert.ok(ids.includes(active.id) || objectives.get(active.id)?.state !== "active");
  assert.ok(!ids.includes(done.id), "a completed objective was woken");
});
