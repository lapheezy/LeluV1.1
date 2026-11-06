/**
 * ==========================================================
 * LÉLU — TOOLS FINISH, CONVERSATIONS FINISH
 *
 * CATEGORY: integration. The real TaskEngine, TaskExecutor,
 * ToolDispatcher, Studio tools and store, TurnOwnership, the chat's
 * activity recorder and AIService's reply channel. No model: plans are
 * written here, as the planner would write them.
 *
 * The defect these guard: a planned (multi-step) turn ran its tools,
 * wrote and verified the DOCX, and the Orchestrator returned its report —
 * but the report never went through the reply channel, the recorder
 * published the turn as still running, and the artifact event was keyed
 * to no conversation. The chat sat on "Working with tools" for good, no
 * card appeared, and the refinement queued behind a turn that had ended.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

import AIService, { type AIMessageEvent } from "../src/core/AIService";
import TaskExecutor, { interpolate, ownedToolContext } from "../src/core/agentic/TaskExecutor";
import { createTask, validatePlan, type PlanStepInput } from "../src/core/agentic/TaskPlanner";
import { bindTask } from "../src/core/multichat/TurnOwnership";
import StudioStore from "../src/core/studio/StudioStore";
import { registerStudioTools } from "../src/core/studio/StudioTools";
import { dispatchToolCall, registerExecutor, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import type RouterContext from "../src/core/router/RouterContext";
import { recordTurnActivity } from "../src/app/scene/genesis/chat/activityRecorder";

registerStudioTools();

let clock = 1_900_000_000_000;
/** The runtime tool context, as AIService.toolContext builds it (fresh request key each call). */
const runtimeContext = (): RouterContext => ({ request: { prompt: "", messages: [], timestamp: (clock += 1) } }) as unknown as RouterContext;

const executor = TaskExecutor.getInstance();
executor.configure({
  sleep: async () => {},
  // The production dispatch, with the runtime context AIService would give it.
  dispatch: (call, taskId, options) => dispatchToolCall(call, taskId, ownedToolContext(runtimeContext(), taskId), options),
  reason: async (prompt) => ({ ok: true, content: `reasoned: ${prompt.slice(0, 40)}` }),
  runAgent: async (agent, instruction) => ({ ok: true, content: `${agent}: ${instruction}` }),
});

const DOC = (title: string) => ({
  kind: "document",
  title,
  blocks: [
    { type: "heading", text: title },
    { type: "paragraph", text: "A lantern." },
    { type: "chart", chart: { kind: "column", labels: ["Lite", "Standard", "Pro"], series: [{ name: "g", values: [180, 240, 320] }] } },
  ],
  open: false,
});

/** A planned turn for a conversation, as Orchestrator.planAndExecute runs it. */
async function plannedTurn(conversationId: string, steps: PlanStepInput[]) {
  const validation = validatePlan(steps);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  const task = createTask(steps[0].title, validation, "orchestrator");
  bindTask(task.id, conversationId); // what planAndExecute now does
  const recording = recordTurnActivity(conversationId, () => {});
  const finished = await executor.run(task.id);
  const activity = recording.stop(finished?.status !== "completed");
  return { task: finished!, activity };
}

const artifactsOf = (conversationId: string) => StudioStore.getInstance().list().filter((a) => a.conversationId === conversationId);

test("1. a single tool step completes, and the turn's record is finished, not running", async () => {
  const { task, activity } = await plannedTurn("conv-single", [{ id: "s1", title: "Create", tool: "studio.create", args: DOC("Single brief") }]);
  assert.equal(task.status, "completed");
  assert.equal(activity.status, "done", "the published record says the turn ended");
  assert.equal(artifactsOf("conv-single").length, 1);
});

test("2+4. sequential tools: create then export through {{steps.s1.output.id}} — the DOCX is written and verified", async () => {
  // The exact plan the live planner wrote; the field path used to reach the tool unreplaced.
  const { task, activity } = await plannedTurn("conv-seq", [
    { id: "s1", title: "Create the brief", tool: "studio.create", args: DOC("Lumo brief") },
    { id: "s2", title: "Export DOCX", tool: "studio.export", args: { artifact: "{{steps.s1.output.id}}", formats: ["docx"] }, dependsOn: ["s1"] },
  ]);
  assert.equal(task.status, "completed", task.steps.map((s) => `${s.status}:${s.error ?? ""}`).join(" | "));
  const [artifact] = artifactsOf("conv-seq");
  assert.ok(artifact.exports.some((e) => e.format === "docx" && e.ok), "verified DOCX");
  assert.equal(activity.status, "done");
  assert.ok(activity.artifacts?.some((a) => a.artifactId === artifact.id), "the card is recorded for the conversation that asked");
});

test("interpolate: a field path on a step output is replaced, never left as a raw placeholder", () => {
  const missing: string[] = [];
  const out = interpolate({ artifact: "{{steps.s1.output.id}}", b: "{{ steps.s1.output }}" }, new Map([["s1", "Created [art_0a0b0c0d0e0f] document"]]), missing);
  assert.deepEqual(out, { artifact: "Created [art_0a0b0c0d0e0f] document", b: "Created [art_0a0b0c0d0e0f] document" });
  assert.deepEqual(missing, []);
});

