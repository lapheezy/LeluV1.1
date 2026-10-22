/**
 * ==========================================================
 * LÉLU — A CLAIM IS NOT EVIDENCE
 *
 * CATEGORY: unit for the verifier (pure, no model, no
 * provider), integration for the runtime wiring (real
 * AgentCognitionRuntime, real stores, scripted provider).
 *
 * The governing invariant:
 *
 *   THINK → DECIDE → EXECUTE → OBSERVE → VERIFY → CONTINUE
 *
 * not
 *
 *   THINK → SAY DONE → MARK COMPLETE
 *
 * This is the failure the live end-to-end test caught a real
 * model producing: a three-operation objective that ran
 * workflow_list and then said DONE. The runtime believed it.
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

import {
  verifyCompletion,
  expectedOutcomesFor,
  type CompletionInput,
} from "../src/core/cognition/CompletionVerifier";
import type {
  AgentObjective,
  CognitionCycleRecord,
  ObjectiveOutcome,
} from "../src/core/cognition/AgentObjectives";

/* ------------------------------------------------------------------ *
 * FIXTURES — plain data, so these tests are about the predicate and
 * nothing else.
 * ------------------------------------------------------------------ */

const KNOWN_TOOLS = ["workflow_list", "workflow_author", "workflow_run", "memory_store", "project.manage"];

function objectiveWith(
  text: string,
  expectedOutcomes?: ObjectiveOutcome[],
): AgentObjective {
  return {
    id: "obj-1",
    agentId: "agent-1",
    objective: text,
    state: "active",
    source: "user",
    basePriority: 50,
    priority: 50,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cyclesRun: 1,
    maxCycles: 8,
    actionsTaken: 0,
    maxActions: 12,
    deadline: Date.now() + 600_000,
    consecutiveFailures: 0,
    actionHistory: [],
    ...(expectedOutcomes ? { expectedOutcomes } : {}),
  };
}

function cycle(
  executed: Array<{ tool: string; ok: boolean }>,
  extra: Partial<CognitionCycleRecord> = {},
): CognitionCycleRecord {
  return {
    cycleId: crypto.randomUUID(),
    agentId: "agent-1",
    objectiveId: "obj-1",
    trigger: "runtime:test",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    decision: "did a thing",
    executed,
    nextState: "active",
    ...extra,
  };
}

const threeTools: ObjectiveOutcome[] = [
  { evidence: "tool-succeeded", tool: "workflow_list", what: "the workflows were listed" },
  { evidence: "tool-succeeded", tool: "workflow_author", what: "the workflow was authored" },
  { evidence: "tool-succeeded", tool: "workflow_run", what: "the workflow was run" },
];

function verify(input: Partial<CompletionInput> & { objective: AgentObjective }) {
  return verifyCompletion(
    {
      cycles: [],
      conclusion: "I have finished the objective as described.",
      ...input,
    },
    KNOWN_TOOLS,
  );
}

/* ================================================================== *
 * 1. ALL REQUIRED OUTCOMES OBSERVED
 * ================================================================== */

test("three required outcomes, all three really executed, completes", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [
      cycle([
        { tool: "workflow_list", ok: true },
        { tool: "workflow_author", ok: true },
        { tool: "workflow_run", ok: true },
      ]),
    ],
  });

  assert.equal(result.verdict, "complete", result.reason);
  assert.equal(result.missing.length, 0);
  assert.equal(result.observed.length, 3, "every satisfied outcome should be named");
});

/* ================================================================== *
 * 2. PARTIAL EXECUTION — the live failure, exactly
 * ================================================================== */

test("three required outcomes, only one executed, does NOT complete", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [cycle([{ tool: "workflow_list", ok: true }])],
    conclusion: "The workflow already exists, so there is nothing more to do.",
  });

  assert.equal(result.verdict, "incomplete", "a premature DONE completed an unsatisfied objective");
  assert.deepEqual(result.observed, ["the workflows were listed"]);
  assert.equal(result.missing.length, 2);
  assert.match(result.reason, /2 of 3/, `the reason does not say what is missing: ${result.reason}`);
});

/* ================================================================== *
 * 3. TOOLS REQUIRED, NOTHING RELEVANT RAN
 * ================================================================== */

test("an objective that requires tools is not completed by words alone", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [],
    conclusion: "Everything requested has been completed successfully.",
  });

  assert.equal(result.verdict, "incomplete");
  assert.equal(result.observed.length, 0, "nothing ran, so nothing can be observed");
  assert.equal(result.missing.length, 3);
});

