/**
 * ==========================================================
 * LÉLU — COGNITION'S DECISION BECOMES REAL WORK
 *
 * CATEGORY: integration. Real CognitiveLoop, real
 * AgentObjectives, real AgentCognitionRuntime, real
 * ToolDispatcher, real SandboxFS.
 *
 * MOCKED-MODEL, and precisely that: a fake PROVIDER is
 * registered in the real AIProviderRegistry so the model's
 * CHOICE of tool is substituted, while everything downstream of
 * the choice — ProviderResolver.generateWithTools, the offered
 * tool schemas, dispatchToolCall, the executor, the sandbox
 * write, the tool result going back into the conversation, and
 * the runtime's evaluation of metadata.toolsExecuted — runs for
 * real. Nothing asserts that work happened because a model said
 * so; the sandbox file either exists or it does not.
 *
 * The property being pinned: the gap this whole phase exists to
 * close. AgentCognitionRuntime was a complete autonomous
 * executor — deliberate() with tools, evaluation from
 * toolsExecuted, duplicate detection, DONE/BLOCKED/SCHEDULE,
 * persisted continuation — and AgentObjectives.create() had no
 * caller anywhere in the product. It was called only by tests.
 * So the loop ran in its own test suite and never once in the
 * application: cognition's decisions went to a WorkQueue that
 * has no executor, and the executor read a store nobody wrote
 * to.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { after } from "node:test";

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
if (typeof sessionStorage === "undefined") {
  (globalThis as Record<string, unknown>).sessionStorage = globalThis.localStorage;
}

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import CognitiveLoop from "../src/core/cognition/CognitiveLoop";
import AgentStore from "../src/core/agents/AgentStore";
import ProjectStore from "../src/core/projects/ProjectStore";
import ProactiveCore from "../src/core/proactive/ProactiveCore";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import AIService from "../src/core/AIService";
import SandboxFS from "../src/core/engineering/SandboxFS";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

const objectives = AgentObjectives.getInstance();
const projects = ProjectStore.getInstance();
const proactive = ProactiveCore.getInstance();
const loop = CognitiveLoop.getInstance();

after(async () => {
  await stopBackgroundCognition();
  AgentCognitionRuntime.getInstance().stop();
});

/** A project with enough real state that intent is derivable without asking. */
function projectWithIntent(name: string) {
  const project = projects.create({
    name,
    description: `A real objective for ${name}: produce a first set of concepts.`,
  });
  projects.update(project.id, {
    checkpoint: {
      summary: `${name} is underway.`,
      nextAction: `Advance ${name} by drafting the first concept set.`,
      pending: [],
      updatedAt: Date.now(),
    },
  } as never);
  return projects.get(project.id)!;
}

/* ------------------------------------------------------------------ *
 * 1. THE BRIDGE: a derived decision becomes an executable objective
 * ------------------------------------------------------------------ */

test("cognition turns a derived next step into an objective the real runtime can run", async () => {
  proactive.updateSettings({ autonomousExecution: true });
  const project = projectWithIntent("Bridge Project");

  const before = objectives.list().length;
  await loop.runOnce();

  const created = objectives.list().find((item) => item.projectId === project.id);
  assert.ok(created, "cognition derived a next step and created no objective for it");
  assert.equal(objectives.list().length, before + 1);
  assert.equal(created.source, "cognition", "the objective must record that cognition created it");
  assert.equal(created.state, "active");
  assert.ok(created.objective.trim().length > 0);
  // The budgets exist so a runaway loop is impossible by construction.
  assert.ok(created.maxCycles > 0 && created.maxActions > 0 && created.deadline > Date.now());
  // And the WorkQueue record — the audit trail and the human view — is
  // still written. The bridge adds an executor; it replaces nothing.
  const { default: WorkQueue } = await import("../src/core/cognition/WorkQueue");
  assert.ok(
    WorkQueue.getInstance().list().some((item) => item.detail?.includes(`project:${project.id}`)),
    "the WorkQueue record was dropped instead of kept alongside the objective",
  );
});

