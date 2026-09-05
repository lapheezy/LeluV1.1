/**
 * ==========================================================
 * LÉLU — REUSABLE WORKFLOWS (audit finding 4)
 *
 * CATEGORY: integration. Steps run through the REAL
 * ToolDispatcher against the REAL ToolRegistry — the same path a
 * model's native tool call takes. Nothing is stubbed; the only
 * substitute is a storage shim so KvStore works outside a browser.
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
import WorkflowEngine, { orderSteps, resolveArguments } from "../src/core/workflows/WorkflowEngine";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import AgentEventBus from "../src/core/agent/AgentEvents";
// NOTE ON TOOL CHOICE. The memory tools were tried first and the engine
// correctly reported them as FAILED steps: Brain's long-term store needs
// IndexedDB, which this runtime does not have, so consolidate() really
// does refuse. That is the engine working — it surfaced a genuine tool
// failure rather than reporting a step it had not performed. The steps
// below use project.manage, which persists through KvStore and therefore
// genuinely executes here.

/* --------------------------- step ordering --------------------------- */

test("dependencies decide the order, and a cycle is reported rather than hung on", () => {
  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "ordering",
    description: "c depends on b depends on a",
    steps: [
      { id: "c", name: "third", tool: "memory.store", arguments: {}, dependsOn: ["b"] },
      { id: "a", name: "first", tool: "memory.store", arguments: {}, dependsOn: [] },
      { id: "b", name: "second", tool: "memory.store", arguments: {}, dependsOn: ["a"] },
    ],
  });
  assert.deepEqual(orderSteps(workflow).order, ["a", "b", "c"]);
  assert.deepEqual(orderSteps(workflow).unresolvable, []);

  const cyclic = store.define({
    name: "cycle",
    description: "x and y depend on each other",
    steps: [
      { id: "x", name: "x", tool: "memory.store", arguments: {}, dependsOn: ["y"] },
      { id: "y", name: "y", tool: "memory.store", arguments: {}, dependsOn: ["x"] },
    ],
  });
  // A cycle can never become ready; saying so beats spinning.
  assert.deepEqual(orderSteps(cyclic).unresolvable.sort(), ["x", "y"]);
});

/* --------------------------- context passing --------------------------- */

test("a step reads an earlier step's real output", () => {
  const completed = new Map([
    ["one", { stepId: "one", status: "succeeded" as const, output: "REAL OUTPUT" }],
  ]);
  const { resolved, missing } = resolveArguments(
    { query: "about {{steps.one.output}} please" },
    completed,
  );
  assert.equal(resolved.query, "about REAL OUTPUT please");
  assert.deepEqual(missing, []);
});

test("a reference to a step that did not succeed is reported, not blanked", () => {
  const completed = new Map([
    ["one", { stepId: "one", status: "failed" as const, output: "" }],
  ]);
  // Substituting "" here would hand the next tool a confidently wrong
  // argument, and the workflow would look like it worked.
  const { missing } = resolveArguments({ query: "{{steps.one.output}}" }, completed);
  assert.deepEqual(missing, ["one"]);
});

/* --------------------------- real execution --------------------------- */

test("steps execute through the real dispatcher and carry context between them", async () => {
  ToolRegistry.getInstance().updateAvailability("project.manage", true);

  const marker = `wf-${Date.now().toString(36)}`;
  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "create then list",
    description: "Two real project tools, the second observing the first's effect.",
    steps: [
      {
        id: "write",
        name: "create a project",
        tool: "project.manage",
        arguments: { action: "create", name: `Workflow ${marker}` },
        dependsOn: [],
      },
      {
        id: "read",
        name: "list projects",
        tool: "project.manage",
        arguments: { action: "list" },
        dependsOn: ["write"],
      },
    ],
  });

  const events: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type.startsWith("tool_")) events.push(`${event.type}:${event.tool}`);
  });

  const run = await WorkflowEngine.getInstance().run(workflow.id);
  unsubscribe();

  const write = run.steps.find((step) => step.stepId === "write");
  assert.ok(write, "the first step did not run");
  assert.equal(write.status, "succeeded", `write failed: ${write.reason}`);
  // The output is the tool's own text, not a description of the step.
  assert.match(write.output, new RegExp(`Created project "Workflow ${marker}"`));

  // The second step OBSERVES the first step's real effect on the store.
  const read = run.steps.find((step) => step.stepId === "read");
  assert.equal(read?.status, "succeeded");
  assert.match(String(read?.output), new RegExp(marker),
    "the later step did not see what the earlier step actually did");

  // The events the timeline sees came from the dispatcher, not the engine.
  assert.ok(events.some((entry) => entry.includes("project.manage")), `no real tool events: ${events}`);

  // Persisted and resumable: the run is readable after the fact.
  const persisted = WorkflowStore.getInstance().execution(run.id);
  assert.ok(persisted, "the execution was not persisted");
  assert.equal(persisted.workflowId, workflow.id);
  assert.ok(persisted.finishedAt);
});