test("a confident conclusion is worth no more than an empty one", () => {
  const objective = objectiveWith("List, author and run the workflow.", threeTools);
  const confident = verify({ objective, conclusion: "All three steps are fully complete and verified." });
  const empty = verify({ objective, conclusion: "" });

  assert.equal(confident.verdict, empty.verdict, "the model's confidence changed the verdict");
  assert.deepEqual(confident.missing, empty.missing);
});

/* ================================================================== *
 * 4. REASONING-ONLY OBJECTIVES ARE NOT TOOL CHECKLISTS
 * ================================================================== */

test("an objective answerable by reasoning completes on its answer, with no tool at all", () => {
  const result = verify({
    objective: objectiveWith("Explain why the memory system can affect future turns."),
    cycles: [],
    conclusion:
      "Because recalled memories are injected into the prompt before the model reasons, " +
      "so what was stored earlier changes what is decided later.",
  });

  assert.equal(result.verdict, "complete", result.reason);
  assert.deepEqual(result.missing, []);
});

test("but a reasoning objective with no answer and no action has produced nothing", () => {
  const result = verify({
    objective: objectiveWith("Explain why the memory system can affect future turns."),
    cycles: [],
    conclusion: "Done.",
  });

  assert.equal(result.verdict, "incomplete", "an empty gesture was accepted as an answer");
});

test("an explicit answer-given outcome is satisfied by a real answer", () => {
  const result = verify({
    objective: objectiveWith("Summarise the position.", [
      { evidence: "answer-given", what: "the position was summarised" },
    ]),
    conclusion: "The position is that completion must be checked against observable evidence.",
  });

  assert.equal(result.verdict, "complete", result.reason);
});

/* ================================================================== *
 * 5. MULTI-CYCLE OBJECTIVES
 * ================================================================== */

test("evidence is aggregated across cycles, so a concluding cycle need not execute anything", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [
      cycle([{ tool: "workflow_list", ok: true }, { tool: "workflow_author", ok: true }]),
      cycle([{ tool: "workflow_run", ok: true }]),
    ],
    // The concluding cycle takes no action — the model is told not to.
    executedNow: [],
    conclusion: "Listed, authored and ran it.",
  });

  assert.equal(result.verdict, "complete", result.reason);
  assert.equal(result.missing.length, 0);
});

test("the cycle that is not recorded yet counts too", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [cycle([{ tool: "workflow_list", ok: true }, { tool: "workflow_author", ok: true }])],
    // Still in flight, so not in the store when the check runs.
    executedNow: [{ tool: "workflow_run", ok: true }],
    conclusion: "Ran it just now.",
  });

  assert.equal(result.verdict, "complete", result.reason);
});

/* ================================================================== *
 * 6. A TOOL THAT RAN AND FAILED IS NOT A SATISFIED OUTCOME
 * ================================================================== */

test("a failed tool leaves its outcome unmet, and says so distinctly", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [
      cycle([
        { tool: "workflow_list", ok: true },
        { tool: "workflow_author", ok: false },
      ]),
    ],
    conclusion: "Authoring failed but I will call it done.",
  });

  assert.equal(result.verdict, "incomplete");
  assert.ok(
    result.missing.some((entry) => /ran and failed/.test(entry)),
    `a refused tool is not distinguished from one never attempted: ${result.missing.join(" | ")}`,
  );
  // The verifier says "not satisfied". It does NOT say retry, replan or
  // give up — that separation is the point.
  assert.ok(!/retry|replan|give up/i.test(result.reason), "the verifier is prescribing a recovery");
});

/* ================================================================== *
 * 7. BLOCKED ON THE USER
 * ================================================================== */

test("an outcome only the user can supply is blocked, not merely incomplete", () => {
  const result = verify({
    objective: objectiveWith("Book it once the user says which date.", [
      { evidence: "user-information", what: "the date the user wants" },
    ]),
    cycles: [],
    conclusion: "I cannot proceed without the date.",
  });

  assert.equal(result.verdict, "blocked", "a question-shaped gap was treated as ordinary incompleteness");
  assert.match(result.reason, /without the user/i);
});

test("and is satisfied once the user has actually answered", () => {
  const result = verify({
    objective: objectiveWith("Book it once the user says which date.", [
      { evidence: "user-information", what: "the date the user wants" },
    ]),
    // The runtime records the answer as the trigger of the cycle it woke.
    cycles: [cycle([], { trigger: "event:question-answered" })],
    conclusion: "The user said the 14th, so it is booked.",
  });

  assert.equal(result.verdict, "complete", result.reason);
});

