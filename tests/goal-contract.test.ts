/**
 * ==========================================================
 * LÉLU — THE GOAL → OUTCOME CONTRACT
 *
 * CATEGORY: unit for the derivation (pure), unit for the
 * verifier, and a store round-trip for the wiring.
 *
 * Phase 8's rule, in one sentence: an objective may only be
 * judged against outcomes the runtime could SAFELY know, and
 * where it cannot know, it must invent nothing.
 *
 * The four ways this used to go wrong, each pinned here:
 *   1. a verb became a tool — "Improve the project." requiring
 *      project.manage;
 *   2. a prohibition became a requirement — "Do not use
 *      memory_store." requiring memory_store;
 *   3. prose that merely LOOKS tool-shaped ("user.preferences",
 *      "config.yaml") became a requirement;
 *   4. an objective created by cognition carried no contract at
 *      all, so the only thing left to judge it by was its own
 *      wording.
 *
 * And the behaviour that must survive unchanged: an objective
 * that is answerable by reasoning is completed by its answer,
 * not by a tool it never needed.
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
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

import {
  deriveOutcomes,
  namedToolIds,
  structuredPlanToolIds,
} from "../src/core/cognition/OutcomeDerivation";
import { expectedOutcomesFor, verifyCompletion } from "../src/core/cognition/CompletionVerifier";
import type {
  AgentObjective,
  CognitionCycleRecord,
  ObjectiveOutcome,
} from "../src/core/cognition/AgentObjectives";
import AgentObjectives from "../src/core/cognition/AgentObjectives";

/** The real dispatcher's ids, in the spelling the runtime actually uses. */
const KNOWN_TOOLS = [
  "workflow.list",
  "workflow.author",
  "workflow.run",
  "memory.store",
  "project.manage",
];

function objectiveWith(
  text: string,
  expectedOutcomes?: ObjectiveOutcome[],
): AgentObjective {
  const now = Date.now();
  return {
    id: "objective-test",
    agentId: "agent-test",
    objective: text,
    state: "active",
    source: "cognition",
    basePriority: 50,
    priority: 50,
    createdAt: now,
    updatedAt: now,
    cyclesRun: 0,
    maxCycles: 8,
    actionsTaken: 0,
    maxActions: 12,
    deadline: now + 600_000,
    consecutiveFailures: 0,
    actionHistory: [],
    ...(expectedOutcomes ? { expectedOutcomes } : {}),
  };
}

function cycle(executed: Array<{ tool: string; ok: boolean }>): CognitionCycleRecord {
  return {
    cycleId: `cycle-${Math.random().toString(36).slice(2, 8)}`,
    agentId: "agent-test",
    objectiveId: "objective-test",
    trigger: "runtime:objective-created",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    decision: "Working.",
    executed,
    nextState: "active",
  };
}

const tools = (outcomes: ObjectiveOutcome[]): Array<string | undefined> =>
  outcomes.map((outcome) => outcome.tool);

/* ================================================================== *
 * 1. WHAT MAY BECOME A REQUIREMENT
 * ================================================================== */

test("an operation the goal explicitly names becomes a requirement", () => {
  const outcomes = deriveOutcomes({
    objective: "Create the routine with workflow_author, then run it with workflow_run.",
    knownTools: KNOWN_TOOLS,
  });

  assert.deepEqual(tools(outcomes), ["workflow.author", "workflow.run"]);
});

test("a verb is not a tool: 'improve the project' requires nothing", () => {
  const outcomes = deriveOutcomes({
    objective: "Improve the project and make the workspace nicer.",
    // project.manage is dispatchable and the wording is project-shaped;
    // neither makes it a requirement.
    knownTools: KNOWN_TOOLS,
  });

  assert.deepEqual(outcomes, [], "free prose was turned into a tool requirement");
});

test("prose that merely looks tool-shaped cannot invent a requirement", () => {
  const outcomes = deriveOutcomes({
    objective: "Review the user.preferences section and config.yaml, then summarise.",
    knownTools: KNOWN_TOOLS,
  });

  assert.deepEqual(outcomes, []);
});

test("a goal that RULES OUT a tool does not require it", () => {
  // The inversion that matters: reading the name alone made a
  // prohibition into a hard requirement that could never be satisfied.
  for (const wording of [
    "Do not use memory_store for this.",
    "Answer without memory_store.",
    "Avoid memory_store; reason from what you already know.",
  ]) {
    assert.deepEqual(
      namedToolIds(wording, KNOWN_TOOLS),
      [],
      `a prohibition became a requirement: ${wording}`,
    );
  }
});

