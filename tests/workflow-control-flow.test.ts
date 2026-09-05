/**
 * ==========================================================
 * LÉLU — WORKFLOW AUTHORING AND CONTROL FLOW
 *
 * CATEGORY: integration. NOTHING IS MOCKED. Every step here runs
 * through the real ToolDispatcher against the real ToolRegistry.
 *
 * Two real tools give this file its deterministic success and
 * failure paths, without a stub anywhere:
 *   • project.manage — persists through KvStore, so it really
 *     succeeds in this runtime;
 *   • memory.store — needs IndexedDB for the long-term store,
 *     which this runtime does not have, so it really fails.
 * A failure produced by a tool actually refusing is worth more
 * than one produced by a fake that was told to refuse.
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

import WorkflowStore from "../src/core/workflows/WorkflowStore";
import WorkflowEngine, {
  MAX_ITERATIONS,
  MAX_STEP_EXECUTIONS,
  evaluateCondition,
  resolveArguments,
} from "../src/core/workflows/WorkflowEngine";
import AgentWorkflowBridge from "../src/core/workflows/AgentWorkflowBridge";
import {
  authorWorkflow,
  validateWorkflow,
  MAX_STEPS,
} from "../src/core/workflows/WorkflowAuthoring";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";

const store = WorkflowStore.getInstance();
const engine = WorkflowEngine.getInstance();

ToolRegistry.getInstance().updateAvailability("project.manage", true);

/** A step that really succeeds in this runtime. */
const succeeds = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `succeeding ${id}`,
  tool: "project.manage",
  arguments: { action: "list" },
  dependsOn: [] as string[],
  ...extra,
});

/** A step that really fails in this runtime — the tool refuses for real. */
const fails = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `failing ${id}`,
  tool: "memory.store",
  arguments: { summary: "control-flow probe" },
  dependsOn: [] as string[],
  ...extra,
});

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

/* ====================================================================
 * §5 — BRANCHING
 * ==================================================================== */

test("a condition decides which branch runs, and the untaken branch is skipped with the reason", async () => {
  const workflow = store.define({
    name: unique("branch"),
    description: "One branch runs, the other is not taken.",
    steps: [
      succeeds("probe"),
      succeeds("taken", {
        dependsOn: ["probe"],
        condition: { step: "probe", operator: "succeeded" },
      }),
      succeeds("untaken", {
        dependsOn: ["probe"],
        condition: { step: "probe", operator: "failed" },
      }),
      succeeds("after-untaken", { dependsOn: ["untaken"] }),
    ],
  });

  const run = await engine.run(workflow.id);
  const by = (id: string) => run.steps.find((step) => step.stepId === id);

  assert.equal(by("taken")?.status, "succeeded", "the taken branch did not run");
  assert.equal(by("untaken")?.status, "skipped", "the untaken branch ran anyway");
  assert.match(String(by("untaken")?.reason), /Condition not met/);
  // A branch not taken carries its dependants with it.
  assert.equal(by("after-untaken")?.status, "skipped");
  // Skipping a branch is not a failure: the workflow did what it said.
  assert.equal(run.status, "succeeded");
});

test("a condition is evaluated against real recorded results, never against intent", () => {
  const completed = new Map([
    ["a", { stepId: "a", name: "a", tool: "t", status: "succeeded" as const, input: {}, output: "Hello World" }],
  ]);
  assert.equal(evaluateCondition({ step: "a", operator: "succeeded" }, completed).met, true);
  assert.equal(evaluateCondition({ step: "a", operator: "failed" }, completed).met, false);
  assert.equal(evaluateCondition({ step: "a", operator: "contains", value: "world" }, completed).met, true);
  assert.equal(evaluateCondition({ step: "a", operator: "not-contains", value: "world" }, completed).met, false);
  assert.equal(evaluateCondition({ step: "a", operator: "not-empty" }, completed).met, true);
  // A step that never ran cannot satisfy anything, and says why.
  const absent = evaluateCondition({ step: "ghost", operator: "succeeded" }, completed);
  assert.equal(absent.met, false);
  assert.match(absent.detail, /has not run/);
});