/* ================================================================== *
 * 8. MODEL CLAIM ≠ EXECUTION EVIDENCE
 * ================================================================== */

test("a tool the model asked for that never reached the dispatcher is not evidence", () => {
  const result = verify({
    objective: objectiveWith("Store the note."),
    cycles: [],
    // Requested, never executed: the record and the claim disagree.
    requestedNow: ["memory_store"],
    executedNow: [],
    conclusion: "I stored the note durably, as requested, and it is now saved.",
  });

  assert.equal(result.verdict, "incomplete", "a claimed execution was accepted without one");
  assert.match(result.reason, /never reached the dispatcher/);
  assert.deepEqual(result.missing, ["memory_store ran successfully"]);
});

test("the claim check applies even when the objective declared no outcomes", () => {
  const result = verify({
    objective: objectiveWith("Do something useful."),
    cycles: [cycle([], { requested: ["workflow_run"] })],
    conclusion: "I ran the workflow and it succeeded.",
  });

  assert.equal(result.verdict, "incomplete");
});

/* ================================================================== *
 * WHAT IS NOT TREATED AS EVIDENCE
 * ================================================================== */

test("some tool having run is not enough, and neither is a lot of them", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [
      cycle([
        { tool: "workflow_list", ok: true },
        { tool: "workflow_list", ok: true },
        { tool: "workflow_list", ok: true },
        { tool: "project.manage", ok: true },
      ]),
    ],
    conclusion: "Lots of work done.",
  });

  assert.equal(result.verdict, "incomplete", "volume of execution was mistaken for the right execution");
  assert.equal(result.missing.length, 2);
});

test("the last tool succeeding does not settle an objective", () => {
  const result = verify({
    objective: objectiveWith("List, author and run the workflow.", threeTools),
    cycles: [cycle([{ tool: "workflow_author", ok: false }, { tool: "workflow_list", ok: true }])],
    conclusion: "The last call worked.",
  });

  assert.equal(result.verdict, "incomplete");
});

/* ================================================================== *
 * REQUIREMENTS AN OBJECTIVE STATES IN ITS OWN WORDS
 * ================================================================== */

test("an objective that names its tools has stated its own requirements", () => {
  const objective = objectiveWith(
    "Check with workflow_list whether it exists, create it with workflow_author, then run it with workflow_run.",
  );
  const outcomes = expectedOutcomesFor(objective, KNOWN_TOOLS);

  assert.deepEqual(
    outcomes.map((outcome) => outcome.tool),
    ["workflow_list", "workflow_author", "workflow_run"],
    "the objective's own wording was not read as its requirements",
  );

  // And the live failure is therefore caught with nothing declared.
  const result = verify({
    objective,
    cycles: [cycle([{ tool: "workflow_list", ok: true }])],
    conclusion: "It already exists, so nothing more is needed.",
  });
  assert.equal(result.verdict, "incomplete");
  assert.equal(result.missing.length, 2);
});

test("only names the runtime can really dispatch become requirements", () => {
  // Prose that merely looks tool-shaped must not invent a requirement.
  const objective = objectiveWith(
    "Review the user.preferences section and the config.yaml file, then summarise it.",
  );
  assert.deepEqual(expectedOutcomesFor(objective, KNOWN_TOOLS), []);

  const result = verify({ objective, conclusion: "The section describes three preferences, summarised here." });
  assert.equal(result.verdict, "complete", "an unknown name was treated as a required tool");
});

test("declared outcomes win over anything read from the wording", () => {
  const objective = objectiveWith(
    "Use workflow_list and workflow_author and workflow_run.",
    [{ evidence: "answer-given", what: "an explanation was given" }],
  );

  const result = verify({
    objective,
    conclusion: "Here is the explanation that was actually asked for in the declared outcome.",
  });
  assert.equal(result.verdict, "complete", "declared outcomes were overridden by the wording");
});

test("either spelling of a tool name matches the same tool", () => {
  const result = verify({
    objective: objectiveWith("Do it.", [
      { evidence: "tool-succeeded", tool: "project.manage", what: "the project was managed" },
    ]),
    // The dispatcher records the model-facing spelling.
    cycles: [cycle([{ tool: "project_manage", ok: true }])],
    conclusion: "Managed it.",
  });

  assert.equal(result.verdict, "complete", "project.manage and project_manage were treated as different tools");
});