test("a project whose own plan states an operation gives the objective that contract", async () => {
  proactive.updateSettings({ autonomousExecution: true });
  const project = projects.create({
    name: "Contract Project",
    description: "A project whose plan states which operation the next step needs.",
  });
  projects.update(project.id, {
    checkpoint: {
      summary: "Planned.",
      nextAction: "Run the routine this project authored.",
      pending: [],
      updatedAt: Date.now(),
    },
    // Structured state, not a description: the plan says which operation
    // this step performs, so the goal can state what completion means
    // before the first cycle.
    executionPlan: ["Run the authored routine with workflow_run."],
  } as never);

  await loop.runOnce();

  const created = objectives.list().find((item) => item.projectId === project.id);
  assert.ok(created, "cognition created no objective for a project with a derivable next step");
  assert.ok(
    created.expectedOutcomes?.length,
    "the objective carried no contract even though its project's plan stated the operation",
  );
  assert.ok(
    created.expectedOutcomes?.some((outcome) => outcome.tool === "workflow.run"),
    `the plan's operation did not reach the contract: ${JSON.stringify(created.expectedOutcomes)}`,
  );
});

test("a plan that names no dispatchable operation gives the objective no invented contract", async () => {
  proactive.updateSettings({ autonomousExecution: true });
  const project = projects.create({
    name: "Prose Only Project",
    description: "A project whose plan is written in prose and names no operation.",
  });
  projects.update(project.id, {
    checkpoint: {
      summary: "Planned.",
      nextAction: "Improve the project.",
      pending: [],
      updatedAt: Date.now(),
    },
    executionPlan: ["Improve the project and make the workspace nicer."],
  } as never);

  await loop.runOnce();

  const created = objectives.list().find((item) => item.projectId === project.id);
  assert.ok(created, "cognition created no objective for a project with a derivable next step");
  assert.equal(
    created.expectedOutcomes,
    undefined,
    `a verb became a tool requirement: ${JSON.stringify(created.expectedOutcomes)}`,
  );
});

test("one objective per project: a second cycle does not queue the same work again", async () => {
  proactive.updateSettings({ autonomousExecution: true });
  const project = projectWithIntent("Single Flight Project");

  await loop.runOnce();
  const first = objectives.list().filter((item) => item.projectId === project.id);
  assert.equal(first.length, 1, "the first cycle did not create exactly one objective");

  // The loop ticks every 10 seconds. Without the guard it would derive
  // the same next step on every tick, forever.
  await loop.runOnce();
  await loop.runOnce();

  const after = objectives.list().filter((item) => item.projectId === project.id);
  assert.equal(after.length, 1, `the guard let ${after.length} objectives exist for one project`);
  assert.equal(after[0].id, first[0].id, "the existing objective was replaced rather than continued");
});

test("work in flight is counted by state, so finished work stops blocking the project", () => {
  const project = projectWithIntent("Finished Work Project");
  const objective = objectives.create({
    agentId: AgentStore.getInstance().list()[0].id,
    objective: "Something to finish",
    source: "cognition",
    projectId: project.id,
  });
  assert.equal(objectives.hasWorkInFlight(project.id), true);

  objectives.complete(objective.id, "Done.");
  assert.equal(
    objectives.hasWorkInFlight(project.id),
    false,
    "a completed objective would block its project forever",
  );
});

test("with autonomous execution off, cognition still decides but runs nothing", async () => {
  proactive.updateSettings({ autonomousExecution: false });
  const project = projectWithIntent("Observer Only Project");

  await loop.runOnce();

  assert.equal(
    objectives.list().some((item) => item.projectId === project.id),
    false,
    "an objective was created with autonomous execution switched off",
  );
  // The point of the switch: thinking is not what it turns off.
  const { default: WorkQueue } = await import("../src/core/cognition/WorkQueue");
  assert.ok(
    WorkQueue.getInstance().list().some((item) => item.detail?.includes(`project:${project.id}`)),
    "with execution off, cognition stopped deriving the step at all",
  );
  proactive.updateSettings({ autonomousExecution: true });
});

/* ------------------------------------------------------------------ *
 * 2. EXECUTION: the tool really runs, and the result is observable
 * ------------------------------------------------------------------ */

test("the tool the model asks for really executes and really changes state", async () => {
  // No model at all here: this is the executor, called the way
  // ProviderResolver calls it, and checked against the side effect
  // rather than against a return string.
  const path = `autonomy-bridge/${Date.now()}.txt`;
  const content = "written by a real tool call";

  const write = await dispatchToolCall(
    { id: "call-write", name: "sandbox_write", arguments: { path, content } } as never,
    "autonomy-bridge-test",
  );
  assert.equal(write.ok, true, `the write failed: ${write.content}`);

  // The file exists in the real store, not merely in the reply.
  const node = SandboxFS.getInstance().list().find((entry) => entry.path === path);
  assert.ok(node, "the tool reported success and wrote nothing");

  const read = await dispatchToolCall(
    { id: "call-read", name: "sandbox_read", arguments: { path } } as never,
    "autonomy-bridge-test",
  );
  assert.equal(read.ok, true);
  assert.match(read.content, /written by a real tool call/);
});

