/**
 * ==========================================================
 * LÉLU — WORKFLOW AUTHORING CONNECTED TO LEARNING
 *
 * CATEGORY: integration. No model and no fixtures: the evidence
 * comes from real objective records and real workflow executions,
 * and the tools that run really run through the dispatcher.
 *
 * A workflow that exists only because someone asked for one is
 * not learning. What is proven here is the loop:
 *
 *   repeat a procedure → notice the repetition from real records
 *     → author it → run it → observe a real failure
 *     → notice the failure from real executions → revise it
 *     → the revision's control flow really executes
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

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentStore from "../src/core/agents/AgentStore";
import WorkflowPatterns, { MIN_OCCURRENCES } from "../src/core/workflows/WorkflowPatterns";
import WorkflowStore from "../src/core/workflows/WorkflowStore";
import WorkflowEngine from "../src/core/workflows/WorkflowEngine";
import AgentWorkflowBridge from "../src/core/workflows/AgentWorkflowBridge";
import { authorWorkflow } from "../src/core/workflows/WorkflowAuthoring";
import ToolRegistry from "../src/core/tools/ToolRegistry";

const objectives = AgentObjectives.getInstance();
const patterns = WorkflowPatterns.getInstance();
const store = WorkflowStore.getInstance();
const engine = WorkflowEngine.getInstance();

ToolRegistry.getInstance().updateAvailability("project.manage", true);

/**
 * Record a REAL completed objective that ran a tool sequence.
 *
 * The cycle records written here are the same records the runtime
 * writes; nothing about the pattern detector is special-cased for the
 * test, and no workflow is created for it to find.
 */
function completedObjectiveRunning(tools: string[], text: string): string {
  const agentId = AgentStore.getInstance().create({ name: "Pattern" }).id;
  const objective = objectives.create({ agentId, objective: text });
  objectives.recordCycle({
    cycleId: crypto.randomUUID(),
    agentId,
    objectiveId: objective.id,
    trigger: "runtime:objective-created",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    decision: `Ran ${tools.join(" then ")}.`,
    executed: tools.map((tool) => ({ tool, ok: true })),
    nextState: "completed",
  });
  objectives.complete(objective.id, "done");
  return objective.id;
}

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

/* ====================================================================
 * RECOGNISING A REPEATED PROCEDURE
 * ==================================================================== */

test("a procedure repeated across objectives is recognised from real records", () => {
  const sequence = ["research.web", "project.manage"];
  const before = patterns.repeatedProcedures().length;

  completedObjectiveRunning(sequence, "look something up, then record it (first time)");
  const afterOne = patterns.repeatedProcedures();
  assert.equal(
    afterOne.some((entry) => entry.tools.join(">") === sequence.join(">")),
    MIN_OCCURRENCES <= 1,
    "one occurrence is not yet a pattern",
  );

  completedObjectiveRunning(sequence, "look something up, then record it (second time)");
  const afterTwo = patterns.repeatedProcedures();
  const found = afterTwo.find((entry) => entry.tools.join(">") === sequence.join(">"));

  assert.ok(found, "a procedure run twice was not recognised");
  assert.equal(found.occurrences, 2);
  assert.equal(found.objectiveIds.length, 2);
  assert.ok(found.examples[0].includes("look something up"));
  assert.ok(afterTwo.length > before);
});

test("only work that really succeeded teaches a procedure", () => {
  const agentId = AgentStore.getInstance().create({ name: "Pattern-negative" }).id;
  const sequence = ["memory.store", "memory.search"];

  for (let index = 0; index < 3; index += 1) {
    const objective = objectives.create({ agentId, objective: `failed attempt ${index}` });
    objectives.recordCycle({
      cycleId: crypto.randomUUID(),
      agentId,
      objectiveId: objective.id,
      trigger: "runtime:objective-created",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      decision: "tried",
      executed: sequence.map((tool) => ({ tool, ok: false })),
      nextState: "yielded",
      yieldReason: "repeated-failure",
    });
    objectives.yieldObjective(objective.id, "repeated-failure", "it did not work");
  }

  assert.equal(
    patterns.repeatedProcedures().some((entry) => entry.tools.join(">") === sequence.join(">")),
    false,
    "a procedure that never worked was suggested for saving",
  );
});

test("the evidence reaches the surface cognition already reads", () => {
  completedObjectiveRunning(["research.web", "project.manage"], "third time doing the same thing");
  const surface = AgentWorkflowBridge.getInstance().describeCapabilities();
  assert.match(surface, /PROCEDURES YOU HAVE REPEATED AND NOT SAVED/);
  assert.match(surface, /research\.web → project\.manage/);
  assert.match(surface, /workflow_author/);
});

