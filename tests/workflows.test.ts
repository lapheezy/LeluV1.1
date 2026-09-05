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