/* ================================================================== *
 * THE RUNTIME, NOT JUST THE PREDICATE
 *
 * The checks above prove the verifier's judgement. These prove
 * AgentCognitionRuntime acts on it: that a premature DONE: cannot
 * complete an objective whose observable requirements are unmet, and
 * that the work carries on by the runtime's existing means rather
 * than by anything new.
 * ================================================================== */

const { default: AgentObjectives } = await import("../src/core/cognition/AgentObjectives");
const { default: AgentCognitionRuntime } = await import("../src/core/cognition/AgentCognitionRuntime");
const { default: AIService } = await import("../src/core/AIService");
const { default: AgentStore } = await import("../src/core/agents/AgentStore");
const { default: ProactiveCore } = await import("../src/core/proactive/ProactiveCore");

const store = AgentObjectives.getInstance();
const liveAgent = AgentStore.getInstance().create({
  name: "Verification",
  role: "Proves a claim is checked",
}).id;

/** A provider that answers from a script. Returns a restore function. */
async function scripted(
  name: string,
  rounds: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; arguments: unknown }> }>,
): Promise<() => void> {
  const service = AIService.getInstance();
  await service.initialize();
  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) (provider as { enabled: boolean }).enabled = false;

  let round = 0;
  const fake = {
    name,
    priority: -1,
    enabled: true,
    timeout: 20_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => {
      const step = rounds[Math.min(round, rounds.length - 1)];
      round += 1;
      return {
        text: step.text ?? "",
        provider: name,
        model: "scripted",
        processingTime: 1,
        ...(step.toolCalls ? { toolCalls: step.toolCalls } : {}),
        metadata: {},
      };
    },
  };
  registry.register(fake as never);
  await registry.initialize();
  return () => {
    (fake as { enabled: boolean }).enabled = false;
    for (const provider of suspended) (provider as { enabled: boolean }).enabled = true;
  };
}