/* ====================================================================
 * §5 — RETRY
 * ==================================================================== */

test("a failing step is really re-attempted, and the record says how many times", async () => {
  const workflow = store.define({
    name: unique("retry"),
    description: "The tool genuinely refuses; the step retries the real call.",
    steps: [fails("flaky", { retry: { maxAttempts: 3 } })],
  });

  const run = await engine.run(workflow.id);
  const step = run.steps.find((entry) => entry.stepId === "flaky");

  assert.equal(step?.status, "failed");
  assert.equal(step?.attempts, 3, "the step did not really re-attempt");
  assert.match(String(step?.reason), /after 3 attempt/);
  // Retrying is not succeeding. Three failures are still a failure.
  assert.equal(run.status, "failed");
});

test("a retry filter that does not match the real error stops retrying", async () => {
  const workflow = store.define({
    name: unique("retry-filter"),
    description: "Only a matching error text is worth re-sending.",
    steps: [fails("selective", { retry: { maxAttempts: 4, when: "rate limit" } })],
  });

  const run = await engine.run(workflow.id);
  assert.equal(run.steps[0]?.attempts, 1, "retried a failure it was told not to retry");
});

/* ====================================================================
 * §5 — LOOPING
 * ==================================================================== */

test("a loop stops as soon as its condition really holds", async () => {
  const workflow = store.define({
    name: unique("loop-satisfied"),
    description: "Repeat until the step produces output.",
    steps: [
      succeeds("work", { loop: { until: { step: "work", operator: "not-empty" }, maxIterations: 5 } }),
    ],
  });

  const run = await engine.run(workflow.id);
  const iterations = run.steps.filter((step) => step.stepId === "work");
  assert.equal(iterations.length, 1, "looped past a satisfied condition");
  assert.equal(iterations[0].iteration, 1);
  assert.match(String(iterations[0].reason), /Loop condition satisfied/);
  assert.equal(run.status, "succeeded");
});

test("a loop that never satisfies its condition ends at its bound and says so", async () => {
  const workflow = store.define({
    name: unique("loop-bounded"),
    description: "A condition that can never hold must still terminate.",
    steps: [
      succeeds("grind", {
        loop: { until: { step: "grind", operator: "contains", value: "zzz-never-present" }, maxIterations: 3 },
      }),
    ],
  });

  const run = await engine.run(workflow.id);
  const iterations = run.steps.filter((step) => step.stepId === "grind");
  assert.equal(iterations.length, 3, "the loop did not run its full bound");
  assert.deepEqual(iterations.map((step) => step.iteration), [1, 2, 3]);
  // Reaching the ceiling is never dressed up as satisfying the goal.
  assert.match(String(iterations[2].reason), /maximum of 3 iteration/);
});

test("a loop step may revise its own previous output; the first iteration starts empty", () => {
  const completed = new Map();
  const first = resolveArguments({ text: "draft: {{steps.me.output}}" }, completed, {}, "me");
  assert.deepEqual(first.missing, [], "the first iteration was treated as a missing dependency");
  assert.equal(first.resolved.text, "draft: ");

  completed.set("me", { stepId: "me", name: "me", tool: "t", status: "succeeded", input: {}, output: "v1" });
  const second = resolveArguments({ text: "draft: {{steps.me.output}}" }, completed, {}, "me");
  assert.equal(second.resolved.text, "draft: v1", "the loop could not read its own last output");
});

/* ====================================================================
 * §5 — FAILURE PATHS, TERMINATION AND ESCALATION
 * ==================================================================== */

