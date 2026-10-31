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

/*
 * The live failure of the real model test, in the words it failed on.
 *
 * LÉLU listed, authored and ran the workflow in its first cycle, and the
 * verifier then told it — nine times — that project.manage had still not
 * run. It never could: the objective names project.manage as what the
 * workflow's STEPS should use, which is content of an artifact, not an
 * operation LÉLU was asked to perform. The contract made the objective
 * unsatisfiable, so the check that exists to keep her honest was the
 * thing preventing completion.
 */
test("a tool named as what an artifact's steps use is content, not an operation", () => {
  const live = namedToolIds(
    "Check with workflow_list whether a reusable workflow named \"inventory-routine\" already exists. " +
      "If it does not, create it with workflow_author: give it two steps that both use the " +
      "project.manage tool with action \"list\", where the second depends on the first and only runs " +
      "on the condition that the first succeeded. Then run it once with workflow_run and report " +
      "what it produced.",
    KNOWN_TOOLS,
  );

  assert.deepEqual(
    live,
    ["workflow.list", "workflow.author", "workflow.run"],
    "the objective was judged against an operation it never asked LÉLU to perform",
  );
  assert.ok(!live.includes("project.manage"), "project.manage became a requirement");
});

test("a condition before a comma does not negate the instruction after it", () => {
  // Found by the same live run: "If it does not already exist, create it
  // with workflow_author" is an instruction, and treating it as a
  // prohibition left the contract without the operation that mattered.
  assert.deepEqual(
    namedToolIds("If it does not already exist, create it with workflow_author.", KNOWN_TOOLS),
    ["workflow.author"],
    "a condition in the previous clause swallowed the instruction",
  );
  assert.deepEqual(
    namedToolIds("Do not use memory_store, and create it with workflow_author.", KNOWN_TOOLS),
    ["workflow.author"],
    "a prohibition of one tool leaked onto another tool in a later clause",
  );
  // And the prohibition itself still holds.
  assert.deepEqual(namedToolIds("Do not use memory_store, reason it out.", KNOWN_TOOLS), []);
});

test("a tool named in any other way is still a requirement", () => {
  // The narrowness of the rule is the point: a false negative here would
  // weaken the check that catches a premature DONE:.
  assert.deepEqual(
    namedToolIds("Save the note using the memory_store tool.", KNOWN_TOOLS),
    ["memory.store"],
    "an ordinary instruction was mistaken for a description of an artifact",
  );
  assert.deepEqual(namedToolIds("Create the routine with workflow_author.", KNOWN_TOOLS), [
    "workflow.author",
  ]);
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

/**
 * A PROHIBITION LIST IS STILL A PROHIBITION.
 *
 * The clause window used to stop at the first comma, which is the right
 * call for "instead of X, use Y" and the wrong call for the most
 * natural way to write a prohibition: a list. "Avoid memory.store,
 * workflow.run and project.manage" saw only " " before the second and
 * third names, and required two tools the goal had just ruled out —
 * the exact inversion the contract exists to prevent, one comma in.
 *
 * Both shapes are now read separately, so these cases cannot be
 * traded against each other again.
 */
test("every tool in a prohibition list is ruled out, not just the first", () => {
  assert.deepEqual(
    namedToolIds("Avoid memory.store, workflow.run and project.manage entirely.", KNOWN_TOOLS),
    [],
    "a prohibition stopped applying at the comma",
  );
  assert.deepEqual(
    namedToolIds("Do not call workflow.run, workflow.list, or workflow.author.", KNOWN_TOOLS),
    [],
    "two of the three forbidden tools became requirements",
  );
  assert.deepEqual(
    namedToolIds("Never use memory.store or workflow.run.", KNOWN_TOOLS),
    [],
    "the second tool of an 'or' pair survived the prohibition",
  );
});

test("a binding negation rules out its own tool and not the replacement", () => {
  assert.deepEqual(
    namedToolIds("Instead of memory.store, save it with project.manage.", KNOWN_TOOLS),
    ["project.manage"],
    "the replacement the sentence asks for was deleted along with the tool it replaces",
  );
  assert.deepEqual(
    namedToolIds("Without using workflow.run, author it with workflow.author.", KNOWN_TOOLS),
    ["workflow.author"],
  );
  assert.deepEqual(
    namedToolIds("Do not use memory.store; instead use workflow.author.", KNOWN_TOOLS),
    ["workflow.author"],
    "a contrast marker did not end the prohibition",
  );
});

test("a prohibition ends at a new instruction but not at a continued list", () => {
  // The two readings of "and", which decide opposite outcomes.
  assert.deepEqual(
    namedToolIds("Do not use memory.store, and run it with workflow.run.", KNOWN_TOOLS),
    ["workflow.run"],
    "a second instruction inherited the first clause's prohibition",
  );
  assert.deepEqual(
    namedToolIds("Avoid memory.store and workflow.run.", KNOWN_TOOLS),
    [],
    "a continued list was read as a new instruction",
  );
});

test("a binding negation binds the whole bare list, not only its first tool", () => {
  // "without X and Y" forbids both. Consuming only the first left the
  // second reading as a requirement — the inverted contract again, one
  // conjunction in.
  assert.deepEqual(
    namedToolIds("Do it without workflow.run and workflow.list.", KNOWN_TOOLS),
    [],
    "the second tool of a bound list became a requirement",
  );
  assert.deepEqual(
    namedToolIds("Do it without using memory.store, workflow.run or project.manage.", KNOWN_TOOLS),
    [],
  );
  // And the list still stops at the first word that is not a tool id,
  // which is what keeps the replacement in the sentence above.
  assert.deepEqual(
    namedToolIds("Other than workflow.list, use project.manage.", KNOWN_TOOLS),
    ["project.manage"],
  );
});

test("a dot inside a tool id is not a sentence boundary", () => {
  // project.manage's own dot used to end the clause, which left the
  // next name reading as if nothing had forbidden it.
  assert.deepEqual(
    namedToolIds("Do not use project.manage, workflow.run or memory.store.", KNOWN_TOOLS),
    [],
    "the prohibition ended at the dot inside the first tool id",
  );
});

test("a prohibition LIST does not block a reasoning-only objective either", () => {
  // The consequence of the clause fix, at the level a person feels it:
  // the contract is what the verifier judges against, so a list that
  // forbade three tools used to produce requirements the objective had
  // ruled out — and an objective that can never be satisfied is one
  // LÉLU can never honestly finish.
  const objective = objectiveWith(
    "Do not use memory.store, workflow.run or project.manage; just decide whether anything needs doing.",
  );

  assert.deepEqual(expectedOutcomesFor(objective, KNOWN_TOOLS), [], "a prohibition became the contract");

  const result = verifyCompletion(
    { objective, cycles: [], conclusion: "Nothing needed doing." },
    KNOWN_TOOLS,
  );
  assert.equal(result.verdict, "complete", "the objective was unsatisfiable by its own prohibition");
});