test("a premature DONE: does not complete an objective whose requirements are unmet", async () => {
  // EXACTLY THE LIVE FAILURE, made deterministic: the objective names
  // two operations, the model performs one and declares victory.
  const path = `verification/${Date.now()}.txt`;
  const restore = await scripted("PrematureDoneProvider", [
    { toolCalls: [{ id: "t1", name: "sandbox_write", arguments: { path, content: "half the work" } }] },
    { text: "DONE: the note is written, so the objective is complete." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = store.create({
    agentId: liveAgent,
    source: "user",
    objective: `Write the note with sandbox_write, then read it back with sandbox_read to prove it is there.`,
  });

  const outcome = await runtime.runCycle(objective.id, "test:premature");
  assert.ok(outcome, "the cycle did not run");
  assert.ok(
    outcome.executed.some((entry) => entry.tool === "sandbox_write" && entry.ok),
    "the first operation was supposed to really happen",
  );

  const after = store.get(objective.id)!;
  assert.notEqual(after.state, "completed", "the model said DONE and the runtime believed it");
  assert.equal(after.state, "active", `the objective should carry on, not stop: ${after.state}`);

  // The rejection is recorded, with what was and was not observed.
  assert.equal(outcome.verification?.verdict, "incomplete");
  assert.ok(
    outcome.verification?.missing.some((entry) => /sandbox[._]read/.test(entry)),
    `the record does not name what is missing: ${JSON.stringify(outcome.verification?.missing)}`,
  );
  assert.ok(
    outcome.verification?.observed.some((entry) => /sandbox[._]write/.test(entry)),
    "the record does not credit the work that really happened",
  );

  // And the next cycle is told precisely what is missing, through the
  // existing nudge — no new mechanism.
  assert.match(after.nudge ?? "", /sandbox[._]read/, "the next decision is not told what is outstanding");

  restore();
  runtime.stop();
  store.yieldObjective(objective.id, "cancelled", "test cleanup");
});

test("and the same objective completes once the remaining work really happens", async () => {
  const path = `verification/${Date.now()}-full.txt`;
  const restore = await scripted("CompletesProperlyProvider", [
    { toolCalls: [{ id: "t1", name: "sandbox_write", arguments: { path, content: "all of it" } }] },
    { toolCalls: [{ id: "t2", name: "sandbox_read", arguments: { path } }] },
    { text: "DONE: written and read back, both confirmed." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = store.create({
    agentId: liveAgent,
    source: "user",
    objective: `Write the note with sandbox_write, then read it back with sandbox_read to prove it is there.`,
  });

  const outcome = await runtime.runCycle(objective.id, "test:complete");
  assert.ok(outcome);
  assert.equal(store.get(objective.id)?.state, "completed", `verification rejected real work: ${outcome.verification?.reason}`);
  assert.equal(outcome.verification?.verdict, "complete");
  assert.equal(outcome.verification?.missing.length, 0);

  restore();
  runtime.stop();
});

test("a reasoning-only objective still completes, with no tool anywhere near it", async () => {
  const restore = await scripted("ReasoningProvider", [
    {
      text:
        "DONE: recalled memories are injected into the prompt before the model reasons, " +
        "so what was stored earlier changes what is decided later.",
    },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = store.create({
    agentId: liveAgent,
    source: "user",
    objective: "Explain why the memory system can affect future turns.",
  });

  const outcome = await runtime.runCycle(objective.id, "test:reasoning");
  assert.ok(outcome);
  assert.equal(outcome.executed.length, 0, "this case is about an objective that needs no tool");
  assert.equal(
    store.get(objective.id)?.state,
    "completed",
    `a reasoning objective was turned into a tool checklist: ${outcome.verification?.reason}`,
  );

  restore();
  runtime.stop();
});

test("an objective blocked on the user waits and raises the existing question", async () => {
  const restore = await scripted("BlockedProvider", [
    { text: "DONE: all set." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const before = ProactiveCore.getInstance().listQuestions().length;
  const objective = store.create({
    agentId: liveAgent,
    source: "user",
    objective: "Book the appointment once the date is known.",
    expectedOutcomes: [
      { evidence: "user-information", what: "the date the user wants" },
    ],
  });

  const outcome = await runtime.runCycle(objective.id, "test:blocked");
  assert.ok(outcome);
  assert.equal(outcome.verification?.verdict, "blocked");
  assert.equal(store.get(objective.id)?.state, "waiting", "a blocked objective was not parked");
  assert.match(store.get(objective.id)?.waitingFor ?? "", /date/i);

  // The EXISTING question path, carrying the objective it belongs to.
  const questions = ProactiveCore.getInstance().listQuestions();
  assert.ok(questions.length > before, "nothing was asked, so the block cannot ever clear");
  const asked = questions.find((question) => question.objectiveId === objective.id);
  assert.ok(asked, "the question does not name the objective it came from");

  restore();
  runtime.stop();
  store.yieldObjective(objective.id, "cancelled", "test cleanup");
});

test("a real answer is not rejected for being short", () => {
  // The first version of this check required 24 characters and threw
  // out "nothing needed doing." — a complete answer to "decide whether
  // anything needs doing". Length was measuring the wrong thing.
  const result = verify({
    objective: objectiveWith("Decide whether anything needs doing."),
    conclusion: "nothing needed doing.",
  });
  assert.equal(result.verdict, "complete", result.reason);
});

test("but restating the claim of completion is still not an answer", () => {
  for (const empty of ["Done.", "ok", "Completed", "", "   ", "finished"]) {
    const result = verify({
      objective: objectiveWith("Decide whether anything needs doing."),
      conclusion: empty,
    });
    assert.equal(result.verdict, "incomplete", `"${empty}" was accepted as an answer`);
  }
});

test("a model that keeps claiming completion without acting is stopped by the EXISTING budgets", async () => {
  // The verifier says "not satisfied" and nothing else. Stopping is the
  // runtime's job, and it already had the means: a cycle that executed
  // nothing counts as a failure, and FAILURE_LIMIT consecutive
  // failures yield the objective. No new stop condition was added, and
  // this proves the loop cannot run forever on a stubborn model.
  const restore = await scripted("StubbornProvider", [
    { text: "DONE: I consider this finished." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = store.create({
    agentId: liveAgent,
    source: "user",
    objective: "Write the note with sandbox_write and read it back with sandbox_read.",
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && store.get(objective.id)?.state === "active") {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const final = store.get(objective.id)!;
  assert.notEqual(final.state, "completed", "a claim repeated often enough was eventually believed");
  assert.equal(final.state, "yielded", `expected the budget to stop it, got ${final.state}`);
  assert.equal(final.yieldReason, "repeated-failure", `stopped for the wrong reason: ${final.yieldReason}`);
  assert.ok(final.cyclesRun <= final.maxCycles, "the loop exceeded its own budget");

  restore();
  runtime.stop();
});