test("a failure policy of continue records the failure without failing the run", async () => {
  const workflow = store.define({
    name: unique("continue"),
    description: "A step that may fail without stopping the work.",
    steps: [
      fails("optional-probe", { onFailure: { action: "continue" } }),
      succeeds("real-work"),
    ],
  });

  const run = await engine.run(workflow.id);
  assert.equal(run.steps.find((s) => s.stepId === "optional-probe")?.status, "failed");
  assert.equal(run.steps.find((s) => s.stepId === "real-work")?.status, "succeeded");
  assert.equal(run.status, "succeeded");
});

test("a failure policy of stop ends the run, and the remaining steps say they did not run", async () => {
  const workflow = store.define({
    name: unique("stop"),
    description: "A failure that makes the rest of the work pointless.",
    steps: [fails("blocker"), succeeds("later", { dependsOn: [] })],
  });
  // Declared after define so the policy is on the stored definition.
  const stored = store.get(workflow.id)!;
  stored.steps[0].onFailure = { action: "stop" };
  store.define(stored);

  const run = await engine.run(workflow.id);
  const later = run.steps.find((step) => step.stepId === "later");
  assert.equal(later?.status, "skipped");
  assert.match(String(later?.reason), /Stopped by/);
  assert.ok(run.terminatedBy, "the run did not record why it stopped");
  assert.equal(run.terminatedBy?.stepId, "blocker");
});

test("an escalating failure hands the run to a person, as real recorded state", async () => {
  const workflow = store.define({
    name: unique("escalate"),
    description: "A failure the workflow is not allowed to decide about.",
    steps: [
      fails("needs-a-human", {
        onFailure: {
          action: "escalate",
          escalate: "Long-term memory is unavailable — should this run without it?",
        },
      }),
      succeeds("downstream"),
    ],
  });

  const run = await engine.run(workflow.id);
  assert.equal(run.status, "escalated");
  assert.equal(run.steps.find((s) => s.stepId === "needs-a-human")?.status, "escalated");
  assert.ok(run.escalation, "no escalation was recorded");
  assert.match(String(run.escalation?.request), /should this run without it/);
  // The real failure text travels with the request, so a person can decide.
  assert.ok(String(run.escalation?.failure).length > 0);
  assert.equal(run.steps.find((s) => s.stepId === "downstream")?.status, "skipped");

  // It survives, because a decision may come later.
  assert.equal(store.execution(run.id)?.escalation?.stepId, "needs-a-human");
});

test("a termination condition ends a run early on purpose, distinct from failing", async () => {
  const workflow = store.define({
    name: unique("terminate"),
    description: "Stop as soon as the goal is already met.",
    steps: [
      succeeds("check", { terminateWhen: { step: "check", operator: "succeeded" } }),
      succeeds("expensive-work"),
    ],
  });

  const run = await engine.run(workflow.id);
  assert.equal(run.steps.find((s) => s.stepId === "check")?.status, "succeeded");
  const skipped = run.steps.find((s) => s.stepId === "expensive-work");
  assert.equal(skipped?.status, "skipped");
  assert.match(String(skipped?.reason), /Terminated after/);
  // Early termination is a success, not a failure.
  assert.equal(run.status, "succeeded");
  assert.match(run.summary, /Terminated after/);
});

test("control flow is bounded: a run cannot exceed the tool-invocation ceiling", async () => {
  const looping = Array.from({ length: 12 }, (_unused, index) =>
    succeeds(`s${index}`, {
      loop: {
        until: { step: `s${index}`, operator: "contains", value: "zzz-never-present" },
        maxIterations: MAX_ITERATIONS,
      },
    }),
  );
  const workflow = store.define({
    name: unique("bounded"),
    description: "12 steps that each want 10 iterations — 120 invocations if unbounded.",
    steps: looping,
  });

  const run = await engine.run(workflow.id);
  const executed = run.steps.filter((step) => step.attempts !== undefined).length;
  assert.ok(
    executed <= MAX_STEP_EXECUTIONS,
    `ran ${executed} invocations, above the ceiling of ${MAX_STEP_EXECUTIONS}`,
  );
  assert.match(String(run.terminatedBy?.reason ?? ""), /ceiling/);
});