test("saving the procedure stops it being suggested", () => {
  const name = unique("saved-procedure");
  const result = authorWorkflow({
    name,
    description: "The procedure that kept recurring, now saved so it can be reused.",
    outputs: "A recorded result.",
    steps: [
      { id: "look", name: "look it up", tool: "research.web", arguments: { query: "anything" } },
      {
        id: "record",
        name: "record it",
        tool: "project.manage",
        arguments: { action: "list" },
        dependsOn: ["look"],
      },
    ],
  });
  assert.equal(result.ok, true, result.errors.join(" "));

  const still = patterns
    .repeatedProcedures()
    .some((entry) => entry.tools.join(">") === "research.web>project.manage");
  assert.equal(still, false, "a saved procedure is still being suggested for saving");
});

/* ====================================================================
 * NOTICING THAT A SAVED WORKFLOW NEEDS REVISING
 * ==================================================================== */

test("a workflow its own runs show to be failing is flagged for revision, with the real reason", async () => {
  const name = unique("fragile");
  const authored = authorWorkflow({
    name,
    description: "Depends on long-term memory, which this runtime does not have.",
    outputs: "A stored note.",
    steps: [{ id: "store", name: "store a note", tool: "memory.store", arguments: { summary: "x" } }],
  });
  assert.equal(authored.ok, true, authored.errors.join(" "));

  // Two REAL runs. The tool genuinely refuses; nothing is simulated.
  await engine.run(authored.workflow!.id);
  await engine.run(authored.workflow!.id);

  const candidate = patterns
    .revisionCandidates()
    .find((entry) => entry.workflowId === authored.workflow!.id);

  assert.ok(candidate, "a workflow that failed every run was not flagged");
  assert.equal(candidate.runs, 2);
  assert.equal(candidate.failures, 2);
  assert.equal(candidate.failingStepId, "store");
  assert.ok(candidate.reason.length > 0, "the flag carries no real reason");

  const surface = AgentWorkflowBridge.getInstance().describeCapabilities();
  assert.match(surface, /NEED REVISING/);
  assert.match(surface, new RegExp(name));
  // The surface names the id to re-author with, so revising is possible
  // rather than merely advisable.
  assert.match(surface, new RegExp(authored.workflow!.id));
});

test("a workflow that has never failed is never suggested for revision", async () => {
  const name = unique("reliable");
  const authored = authorWorkflow({
    name,
    description: "Uses a tool that really works in this runtime.",
    outputs: "A project listing.",
    steps: [{ id: "a", name: "list", tool: "project.manage", arguments: { action: "list" } }],
  });
  await engine.run(authored.workflow!.id);
  assert.equal(
    patterns.revisionCandidates().some((entry) => entry.workflowId === authored.workflow!.id),
    false,
  );
});

/* ====================================================================
 * REVISING IT — AND THE REVISION'S CONTROL FLOW REALLY RUNS
 * ==================================================================== */

test("revising a flagged workflow replaces it in place, and the new control flow executes for real", async () => {
  const name = unique("revisable");
  const first = authorWorkflow({
    name,
    description: "First attempt: one brittle step and nothing to fall back on.",
    outputs: "A stored note.",
    steps: [{ id: "store", name: "store a note", tool: "memory.store", arguments: { summary: "x" } }],
  });
  const id = first.workflow!.id;
  await engine.run(id);
  await engine.run(id);
  assert.ok(patterns.revisionCandidates().some((entry) => entry.workflowId === id));

  // THE REVISION, authored the way cognition would: same id, real
  // control flow — retry the brittle step, then carry on regardless
  // and take a branch that depends on what actually happened.
  const revised = authorWorkflow({
    id,
    name,
    description: "Revised after its own runs failed: retry the brittle step, then fall back.",
    outputs: "A recorded result, even when long-term memory refuses.",
    steps: [
      {
        id: "store",
        name: "store a note",
        tool: "memory.store",
        arguments: { summary: "x" },
        retry: { maxAttempts: 2 },
        onFailure: { action: "continue" },
      },
      {
        id: "fallback",
        name: "record it where it will actually persist",
        tool: "project.manage",
        arguments: { action: "list" },
        // ORDERED AFTER, not dependent on: a fallback must run because
        // the step it compensates for failed, so it cannot require that
        // step to have succeeded.
        after: ["store"],
        condition: { step: "store", operator: "failed" },
      },
    ],
  });
  assert.equal(revised.ok, true, revised.errors.join(" "));
  assert.equal(revised.workflow!.id, id, "revising created a second workflow instead of replacing one");
  assert.equal(store.list().filter((entry) => entry.name === name).length, 1);

  const run = await engine.run(id);
  const store_ = run.steps.find((step) => step.stepId === "store");
  const fallback = run.steps.find((step) => step.stepId === "fallback");

  // The retry really re-invoked the tool.
  assert.equal(store_?.status, "failed");
  assert.equal(store_?.attempts, 2, "the revision's retry did not really re-attempt");
  // The branch was taken because the real result satisfied its condition.
  assert.equal(fallback?.status, "succeeded", `the fallback branch did not run: ${fallback?.reason}`);
  assert.equal(run.status, "succeeded", run.summary);
  assert.ok(run.finalResult, "the revised workflow produced no result");
});