test("3. several tool calls in one assistant turn are all recorded on that turn", async () => {
  const conversationId = "conv-multi";
  const recording = recordTurnActivity(conversationId, () => {});
  const turnKey = String((clock += 1));
  bindTask(turnKey, conversationId);
  const context = { request: { prompt: "", messages: [], timestamp: Number(turnKey), conversationId } } as unknown as RouterContext;
  const results = await Promise.all(
    ["Deck one", "Deck two"].map((title, i) =>
      dispatchToolCall({ id: `m${i}`, name: toolNameForModel("studio.create"), arguments: DOC(title) }, turnKey, context),
    ),
  );
  const activity = recording.stop();
  assert.ok(results.every((r) => r.ok));
  assert.equal(activity.artifacts?.length, 2, "both artifacts, one card each");
  assert.equal(activity.status, "done");
});

test("5. the final reply produced outside ai.chat is delivered to its conversation", () => {
  const seen: AIMessageEvent[] = [];
  const ai = AIService.getInstance();
  const stop = ai.subscribeMessages((m) => { seen.push(m); });
  const id = ai.deliverReply("Completed and verified: the brief.", "conv-reply");
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].id, seen[0].role, seen[0].conversationId, seen[0].text], [id, "assistant", "conv-reply", "Completed and verified: the brief."]);
  // GenesisChat delivers it only when the turn has no stored reply yet (ai.chat replies are not duplicated).
  const chat = readFileSync(new URL("../src/app/scene/genesis/GenesisChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /if \(anchor >= 0 && !answered\) ai\.deliverReply\(assistantText, turnConversationId\);/);
  assert.match(chat, /const activity = recording\.stop\(turnFailed\);/);
});

test("6. a failing tool settles the turn as failed, and the next turn recovers", async () => {
  const failed = await plannedTurn("conv-fail", [{ id: "s1", title: "Export nothing", tool: "studio.export", args: { artifact: "art_000000000000", formats: ["docx"] } }]);
  assert.equal(failed.task.status, "failed");
  assert.equal(failed.activity.status, "failed", "settled — failed, not running");
  const recovered = await plannedTurn("conv-fail", [{ id: "s1", title: "Create", tool: "studio.create", args: DOC("Recovered brief") }]);
  assert.equal(recovered.task.status, "completed");
  assert.equal(recovered.activity.status, "done");
});

test("7. Stop during a running tool settles the task and the turn", async () => {
  let release: () => void = () => {};
  const id = `testkit.slow${Math.random().toString(36).slice(2, 7)}`;
  registerExecutor(
    { id, parameters: { type: "object", properties: {} }, run: () => new Promise((resolve) => { release = () => resolve({ ok: true, content: "late" }); }) },
    { id, name: id, description: "slow", category: "Test", permissions: ["READ"], riskLevel: 0, available: true },
  );
  const validation = validatePlan([{ id: "s1", title: "Slow", tool: id, args: {} }]);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  const task = createTask("slow", validation, "orchestrator");
  bindTask(task.id, "conv-stop");
  const recording = recordTurnActivity("conv-stop", () => {});
  const running = executor.run(task.id);
  await new Promise((r) => setTimeout(r, 20));
  executor.cancel(task.id, "stopped by the user");
  release();
  const finished = await running;
  const activity = recording.stop(true);
  assert.equal(finished?.status, "cancelled");
  assert.notEqual(activity.status, "running");
});

test("8. the queued refinement runs after completion and revises the same artifact", async () => {
  await plannedTurn("conv-refine", [{ id: "s1", title: "Create", tool: "studio.create", args: DOC("Refine brief") }]);
  const [before] = artifactsOf("conv-refine");
  const { task } = await plannedTurn("conv-refine", [
    { id: "s1", title: "Revise", tool: "studio.revise", args: { artifact: "this", ops: [{ op: "updateChart", index: 1, chart: { kind: "line", labels: ["Lite", "Standard", "Pro", "Max"], series: [{ name: "g", values: [180, 240, 320, 400] }] } }], export: ["docx"] } },
  ]);
  assert.equal(task.status, "completed", task.steps.map((s) => s.error ?? "").join(" | "));
  const after = StudioStore.getInstance().get(before.id)!;
  assert.equal(after.revisions.length, 2);
  const chart = after.revisions[1].spec.kind === "document" ? after.revisions[1].spec.blocks.find((b) => b.type === "chart") : undefined;
  assert.equal((chart as { chart: { kind: string; labels: string[] } }).chart.kind, "line");
  assert.deepEqual((chart as { chart: { labels: string[] } }).chart.labels, ["Lite", "Standard", "Pro", "Max"]);
  assert.ok(after.exports.some((e) => e.rev === 2 && e.format === "docx" && e.ok));
});

test("9. two conversations run planned turns at once and keep their own artifacts and cards", async () => {
  const [a, b] = await Promise.all([
    plannedTurn("conv-A", [{ id: "s1", title: "Create A", tool: "studio.create", args: DOC("Alpha brief") }]),
    plannedTurn("conv-B", [{ id: "s1", title: "Create B", tool: "studio.create", args: DOC("Beta brief") }]),
  ]);
  assert.deepEqual(artifactsOf("conv-A").map((x) => x.title), ["Alpha brief"]);
  assert.deepEqual(artifactsOf("conv-B").map((x) => x.title), ["Beta brief"]);
  assert.deepEqual(a.activity.artifacts?.map((x) => x.title), ["Alpha brief"]);
  assert.deepEqual(b.activity.artifacts?.map((x) => x.title), ["Beta brief"]);
});