test("a tool that is not permitted is refused with the real reason, not run", async () => {
  const result = await dispatchToolCall(
    { id: "call-apply", name: "project_apply", arguments: { paths: ["src/main.tsx"] } } as never,
    "autonomy-bridge-test",
  );
  assert.equal(result.ok, false, "project.apply ran without a human authorization");
  // Two refusals are both correct, and which one depends on the runtime:
  // with no development runtime serving /api/engineer the tool is not
  // available at all, and with one it needs a human grant. Either is
  // actionable; the refusal must name which, and must never be silent.
  assert.match(
    result.content,
    /authoriz|not available in this runtime/i,
    `the refusal gave no actionable reason: ${result.content}`,
  );
  assert.doesNotMatch(result.content, /applied|wrote|success/i, "a refusal implied the write happened");
});

/* ------------------------------------------------------------------ *
 * 3. THE RUNTIME CLOSES THE LOOP — model choice substituted, nothing else
 * ------------------------------------------------------------------ */

/**
 * ONE top-level test, two awaited subtests.
 *
 * Both of these swap providers in the real, shared AIProviderRegistry,
 * and node:test runs top-level tests CONCURRENTLY unless told otherwise.
 * Run in parallel they served each other's turns — the first run of this
 * file failed with an empty toolsExecuted and ClaimOnlyProvider's
 * metadata on the cycle under test. Awaited subtests are sequential by
 * construction, so the file is correct on its own and not only under
 * `--test-concurrency=1`.
 */
