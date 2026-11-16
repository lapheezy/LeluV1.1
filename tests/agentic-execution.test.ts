/**
 * ==========================================================
 * LÉLU — AGENTIC EXECUTION
 *
 * CATEGORY: integration. The real TaskEngine, TaskExecutor,
 * ToolDispatcher, ApprovalGate, ToolStats, TaskPlanner,
 * TaskEvaluator and DailyReflection. Tools run for real:
 * project.manage writes through KvStore and a later step reads
 * the effect back; the other tools are registered at runtime
 * through registerExecutor — the extension point under test —
 * and count their own invocations. The only substitution is the
 * model: planner replies and reasoning steps are scripted, so
 * no network call is made.
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

import ToolRegistry, { type ToolDefinition } from "../src/core/tools/ToolRegistry";
import { dispatchToolCall, registerExecutor, unregisterExecutor, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import TaskEngine from "../src/core/tasks/TaskEngine";
import TaskExecutor, { interpolate, verifyOutput, type TaskProgress } from "../src/core/agentic/TaskExecutor";
import ApprovalGate from "../src/core/agentic/ApprovalGate";
import ToolStats from "../src/core/agentic/ToolStats";
import { registerAgenticTools } from "../src/core/agentic/AgenticTools";
import { listCapabilities, findCapabilities } from "../src/core/agentic/CapabilityCatalog";
import { createTask, planTask, validatePlan, type PlanStepInput } from "../src/core/agentic/TaskPlanner";
import TaskEvaluator from "../src/core/agentic/TaskEvaluator";
import DailyReflection from "../src/core/agentic/DailyReflection";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";
import SelfModel from "../src/core/cognition/SelfModel";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import AgentStore from "../src/core/agents/AgentStore";

/* ------------------------------ harness ------------------------------ */

registerAgenticTools();
ToolRegistry.getInstance().updateAvailability("project.manage", true);
AutonomyGate.getInstance().setLevel(2);

const executor = TaskExecutor.getInstance();
const reasonPrompts: string[] = [];
const agentCalls: Array<{ agent: string; instruction: string }> = [];
executor.configure({
  sleep: async () => {},
  reason: async (prompt) => {
    reasonPrompts.push(prompt);
    return { ok: true, content: `summary of: ${prompt.slice(0, 120)}` };
  },
  runAgent: async (agent, instruction) => {
    agentCalls.push({ agent, instruction });
    return { ok: true, content: `${agent} did: ${instruction}` };
  },
});

const unique = () => Math.random().toString(36).slice(2, 8);

/** A runtime-registered tool that records every real invocation. */
function countingTool(options: {
  risk?: 0 | 1 | 3 | 4;
  permissions?: ToolDefinition["permissions"];
  behaviour?: (call: number, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
}) {
  const id = `testkit.t${unique()}`;
  const calls: Array<Record<string, unknown>> = [];
  const result = registerExecutor(
    {
      id,
      parameters: { type: "object", properties: { value: { type: "string" } } },
      run: async (args) => {
        calls.push(args);
        return options.behaviour ? options.behaviour(calls.length, args) : { ok: true, content: `ran with ${JSON.stringify(args)}` };
      },
    },
    {
      id,
      name: id,
      description: "test tool",
      category: "Test",
      permissions: options.permissions ?? ["READ"],
      riskLevel: options.risk ?? 0,
      available: true,
    },
  );
  assert.equal(result.ok, true, result.reason);
  return { id, calls };
}

function startTask(goal: string, steps: PlanStepInput[]) {
  const validation = validatePlan(steps);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  return createTask(goal, validation, "test");
}

/* ------------------------------ tool layer ------------------------------ */

test("a tool registered at runtime is discoverable, dispatchable and tracked", async () => {
  const tool = countingTool({});
  const found = findCapabilities(tool.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].executable, true);
  assert.equal(found[0].permitted, true);

  const result = await dispatchToolCall({ id: "c1", name: toolNameForModel(tool.id), arguments: { value: "x" } }, "t");
  assert.equal(result.ok, true);
  assert.equal(tool.calls.length, 1);
  assert.equal(ToolStats.getInstance().get(tool.id)?.succeeded, 1);

  // An existing id cannot be silently replaced, and built-ins cannot be removed.
  assert.equal(registerExecutor({ id: tool.id, parameters: {}, run: async () => ({ ok: true, content: "" }) }, { ...found[0], permissions: ["READ"], riskLevel: 0 } as never).ok, false);
  assert.equal(unregisterExecutor("project.manage"), false);
  assert.equal(unregisterExecutor(tool.id), true);
  assert.equal(findCapabilities(tool.id).length, 0);
});

