/**
 * ==========================================================
 * LÉLU — CREATION STUDIO THROUGH THE REAL TOOL PATH
 *
 * CATEGORY: integration. The studio.* executors run through the real
 * ToolDispatcher (autonomy gate, events, stats) and are offered to the
 * model by the real toolSchemasForModel. The chat activity for the turn
 * is built by the real reducer from the events the tools emit.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import { emptyActivity, reduceActivity } from "../src/core/multichat/TurnActivity";
import StudioStore from "../src/core/studio/StudioStore";
import { registerStudioTools } from "../src/core/studio/StudioTools";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";

registerStudioTools();

const call = (id: string, args: Record<string, unknown>, taskId = "task-studio") =>
  dispatchToolCall({ id: `c-${id}`, name: toolNameForModel(id), arguments: args }, taskId, { request: { prompt: "", timestamp: 4242, conversationId: "conv-1" } } as never);

function recordEvents(): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = AgentEventBus.getInstance().subscribe((e) => { events.push(e); });
  return { events, stop };
}

test("the studio tools are registered, executable and offered to the model", () => {
  const names = toolSchemasForModel().map((s) => s.name);
  for (const id of ["studio.create", "studio.revise", "studio.export", "studio.read", "studio.list", "studio.compare", "studio.restore", "studio.open"]) {
    assert.ok(names.includes(toolNameForModel(id)), `${id} is offered`);
  }
});

test("“make this into a PowerPoint”: create + export through the dispatcher, a card for the reply, a verified file", async () => {
  const rec = recordEvents();
  const result = await call("studio.create", {
    kind: "deck",
    title: "Quarterly review",
    slides: [
      { title: "Quarterly review", layout: "title" },
      { title: "Revenue", chart: { kind: "column", title: "Revenue (k€)", labels: ["Q1", "Q2"], series: [{ name: "2026", values: [120, 140] }] }, notes: "Q2 beat plan." },
    ],
    export: ["pptx", "pdf"],
  });
  rec.stop();
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /✓ Quarterly-review\.pptx .* re-opened and verified/);
  assert.match(result.content, /✓ Quarterly-review\.pdf/);
  const id = (result.data as { id: string }).id;
  const artifact = StudioStore.getInstance().get(id)!;
  assert.equal(artifact.conversationId, "conv-1", "bound to the chat it was made in");
  assert.deepEqual(artifact.exports.map((e) => [e.format, e.ok]), [["pptx", true], ["pdf", true]]);

  let activity = emptyActivity();
  for (const e of rec.events) activity = reduceActivity(activity, e);
  assert.equal(activity.artifacts?.length, 1, "one card for the artifact");
  assert.equal(activity.artifacts![0].action, "created");
  assert.deepEqual(activity.artifacts![0].exports.map((e) => `${e.format}:${e.ok}`), ["pptx:true", "pdf:true"]);
  assert.ok(activity.steps.some((s) => s.label === "Creating the presentation “Quarterly review”"), "the activity line says what she is doing");
});

test("“make the chart a line chart”: a new revision, the old one kept, compare and restore", async () => {
  const created = await call("studio.create", { kind: "document", title: "Sales note", blocks: [{ type: "chart", chart: { kind: "column", labels: ["A", "B"], series: [{ name: "s", values: [1, 2] }] } }] });
  const id = (created.data as { id: string }).id;
  const revised = await call("studio.revise", { artifact: id, ops: [{ op: "updateChart", index: 1, chart: { kind: "line" } }], export: ["docx"] });
  assert.equal(revised.ok, true, revised.content);
  assert.match(revised.content, /revision 2 \(from 1; earlier revisions are kept\)/);
  assert.match(revised.content, /chart 1 → line/);
  const read = await call("studio.read", { artifact: id, file: "docx" });
  assert.match(read.content, /"chartKinds":\["line"\]/, "the exported FILE holds a line chart");
  const diff = await call("studio.compare", { artifact: id, from: 1, to: 2 });
  assert.match(diff.content, /− chart: column/);
  assert.match(diff.content, /\+ chart: line/);
  const restored = await call("studio.restore", { artifact: id, rev: 1 });
  assert.match(restored.content, /as revision 3; nothing was deleted/);
});

test("refusals are precise and change nothing", async () => {
  const bad = await call("studio.create", { kind: "deck", title: "x", slides: [{ title: "s", chart: { kind: "line", labels: ["a"], series: [{ name: "n", values: ["lots"] }] } }] });
  assert.equal(bad.ok, false);
  assert.match(bad.content, /Nothing was created: slide 1: series 1 value 1 .*lots.* is not a number/);
  const before = StudioStore.getInstance().list().length;
  const wrongFormat = await call("studio.create", { kind: "workbook", title: "Book", sheets: [{ name: "S", columns: ["a"], rows: [[1]] }], export: ["pptx"] });
  assert.match(wrongFormat.content, /Not exported: pptx \(a workbook can be xlsx, csv, html, md\)/);
  assert.equal(StudioStore.getInstance().list().length, before + 1);
  const missing = await call("studio.revise", { artifact: "no-such-thing", ops: [{ op: "setTitle", title: "y" }] });
  assert.equal(missing.ok, false);
});

test("“this” in a later message means the artifact made in this chat", async () => {
  const result = await call("studio.read", { artifact: "this" });
  assert.equal(result.ok, true);
  assert.match(result.content, /^\[art_[0-9a-f]+\]/);
});

test("a planned task's Studio step makes the artifact for the conversation that asked", async () => {
  // A multi-step request ("write the brief, export it as DOCX") runs as a
  // TaskEngine task whose tool steps used to be dispatched with no
  // context, so the artifact belonged to no conversation. The task is
  // bound to the asking conversation and its steps carry that binding.
  const { bindTask } = await import("../src/core/multichat/TurnOwnership");
  const { ownedToolContext } = await import("../src/core/agentic/TaskExecutor");
  const base = { request: { prompt: "brief", messages: [], timestamp: 1 } } as never;
  assert.equal(ownedToolContext(base, "task-unowned"), undefined, "a task nobody asked for keeps the context-free dispatch");
  bindTask("task-owned", "conv-task");
  const context = ownedToolContext(base, "task-owned");
  assert.equal(context?.request.conversationId, "conv-task");
  const result = await dispatchToolCall(
    { id: "c-task", name: toolNameForModel("studio.create"), arguments: { kind: "document", title: "Task brief", blocks: [{ type: "paragraph", text: "x" }] } },
    "task-owned",
    context,
  );
  assert.equal(result.ok, true, result.content);
  assert.equal(StudioStore.getInstance().get((result.data as { id: string }).id)!.conversationId, "conv-task");
});

test("the orchestrator binds a planned task to the conversation whose turn planned it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/core/orchestrator/Orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /const owner = ownerForTask\(taskId\);\s*if \(owner\) bindTask\(task\.id, owner\);/);
  const executor = readFileSync(new URL("../src/core/agentic/TaskExecutor.ts", import.meta.url), "utf8");
  assert.match(executor, /dispatchToolCall\(call, taskId, await conversationContext\(taskId\), options\)/);
});

test("a planned export step finds the artifact through the create step's output", async () => {
  // TaskPlanner wires `artifact: "{{steps.s1.output}}"`, so the export step
  // receives the create step's sentence, not a bare id. It used to answer
  // "No artifact matches; nothing was exported."
  const created = await call("studio.create", { kind: "document", title: "Planned brief", blocks: [{ type: "paragraph", text: "x" }] });
  const id = (created.data as { id: string }).id;
  const exported = await call("studio.export", { artifact: created.content, formats: ["docx"] });
  assert.equal(exported.ok, true, exported.content);
  assert.ok(StudioStore.getInstance().get(id)!.exports.some((e) => e.format === "docx" && e.ok), "the DOCX was written for that artifact");
});