test("a step whose tool is unavailable is BLOCKED with the real reason, and dependants are skipped", async () => {
  const registry = ToolRegistry.getInstance();
  registry.updateAvailability("project.copy", false);

  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "needs a runtime",
    description: "The first step needs an engineering runtime that is not here.",
    steps: [
      { id: "copy", name: "copy project", tool: "project.copy", arguments: {}, dependsOn: [] },
      { id: "after", name: "depends on it", tool: "memory.store", arguments: { summary: "x" }, dependsOn: ["copy"] },
    ],
  });

  const run = await WorkflowEngine.getInstance().run(workflow.id);
  const copy = run.steps.find((step) => step.stepId === "copy");
  const after = run.steps.find((step) => step.stepId === "after");

  // Blocked, not "skipped" and certainly not "done": the difference is
  // whether LÉLU can claim the step happened.
  assert.equal(copy?.status, "blocked");
  assert.match(String(copy?.reason), /not available in this runtime/);
  assert.equal(after?.status, "skipped");
  assert.match(String(after?.reason), /did not succeed/);
  assert.equal(run.status, "failed");
  assert.match(run.summary, /Blocked/);
});

test("an optional step's failure does not fail the workflow", async () => {
  ToolRegistry.getInstance().updateAvailability("project.manage", true);
  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "optional",
    description: "One optional blocked step, one real step.",
    steps: [
      { id: "maybe", name: "optional", tool: "nope.missing", arguments: {}, dependsOn: [], optional: true },
      { id: "real", name: "real", tool: "project.manage", arguments: { action: "list" }, dependsOn: [] },
    ],
  });
  const run = await WorkflowEngine.getInstance().run(workflow.id);
  assert.equal(run.steps.find((s) => s.stepId === "maybe")?.status, "blocked");
  assert.equal(run.steps.find((s) => s.stepId === "real")?.status, "succeeded");
  assert.equal(run.status, "succeeded");
});

test("workflows are reusable — a definition survives and runs again", async () => {
  const store = WorkflowStore.getInstance();
  const listed = store.list();
  assert.ok(listed.length > 0, "no workflow definitions persisted");
  const reusable = listed.find((workflow) => workflow.name === "optional");
  assert.ok(reusable, "the definition was not retrievable by a later reader");

  const second = await WorkflowEngine.getInstance().run(reusable.id);
  assert.equal(second.status, "succeeded");
  // Each run is its own record, so history is preserved.
  assert.ok(store.executions(reusable.id).length >= 2);
});

/* ------------------------------------------------------------------ *
 * EXECUTION BRIDGE — agent invocation, native tools, cognition
 * ------------------------------------------------------------------ */

import AgentWorkflowBridge, { describeExecution } from "../src/core/workflows/AgentWorkflowBridge";
import AgentStore from "../src/core/agents/AgentStore";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";

test("execution state records everything needed to explain a run", async () => {
  ToolRegistry.getInstance().updateAvailability("project.manage", true);
  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "state capture",
    description: "One real step.",
    steps: [{ id: "only", name: "list projects", tool: "project.manage", arguments: { action: "list" }, dependsOn: [] }],
  });

  const run = await WorkflowEngine.getInstance().run(workflow.id, {
    kind: "agent", agentId: "agent-x", reason: "checking state",
  });

  // Everything finding 5 requires, from the real record.
  assert.ok(run.id, "no invocation id");
  assert.equal(run.workflowId, workflow.id);
  assert.equal(run.workflowName, "state capture");
  assert.equal(run.currentStepId, null, "a finished run still claims a current step");
  assert.deepEqual(run.pendingStepIds, [], "pending steps were not drained");
  assert.equal(run.origin.kind, "agent");
  assert.equal(run.origin.agentId, "agent-x");
  assert.ok(run.startedAt && run.finishedAt);

  const step = run.steps[0];
  assert.deepEqual(step.input, { action: "list" }, "the resolved tool input was not recorded");
  assert.equal(step.tool, "project.manage");
  assert.equal(step.name, "list projects");
  assert.ok(step.output.length > 0);
  // The final result is the last succeeding step's real output.
  assert.equal(run.finalResult, step.output);
});

test("a run where nothing succeeded has NO result, rather than an empty one", async () => {
  const store = WorkflowStore.getInstance();
  const workflow = store.define({
    name: "all blocked",
    description: "Its only step calls a tool that does not exist.",
    steps: [{ id: "x", name: "missing", tool: "nope.absent", arguments: {}, dependsOn: [] }],
  });
  const run = await WorkflowEngine.getInstance().run(workflow.id);
  assert.equal(run.status, "failed");
  // "" would read as a result the workflow produced.
  assert.equal(run.finalResult, null);
});