test("the catalog reports blocked tools with the reason, and lists the agency tools", () => {
  const all = listCapabilities();
  const discover = all.find((c) => c.id === "capability.discover");
  assert.ok(discover?.permitted, "capability.discover should be ready");
  const described = all.find((c) => c.kind === "tool" && !c.executable);
  assert.ok(described?.blockedReason, "a registry-only tool should say why it cannot run");
});

/* ------------------------------ execution ------------------------------ */

test("a multi-step plan runs real tools in order, passes outputs forward, and verifies", async () => {
  const marker = `Agentic ${unique()}`;
  const progress: TaskProgress[] = [];
  const stop = executor.onProgress((event) => progress.push(event));
  const task = startTask("create a project and confirm it exists", [
    { id: "create", title: "Create the project", tool: "project.manage", args: { action: "create", name: marker } },
    // Observes the FIRST step's real effect through a separate read.
    { id: "check", title: "Confirm it is listed", tool: "project.manage", args: { action: "list" }, verify: { operator: "contains", value: marker } },
    { id: "sum", title: "Summarise", prompt: "Report: {{steps.create.output}}", dependsOn: ["create", "check"] },
  ]);
  const done = await executor.run(task.id);
  stop();

  assert.equal(done?.status, "completed", done?.report);
  assert.match(done!.steps[0].output!, new RegExp(`Created project "${marker}"`));
  assert.match(done!.steps[1].output!, new RegExp(marker));
  assert.ok(reasonPrompts.some((p) => p.includes(`Created project "${marker}"`)), "the earlier output was not passed forward");
  assert.match(done!.report!, /Completed and verified/);
  const kinds = progress.filter((p) => p.taskId === task.id).map((p) => p.kind);
  assert.deepEqual(kinds.filter((k) => k === "step-succeeded").length, 3);
  assert.equal(kinds.at(-1), "completed");

  // Checkpointed: the persisted copy matches.
  TaskEngine.getInstance().reload();
  assert.equal(TaskEngine.getInstance().get(task.id)?.status, "completed");
});

test("a failed verification fails the task instead of reporting success", async () => {
  const task = startTask("expect something that is not there", [
    { title: "List", tool: "project.manage", args: { action: "list" }, verify: { operator: "contains", value: `absent-${unique()}` }, maxAttempts: 2 },
  ]);
  const done = await executor.run(task.id);
  assert.equal(done?.status, "failed");
  assert.match(done!.steps[0].error!, /verification failed/);
  assert.equal(done!.steps[0].attempts, 2, "a verification failure is retried once");
});

test("a refused step is not retried, and its dependants are skipped, not run", async () => {
  const downstream = countingTool({});
  const task = createTask(
    "use a tool that does not exist",
    { ok: true, errors: [], approvalsNeeded: [], steps: [
      { id: "a", title: "Missing tool", description: "", action: { kind: "tool", tool: "nonexistent.tool", args: {} } },
      { id: "b", title: "Downstream", description: "", action: { kind: "tool", tool: downstream.id, args: {} } },
    ] },
    "test",
  );
  const done = await executor.run(task.id);
  assert.equal(done?.status, "failed");
  assert.equal(done!.steps[0].attempts, 1, "a refusal must not be retried");
  assert.equal(done!.steps[1].status, "skipped");
  assert.equal(downstream.calls.length, 0, "a step whose dependency failed must not run");

  // Self-evaluation recorded the missing capability as a gap.
  const evaluation = TaskEvaluator.getInstance().history().find((e) => e.taskId === task.id);
  assert.ok(evaluation, "the finished task was not evaluated");
  assert.equal(evaluation!.gaps[0]?.capability, "nonexistent.tool");
  assert.equal(evaluation!.gaps[0]?.kind, "missing-tool");
});