test("a negation in one clause does not swallow the next clause's requirement", () => {
  assert.deepEqual(
    namedToolIds("Do not use memory_store; create it with workflow_author.", KNOWN_TOOLS),
    ["workflow.author"],
    "the negation bled past the clause it belonged to",
  );
});

/* ================================================================== *
 * 2. PRECEDENCE
 * ================================================================== */

test("declared outcomes win, verbatim, over anything derived", () => {
  const declared: ObjectiveOutcome[] = [
    { evidence: "answer-given", what: "an explanation was given" },
  ];

  const outcomes = deriveOutcomes({
    objective: "Use workflow_author and workflow_run.",
    declared,
    structuredTools: ["workflow.list"],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(outcomes, declared, "the declared contract was replaced rather than returned");
});

test("structured plan steps outrank nothing, but they do state the contract", () => {
  const toolIds = structuredPlanToolIds(
    {
      executionPlan: ["Run the authored routine with workflow_run and report it."],
      // Negated inside an actionable task: still not a requirement.
      actionableTasks: ["Do not use memory_store here."],
      checkpoint: { pending: ["Improve the project."] },
    },
    KNOWN_TOOLS,
  );

  assert.deepEqual(toolIds, ["workflow.run"]);
});

test("a project with no plan yields no contract, rather than a guess", () => {
  assert.deepEqual(structuredPlanToolIds({}, KNOWN_TOOLS), []);
  assert.deepEqual(
    structuredPlanToolIds({ checkpoint: { pending: ["Make it better."] } }, KNOWN_TOOLS),
    [],
  );
});

/* ================================================================== *
 * 3. THE CONTRACT REACHES THE OBJECTIVE, AND THE VERIFIER HONOURS IT
 * ================================================================== */

test("an objective carries the contract it was created with, and it survives the store", () => {
  const contract = deriveOutcomes({
    objective: "Run it once with workflow_run and report what it produced.",
    structuredTools: ["workflow.run"],
    knownTools: KNOWN_TOOLS,
  });
  assert.deepEqual(tools(contract), ["workflow.run"]);

  const stored = AgentObjectives.getInstance().create({
    agentId: "agent-test",
    objective: "Run the authored routine and report what it produced.",
    source: "cognition",
    expectedOutcomes: contract,
  });

  const reread = AgentObjectives.getInstance().get(stored.id);
  assert.deepEqual(
    tools(reread?.expectedOutcomes ?? []),
    ["workflow.run"],
    "the contract did not survive the objective store",
  );
  // The verifier reads the stored contract, not a re-parse of the wording.
  assert.deepEqual(tools(expectedOutcomesFor(reread!, KNOWN_TOOLS)), ["workflow.run"]);

  AgentObjectives.getInstance().yieldObjective(stored.id, "cancelled", "test cleanup");
});

test("a stored requirement the record does not satisfy is rejected, not believed", () => {
  const objective = objectiveWith("Do the thing.", [
    { evidence: "tool-succeeded", tool: "workflow.run", what: "workflow.run ran successfully" },
  ]);

  const incomplete = verifyCompletion(
    {
      objective,
      cycles: [cycle([{ tool: "workflow.run", ok: false }])],
      conclusion: "It is done.",
    },
    KNOWN_TOOLS,
  );
  assert.equal(incomplete.verdict, "incomplete");
  assert.equal(incomplete.missing.length, 1);

  const complete = verifyCompletion(
    {
      objective,
      cycles: [cycle([{ tool: "workflow.run", ok: true }])],
      conclusion: "The routine ran and produced the inventory list.",
    },
    KNOWN_TOOLS,
  );
  assert.equal(complete.verdict, "complete");
});

/* ================================================================== *
 * 4. REASONING-ONLY OBJECTIVES ARE UNTOUCHED
 * ================================================================== */

test("a reasoning-only objective is completed by its answer, not by a tool", () => {
  const objective = objectiveWith("Decide whether anything needs doing.");

  const result = verifyCompletion(
    { objective, cycles: [], conclusion: "Nothing needed doing." },
    KNOWN_TOOLS,
  );
  assert.equal(result.verdict, "complete", "a short, valid answer was treated as insufficient");
  assert.deepEqual(result.missing, []);

  const vacuous = verifyCompletion({ objective, cycles: [], conclusion: "Done." }, KNOWN_TOOLS);
  assert.equal(vacuous.verdict, "incomplete", "claiming completion was accepted as the answer");
});

test("a prohibited tool does not block a reasoning-only objective", () => {
  const objective = objectiveWith("Do not use memory_store; decide whether anything needs doing.");

  const result = verifyCompletion(
    {
      objective,
      cycles: [],
      conclusion: "Nothing needed doing.",
    },
    KNOWN_TOOLS,
  );

  assert.equal(result.verdict, "complete", "the prohibition was read as a requirement");
});