test("the runtime closes the loop on real results", async (t) => {
  await t.test("it executes the objective, observes the real result, and evaluates from it", async () => {
  const service = AIService.getInstance();
  await service.initialize();

  const path = `autonomy-bridge/runtime-${Date.now()}.txt`;
  const marker = `BRIDGE-${Date.now()}`;

  // A provider that asks for ONE real tool, then answers.
  //
  // It decides from the REQUEST rather than from a call counter, and
  // that is not fussiness either: cognition's own loops call
  // deliberate() too — CognitiveLoop.runOnce() starts SelfStudyEngine,
  // and the earlier tests in this file call runOnce() — so a shared
  // counter was consumed by another caller's turn and this cycle got
  // round two's text with no tool call in it. Keyed on the objective's
  // own marker and on whether a tool result is already in the
  // conversation, it answers correctly no matter who else is asking.
  const fake = {
    name: "BridgeTestProvider",
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
    generate: async (request: { prompt?: string; messages?: Array<{ role: string }> }) => {
      const mine =
        (request.prompt ?? "").includes(marker) ||
        JSON.stringify(request.messages ?? []).includes(marker);
      const toolAlreadyRan = (request.messages ?? []).some((entry) => entry.role === "tool");

      if (mine && !toolAlreadyRan) {
        return {
          text: "",
          provider: "BridgeTestProvider",
          model: "bridge-test",
          processingTime: 1,
          toolCalls: [
            {
              id: "call-1",
              name: "sandbox_write",
              arguments: { path, content: "the runtime really did this" },
            },
          ],
          metadata: {},
        };
      }
      if (mine) {
        return {
          text: "DONE: wrote the concept note to the sandbox and verified it is there.",
          provider: "BridgeTestProvider",
          model: "bridge-test",
          processingTime: 1,
          metadata: {},
        };
      }
      // Somebody else's turn — answer it without touching anything.
      return {
        text: "Acknowledged.",
        provider: "BridgeTestProvider",
        model: "bridge-test",
        processingTime: 1,
        metadata: {},
      };
    },
  };

  // ISOLATE THE PROVIDER.
  //
  // Not fastidiousness — the first run of this test passed its
  // "a tool executed" assertion and failed its "the file exists" one,
  // because a REAL provider served the turn and really called
  // sandbox_write with a path of its own choosing. The execution was
  // genuine; it just was not the one under test. Disabling the others
  // for the duration is what makes the assertion about the side effect
  // mean something.
  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = false;
  }
  registry.register(fake as never);
  await registry.initialize();

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();

  // runOnce() in the tests above restarts SelfStudyEngine, which drives
  // deliberate() on its own schedule. Quiet for this subtest so the only
  // cycle being measured is the one this test asked for.
  await stopBackgroundCognition();

  const project = projectWithIntent("Runtime Loop Project");
  const objective = objectives.create({
    agentId: AgentStore.getInstance().list()[0].id,
    objective: `Write a concept note for ${project.name} into the sandbox. [${marker}]`,
    source: "cognition",
    projectId: project.id,
  });

  const outcome = await runtime.runCycle(objective.id, "test:bridge");

  assert.ok(outcome, "the runtime declined to run the objective at all");

  // 1. A tool was offered. Not "a tool exists" — offered to this turn.
  assert.ok(toolSchemasForModel().length > 0, "no tool was offered to the model");

  // 2. It really executed, and the record of that is the EXECUTION, not the text.
  assert.ok(
    outcome.executed.some((entry) => entry.tool === "sandbox_write" && entry.ok),
    `toolsExecuted does not contain the real execution: ${JSON.stringify(outcome.executed)}`,
  );

  // 3. The side effect exists in the real store.
  const node = SandboxFS.getInstance().list().find((entry) => entry.path === path);
  assert.ok(node, "the cycle reported an execution that changed nothing");

  // 4. The result reached cognition's evaluation, and the objective moved.
  const settled = objectives.get(objective.id);
  assert.ok(settled);
  assert.equal(settled.state, "completed", `objective ended as ${settled.state}`);
  assert.ok(settled.actionsTaken > 0, "actions taken was not incremented from the real execution");
  assert.ok(settled.conclusion && settled.conclusion.length > 0);

  // 5. The cycle is on the record, with what ran.
  const cycles = objectives.cycles(objective.id);
  assert.ok(cycles.length > 0, "no cycle was recorded");
  assert.ok(
    cycles.some((cycle) => cycle.executed.some((entry) => entry.tool === "sandbox_write")),
    "the recorded cycle does not name the tool that ran",
  );

  (fake as { enabled: boolean }).enabled = false;
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = true;
  }
  runtime.stop();
  });

  await t.test("a completion is never inferred from the model's text alone", async () => {
  // A model that claims success and asks for nothing. The objective may
  // complete — DONE: is a legitimate conclusion — but actionsTaken must
  // stay at zero, because nothing was done. That is the distinction the
  // whole phase rests on: model output is not action.
  const service = AIService.getInstance();
  await service.initialize();

  const fake = {
    name: "ClaimOnlyProvider",
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
    generate: async () => ({
      text: "DONE: I have written all the files and run the tests; everything passes.",
      provider: "ClaimOnlyProvider",
      model: "claim-only",
      processingTime: 1,
      metadata: {},
    }),
  };

  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = false;
  }
  registry.register(fake as never);
  await registry.initialize();

  await stopBackgroundCognition();
  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId: AgentStore.getInstance().list()[0].id,
    objective: "Claim work without doing any.",
    source: "cognition",
  });

  const outcome = await runtime.runCycle(objective.id, "test:claim-only");
  assert.ok(outcome);
  assert.equal(outcome.executed.length, 0, "an execution was recorded for a model that ran nothing");
  assert.equal(
    objectives.get(objective.id)?.actionsTaken,
    0,
    "the model's claim of work was counted as work performed",
  );

  (fake as { enabled: boolean }).enabled = false;
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = true;
  }
  runtime.stop();
  });
});

/* ------------------------------------------------------------------ *
 * 4. L3 IS SANDBOX AUTONOMY, NOT PROJECT AUTHORITY
 * ------------------------------------------------------------------ */

test("the default autonomy level can verify sandbox work", () => {
  const gate = AutonomyGate.getInstance();
  // Default L3, because at L2 LÉLU could write code and not compile it:
  // WorkspaceRuntime requires L3 for typecheck, test and build.
  assert.ok(gate.can(3), `the default level is ${gate.getLevel()}, which cannot verify its own work`);
});

test("L3 does not grant real-project authority", async () => {
  const gate = AutonomyGate.getInstance();
  assert.equal(gate.getLevel() >= 3, true);

  const { toolPermitted } = await import("../src/core/tools/ToolDispatcher");
  // Sandbox work: permitted at this level.
  assert.equal(toolPermitted("sandbox.write"), true, "L3 cannot write to the sandbox");
  // The real project: a human grant, which no autonomy level satisfies.
  assert.equal(toolPermitted("project.apply"), false, "L3 granted apply authority");
  assert.equal(toolPermitted("project.commit"), false, "L3 granted commit authority");
});