test("a transient failure is retried and then succeeds", async () => {
  const flaky = countingTool({
    behaviour: async (call) => (call === 1 ? { ok: false, content: "upstream timed out" } : { ok: true, content: "fine" }),
  });
  const task = startTask("flaky", [{ title: "Flaky call", tool: flaky.id, args: {} }]);
  const done = await executor.run(task.id);
  assert.equal(done?.status, "completed");
  assert.equal(done!.steps[0].attempts, 2);
  assert.equal(flaky.calls.length, 2);
});

test("agent steps delegate with earlier outputs, and independent branches both run", async () => {
  agentCalls.length = 0;
  const store = AgentStore.getInstance();
  const analyst = store.create({ name: `Analyst ${unique()}`, role: "analysis" });
  const writer = store.create({ name: `Writer ${unique()}`, role: "writing" });
  store.setEnabled(analyst.id, true);
  store.setEnabled(writer.id, true);

  const task = startTask("research then delegate", [
    { id: "r", title: "Gather", tool: "capability.discover", args: { query: "project" } },
    { id: "x", title: "Analyse", agent: analyst.name, instruction: "Assess: {{steps.r.output}}", dependsOn: ["r"] },
    { id: "y", title: "Write", agent: writer.name, instruction: "Draft from the gathered list", dependsOn: ["r"] },
  ]);
  const done = await executor.run(task.id);
  assert.equal(done?.status, "completed", done?.report);
  assert.deepEqual(agentCalls.map((c) => c.agent).sort(), [analyst.name, writer.name].sort());
  const analysed = agentCalls.find((c) => c.agent === analyst.name)!;
  assert.match(analysed.instruction, /project\.manage/, "the agent did not receive the earlier step's real output");

  // An agent that does not exist is refused at planning time.
  assert.equal(validatePlan([{ title: "x", agent: "Nobody", instruction: "y" }]).ok, false);
});

/* ------------------------------ approval ------------------------------ */

test("a sensitive step waits for approval, then runs once with exactly the approved arguments", async () => {
  const sensitive = countingTool({ risk: 3, permissions: ["EXTERNAL_ACTION"] });
  assert.equal(ApprovalGate.getInstance().requiresApproval(sensitive.id).required, true);

  const task = startTask("send something outside", [
    { id: "send", title: "Send it", tool: sensitive.id, args: { value: "hello" } },
  ]);
  const waiting = await executor.run(task.id);
  assert.equal(waiting?.status, "waiting");
  assert.equal(sensitive.calls.length, 0, "a sensitive tool ran before anyone approved it");

  const approvalId = waiting!.steps[0].approvalId!;
  const pending = ApprovalGate.getInstance().get(approvalId);
  assert.equal(pending?.status, "pending");

  // A model cannot use a pending approval to force the call.
  const forged = await dispatchToolCall({ id: "f", name: toolNameForModel(sensitive.id), arguments: { value: "hello" } }, "t", undefined, { approvalId });
  assert.equal(forged.ok, false);
  assert.equal(sensitive.calls.length, 0);

  // The human approves (same event the timeline's Approve button emits).
  ApprovalGate.getInstance().decide(approvalId, "approved");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = await executor.settled(task.id);
  assert.equal(done?.status, "completed", done?.report);
  assert.deepEqual(sensitive.calls, [{ value: "hello" }]);

  // Single use: the same approval cannot run it again.
  const reuse = await dispatchToolCall({ id: "r", name: toolNameForModel(sensitive.id), arguments: { value: "hello" } }, "t", undefined, { approvalId });
  assert.equal(reuse.ok, false);
  assert.equal(sensitive.calls.length, 1);
});