test("an AgentStore agent can discover, invoke and receive a workflow result", async () => {
  ToolRegistry.getInstance().updateAvailability("project.manage", true);
  const agents = AgentStore.getInstance();
  const agent = agents.create({ name: "Workflow Runner" });

  const bridge = AgentWorkflowBridge.getInstance();
  const offers = bridge.discover();
  assert.ok(offers.length > 0, "the agent discovered no workflows");
  // Discovery reports real blockers, so a chosen workflow can actually run.
  const runnable = offers.find((offer) => offer.runnable);
  assert.ok(runnable, `no runnable workflow offered: ${JSON.stringify(offers.map((o) => o.blockers))}`);

  // Preflight reports whether a tool is AVAILABLE and permitted, which
  // is not a promise that it will succeed — the memory tools preflight
  // fine here and then genuinely fail for want of IndexedDB. Target a
  // workflow known to execute in this runtime so the assertion is about
  // the bridge rather than about that distinction.
  const outcome = await bridge.runForAgent(agent.id, "state capture", "unit test invocation");
  assert.equal(outcome.ok, true, outcome.error);
  assert.ok(outcome.execution, "the agent received no execution");
  assert.equal(outcome.execution.origin.agentId, agent.id);

  // Recorded in the agent's OWN history through the existing API.
  const stored = agents.get(agent.id);
  assert.ok(stored);
  const record = stored.executions.find((entry) => entry.taskId === outcome.execution!.id);
  assert.ok(record, "the run is missing from the agent's execution history");
  assert.equal(record.provider, "workflow");
  // The record explains the run rather than merely asserting it happened.
  assert.match(record.result, /Workflow “/);
  assert.match(record.result, /→ succeeded/);

  // And the agent can find its own runs afterwards.
  assert.ok(bridge.executionsForAgent(agent.id).length > 0);
});

test("workflows are offered through the same native tool surface as everything else", () => {
  const offered = toolSchemasForModel().map((schema) => schema.name);
  // Not a chat-only path: they go through ToolSchemas like every tool.
  assert.ok(offered.includes("workflow_list"), `workflow_list not offered: ${offered.join(",")}`);
  assert.ok(offered.includes("workflow_run"));
  assert.ok(offered.includes("workflow_status"));
});

test("the native workflow tools list, run and report real state", async () => {
  ToolRegistry.getInstance().updateAvailability("project.manage", true);

  const listed = await dispatchToolCall({ id: "t1", name: "workflow_list", arguments: {} }, "test");
  assert.equal(listed.ok, true);
  assert.match(listed.content, /step\(s\)/);

  const ran = await dispatchToolCall(
    { id: "t2", name: "workflow_run", arguments: { workflow: "state capture", reason: "native tool test" } },
    "test",
  );
  assert.equal(ran.ok, true, ran.content);
  // The model receives the step-by-step account, not a verdict.
  assert.match(ran.content, /Workflow “state capture” — SUCCEEDED/);
  assert.match(ran.content, /\[project\.manage\] → succeeded/);
  const invocationId = (ran.data as { invocationId: string }).invocationId;
  assert.ok(invocationId);

  // State is readable back by invocation id.
  const status = await dispatchToolCall(
    { id: "t3", name: "workflow_status", arguments: { invocationId } },
    "test",
  );
  assert.equal(status.ok, true);
  assert.match(status.content, /state capture/);
});

test("a failing workflow is reported to the model AS a failure, with the reason", async () => {
  ToolRegistry.getInstance().updateAvailability("project.copy", false);
  const store = WorkflowStore.getInstance();
  store.define({
    name: "will fail",
    description: "Needs an engineering runtime that is absent.",
    steps: [{ id: "c", name: "copy", tool: "project.copy", arguments: {}, dependsOn: [] }],
  });

  const ran = await dispatchToolCall(
    { id: "t4", name: "workflow_run", arguments: { workflow: "will fail" } },
    "test",
  );
  // Never silently swallowed: ok:false, and the real blocker in the text
  // so cognition can decide to retry, fall back, or stop.
  assert.equal(ran.ok, false);
  assert.match(ran.content, /FAILED/);
  assert.match(ran.content, /not available in this runtime/);
});

test("asking for a workflow that does not exist names the ones that do", async () => {
  const ran = await dispatchToolCall(
    { id: "t5", name: "workflow_run", arguments: { workflow: "no such workflow" } },
    "test",
  );
  assert.equal(ran.ok, false);
  assert.match(ran.content, /No workflow matches/);
  assert.match(ran.content, /Known workflows:/);
});

test("cognition sees what actually ran", async () => {
  const { buildCognitiveContext, formatCognitiveContext } = await import(
    "../src/core/cognition/CognitiveContext"
  );
  const text = formatCognitiveContext(buildCognitiveContext());
  const section = text.split("## WORKFLOW ACTIVITY")[1]?.split("##")[0] ?? "";
  assert.ok(section.includes("workflow(s) defined"), "cognition has no workflow section");
  // Real runs, named, with their outcome — not a count of intentions.
  assert.match(section, /“state capture”|“will fail”|“optional”/);
  assert.match(section, /succeeded|failed|partial/);
});