/* ====================================================================
 * §4 — AUTHORING: VALIDATED, NEVER EXECUTABLE
 * ==================================================================== */

test("a workflow may only name tools that already exist", () => {
  const result = validateWorkflow({
    name: unique("invented"),
    description: "Tries to invoke something that does not exist.",
    outputs: "nothing",
    steps: [{ id: "a", name: "a", tool: "totally.invented", arguments: {} }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /no tool "totally\.invented" is registered/i);
});

test("a step carrying anything code-shaped is rejected outright", () => {
  const result = validateWorkflow({
    name: unique("smuggle"),
    description: "Attempts to smuggle executable content into a definition.",
    outputs: "nothing",
    steps: [
      {
        id: "a",
        name: "a",
        tool: "project.manage",
        arguments: { action: "list" },
        run: "async () => { return 1; }",
        eval: "process.exit(0)",
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /unknown property "run"/);
  assert.match(result.errors.join(" "), /unknown property "eval"/);
});

test("a reference that would not exist at run time is rejected before storing", () => {
  const dangling = validateWorkflow({
    name: unique("dangling"),
    description: "Reads a step it does not depend on.",
    outputs: "nothing",
    steps: [
      { id: "a", name: "a", tool: "project.manage", arguments: { action: "list" } },
      { id: "b", name: "b", tool: "project.manage", arguments: { action: "list", note: "{{steps.a.output}}" } },
    ],
  });
  assert.equal(dangling.ok, false);
  assert.match(dangling.errors.join(" "), /without depending on it/);

  const undeclaredInput = validateWorkflow({
    name: unique("undeclared"),
    description: "Uses an input the workflow never declared.",
    outputs: "nothing",
    steps: [
      { id: "a", name: "a", tool: "project.manage", arguments: { action: "list", note: "{{input.topic}}" } },
    ],
  });
  assert.equal(undeclaredInput.ok, false);
  assert.match(undeclaredInput.errors.join(" "), /does not declare/);
});

test("unbounded and malformed control flow is rejected", () => {
  const result = validateWorkflow({
    name: unique("unbounded"),
    description: "A loop with no real bound and an escalation with nothing to decide.",
    outputs: "nothing",
    steps: [
      {
        id: "a",
        name: "a",
        tool: "project.manage",
        arguments: { action: "list" },
        loop: { until: { step: "a", operator: "contains", value: "x" }, maxIterations: 9999 },
        onFailure: { action: "escalate" },
      },
    ],
  });
  assert.equal(result.ok, false);
  const joined = result.errors.join(" ");
  assert.match(joined, new RegExp(`from 1 to ${MAX_ITERATIONS}`));
  assert.match(joined, /must say exactly what a person is being asked to decide/);
});

test("a dependency cycle is caught at authoring, not discovered as a dead run", () => {
  const result = validateWorkflow({
    name: unique("cycle"),
    description: "Two steps that wait for each other forever.",
    outputs: "nothing",
    steps: [
      { id: "x", name: "x", tool: "project.manage", arguments: { action: "list" }, dependsOn: ["y"] },
      { id: "y", name: "y", tool: "project.manage", arguments: { action: "list" }, dependsOn: ["x"] },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /dependency cycle/);
});

test("an invalid draft is never persisted", () => {
  const before = store.list().length;
  const result = authorWorkflow({
    name: unique("rejected"),
    description: "Invalid, and therefore must not exist afterwards.",
    outputs: "nothing",
    steps: [{ id: "a", name: "a", tool: "totally.invented", arguments: {} }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.workflow, undefined);
  assert.equal(store.list().length, before, "a rejected draft was stored anyway");
});

test("a valid authored workflow is stored once and becomes discoverable to every later objective", () => {
  const name = unique("authored");
  const result = authorWorkflow({
    name,
    description: "Look at the projects that exist, then look again with context.",
    outputs: "A listing of the projects that currently exist.",
    inputs: [{ name: "note", description: "Why the listing is being taken.", required: false }],
    steps: [
      { id: "first", name: "list projects", tool: "project.manage", arguments: { action: "list" } },
      {
        id: "second",
        name: "confirm",
        tool: "project.manage",
        arguments: { action: "list", note: "{{input.note}} after {{steps.first.output}}" },
        dependsOn: ["first"],
        condition: { step: "first", operator: "succeeded" },
        retry: { maxAttempts: 2 },
      },
    ],
  });

  assert.equal(result.ok, true, result.errors.join(" "));
  assert.ok(result.workflow);
  // Discoverable through the SAME surface cognition already reads.
  const offer = AgentWorkflowBridge.getInstance().discover().find((entry) => entry.name === name);
  assert.ok(offer, "an authored workflow was not discoverable");
  assert.equal(offer.runnable, true, offer.blockers.join("; "));
  assert.match(AgentWorkflowBridge.getInstance().describeCapabilities(), new RegExp(name));

  // Re-authoring under the same name is refused rather than silently
  // replacing something that already exists.
  const clash = authorWorkflow({
    name,
    description: "A different workflow that happens to share a name.",
    outputs: "something else",
    steps: [{ id: "a", name: "a", tool: "project.manage", arguments: { action: "list" } }],
  });
  assert.equal(clash.ok, false);
  assert.match(clash.errors.join(" "), /already exists/);
});

test("an authored workflow really runs, control flow and all", async () => {
  const authored = authorWorkflow({
    name: unique("authored-runnable"),
    description: "Authored as data, then executed through the real dispatcher.",
    outputs: "The project listing.",
    steps: [
      { id: "look", name: "look", tool: "project.manage", arguments: { action: "list" } },
      {
        id: "again",
        name: "look again",
        tool: "project.manage",
        arguments: { action: "list" },
        dependsOn: ["look"],
        condition: { step: "look", operator: "succeeded" },
      },
    ],
  });
  assert.equal(authored.ok, true, authored.errors.join(" "));

  const run = await engine.run(authored.workflow!.id);
  assert.equal(run.status, "succeeded");
  assert.equal(run.steps.filter((step) => step.status === "succeeded").length, 2);
  assert.ok(run.finalResult, "an authored workflow produced no real result");
});

test("authoring is reachable through the one tool dispatcher, and reports real problems", async () => {
  const bad = await dispatchToolCall(
    {
      id: "author-bad",
      name: "workflow_author",
      arguments: {
        name: unique("via-tool-bad"),
        description: "Names a tool that does not exist.",
        outputs: "nothing",
        steps: [{ id: "a", name: "a", tool: "not.a.real.tool", arguments: {} }],
      },
    },
    "test-authoring",
  );
  assert.equal(bad.ok, false);
  assert.match(bad.content, /was NOT created/);

  const name = unique("via-tool-good");
  const good = await dispatchToolCall(
    {
      id: "author-good",
      name: "workflow_author",
      arguments: {
        name,
        description: "A real, runnable, single-step workflow authored through the tool.",
        outputs: "The project listing.",
        steps: [{ id: "a", name: "list", tool: "project.manage", arguments: { action: "list" } }],
      },
    },
    "test-authoring",
  );
  assert.equal(good.ok, true, good.content);
  assert.ok(store.list().some((workflow) => workflow.name === name), "the tool did not persist it");
});

test("authoring limits are real limits", () => {
  const tooMany = validateWorkflow({
    name: unique("huge"),
    description: "More steps than the substrate accepts.",
    outputs: "nothing",
    steps: Array.from({ length: MAX_STEPS + 1 }, (_unused, index) => ({
      id: `s${index}`,
      name: `s${index}`,
      tool: "project.manage",
      arguments: { action: "list" },
    })),
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors.join(" "), new RegExp(`more than ${MAX_STEPS}`));
});