test("an approval does not transfer to different arguments", async () => {
  const sensitive = countingTool({ risk: 3, permissions: ["EXTERNAL_ACTION"] });
  const request = ApprovalGate.getInstance().request({ taskId: "manual", tool: sensitive.id, args: { value: "a" }, title: "t", detail: "d" });
  ApprovalGate.getInstance().decide(request.id, "approved");
  const changed = await dispatchToolCall({ id: "c", name: toolNameForModel(sensitive.id), arguments: { value: "b" } }, "t", undefined, { approvalId: request.id });
  assert.equal(changed.ok, false);
  assert.equal(sensitive.calls.length, 0);
});

test("a rejected step fails the task with the reason and never runs", async () => {
  const sensitive = countingTool({ risk: 3, permissions: ["EXTERNAL_ACTION"] });
  const task = startTask("risky", [{ title: "Risky", tool: sensitive.id, args: {} }]);
  const waiting = await executor.run(task.id);
  ApprovalGate.getInstance().decide(waiting!.steps[0].approvalId!, "rejected");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = await executor.settled(task.id);
  assert.equal(done?.status, "failed");
  assert.match(done!.steps[0].error!, /declined by the user/);
  assert.equal(sensitive.calls.length, 0);
});

test("approval never lifts a destructive (L4) tool above the autonomy level", async () => {
  const destructive = countingTool({ risk: 4, permissions: ["DESTRUCTIVE"] });
  const request = ApprovalGate.getInstance().request({ taskId: "manual", tool: destructive.id, args: {}, title: "t", detail: "d" });
  ApprovalGate.getInstance().decide(request.id, "approved");
  const result = await dispatchToolCall({ id: "d", name: toolNameForModel(destructive.id), arguments: {} }, "t", undefined, { approvalId: request.id });
  assert.equal(result.ok, false);
  assert.equal(destructive.calls.length, 0);
});

/* ------------------------------ cancel / resume ------------------------------ */

test("cancel stops a running task between steps; later steps never run", async () => {
  let release: () => void = () => {};
  const slow = countingTool({ behaviour: () => new Promise((resolve) => { release = () => resolve({ ok: true, content: "slow done" }); }) });
  const after = countingTool({});
  const task = startTask("long job", [
    { title: "Slow", tool: slow.id, args: {} },
    { title: "After", tool: after.id, args: {} },
  ]);
  const running = executor.run(task.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(executor.isRunning(task.id), true);
  executor.cancel(task.id, "user pressed stop");
  release();
  const done = await running;
  assert.equal(done?.status, "cancelled");
  assert.equal(after.calls.length, 0);
  assert.equal(done!.steps[1].status, "skipped");
});

test("a task interrupted mid-run is recovered as paused and resumes from the last finished step", async () => {
  const first = countingTool({});
  const second = countingTool({});
  const task = startTask("survive a restart", [
    { title: "First", tool: first.id, args: {} },
    { title: "Second", tool: second.id, args: {} },
  ]);
  // Simulate a crash after step 1: persisted as running, step 2 mid-flight.
  const engine = TaskEngine.getInstance();
  const stored = engine.get(task.id)!;
  stored.status = "running";
  stored.steps[0].status = "completed";
  stored.steps[0].output = "first done";
  stored.steps[1].status = "running";
  engine.save(stored);

  engine.reload(); // a fresh start reads the persisted state
  const recovered = executor.recoverInterrupted();
  assert.ok(recovered.includes(task.id));
  assert.equal(engine.get(task.id)?.status, "paused");

  const done = await executor.resume(task.id);
  assert.equal(done?.status, "completed");
  assert.equal(first.calls.length, 0, "a step that had finished ran again after resume");
  assert.equal(second.calls.length, 1);
});

/* ------------------------------ planning ------------------------------ */

test("the planner validates a model's plan and repairs it once with the exact errors", async () => {
  const prompts: string[] = [];
  const replies = [
    '{"steps":[{"id":"s1","title":"x","tool":"made.up","args":{}}]}',
    '```json\n{"steps":[{"id":"s1","title":"List projects","tool":"project.manage","args":{"action":"list"}}]}\n```',
  ];
  const result = await planTask("show my projects", {
    generate: async (prompt) => {
      prompts.push(prompt);
      return { ok: true, text: replies[prompts.length - 1] };
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.attempts, 2);
  assert.match(prompts[0], /project\.manage/, "the capability list was not given to the model");
  assert.match(prompts[1], /there is no tool "made\.up"/, "the repair round did not carry the error");
  assert.equal(result.validation!.steps[0].action.kind, "tool");
});

test("the planner refuses rather than running a plan that is still invalid", async () => {
  const result = await planTask("do the impossible", {
    generate: async () => ({ ok: true, text: '{"steps":[{"title":"x","tool":"made.up"}]}' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /invalid plan/);
});

test("plan validation rejects forward references and dangling dependencies", () => {
  const validation = validatePlan([
    { id: "a", title: "A", prompt: "use {{steps.b.output}}" },
    { id: "b", title: "B", prompt: "b", dependsOn: ["zzz"] },
  ]);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((e) => e.includes("{{steps.b.output}}")));
  assert.ok(validation.errors.some((e) => e.includes('"zzz"')));
});

test("task.start through the dispatcher is how a model runs a plan end to end", async () => {
  const marker = `Model ${unique()}`;
  const result = await dispatchToolCall(
    {
      id: "m1",
      name: toolNameForModel("task.start"),
      arguments: {
        goal: "make a project",
        steps: [
          { id: "s1", title: "Create", tool: "project.manage", args: { action: "create", name: marker } },
          { id: "s2", title: "Verify", tool: "project.manage", args: { action: "list" }, verify: { operator: "contains", value: marker } },
        ],
      },
    },
    "chat-turn",
  );
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /Completed and verified/);

  const bad = await dispatchToolCall(
    { id: "m2", name: toolNameForModel("task.start"), arguments: { goal: "bad", steps: [{ title: "x", tool: "made.up" }] } },
    "chat-turn",
  );
  assert.equal(bad.ok, false);
  assert.match(bad.content, /not started/);
});

test("there is no tool that approves: the model can only list pending approvals", () => {
  const ids = listCapabilities().map((c) => c.id);
  assert.ok(ids.includes("approval.list"));
  assert.equal(ids.some((id) => /approv(e|al)\.(grant|approve|decide)|^approve/.test(id)), false);
});

/* ------------------------------ helpers ------------------------------ */

test("interpolation reports missing references; verification checks real output", () => {
  const missing: string[] = [];
  const out = interpolate({ a: "x {{steps.s1.output}} y {{steps.s9.output}}" }, new Map([["s1", "ONE"]]), missing);
  assert.deepEqual(out, { a: "x ONE y " });
  assert.deepEqual(missing, ["s9"]);
  assert.equal(verifyOutput("", { operator: "not-empty" }).ok, false);
  assert.equal(verifyOutput("Hello World", { operator: "contains", value: "world" }).ok, true);
});

/* ------------------------------ reflection ------------------------------ */

test("reflection turns repeated failures into proposals for review — never approvals", async () => {
  const broken = countingTool({ behaviour: async () => ({ ok: false, content: "service returned 500" }) });
  for (let i = 0; i < 2; i += 1) {
    await executor.run(startTask(`use broken ${i}`, [{ title: "Broken", tool: broken.id, args: {}, maxAttempts: 1 }]).id);
  }
  const result = await DailyReflection.getInstance().run("on-request");
  const failure = result.recurringFailures.find((f) => f.tool === broken.id);
  assert.ok(failure, "the repeatedly failing tool was not identified");
  assert.ok(result.tasks.failed >= 2);

  const proposals = ImprovementQueue.getInstance().list().filter((p) => result.proposalsCreated.includes(p.id));
  assert.ok(proposals.some((p) => p.capabilityId === broken.id));
  assert.ok(proposals.every((p) => p.status === "Proposed"), "reflection must not approve its own proposals");
  assert.ok(proposals.some((p) => p.capabilityId === "nonexistent.tool"), "the missing-capability gap became a proposal");

  assert.ok(SelfModel.getInstance().get().improvements.some((line) => line.includes(broken.id)));
  assert.ok(DailyReflection.getInstance().history()[0].at === result.at);

  // Not due again within a day.
  assert.equal(await DailyReflection.getInstance().runIfDue(), null);
});
