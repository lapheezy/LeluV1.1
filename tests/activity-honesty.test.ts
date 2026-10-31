/**
 * ==========================================================
 * LÉLU — THE TIMELINE REPORTS WHAT HAPPENED
 *
 * CATEGORY: unit. The real grouping function, the real
 * Orchestrator source, the real event bus.
 *
 * Two properties.
 *
 * ONE: an execution event describes an execution. Orchestrator
 * used to emit memory_read_started and memory_read_completed
 * back to back with nothing between them, and a
 * memory_retrieval carrying the literal `count: 0` — so the
 * timeline said memory had been read when nothing had read it,
 * and said nothing was recalled whatever had been. That is UI
 * theatre, and it is worse than an empty timeline, because a
 * user who trusts it is misled about what LÉLU did.
 *
 * TWO: activity is grouped by what the events actually are, and
 * a group with no events is not shown. A heading with nothing
 * under it is the same lie in a different shape.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { AgentEvent } from "../src/core/agent/AgentEvents";
import { groupEvents, groupForEvent } from "../src/app/scene/genesis/GenesisExecutionTimeline";

/** Source with comments stripped, so prose about a bug is not read as the bug. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ------------------------------------------------------------------ *
 * NO THEATRE
 * ------------------------------------------------------------------ */

test("the memory phase events bracket a real recall", () => {
  const source = code("src/core/orchestrator/Orchestrator.ts");

  // The two events are no longer adjacent with nothing between them.
  const started = source.indexOf("memory_read_started");
  const completed = source.indexOf("memory_read_completed");
  assert.ok(started > 0 && completed > started, "the memory phase events are missing");
  const between = source.slice(started, completed);
  assert.match(
    between,
    /recall\(/,
    "memory_read_completed is still emitted without a recall between it and memory_read_started",
  );
});

test("the recalled count comes from the result, never a literal", () => {
  const source = code("src/core/orchestrator/Orchestrator.ts");
  assert.ok(
    !/memory_retrieval[^}]*count:\s*0\b/.test(source),
    "memory_retrieval is still reporting a hardcoded count of 0",
  );
  assert.match(
    source,
    /count:\s*recalled/,
    "the retrieval count is not taken from the recall's own result",
  );
});

test("a failed recall is reported as a failure, not as a completed read", () => {
  const source = code("src/core/orchestrator/Orchestrator.ts");
  const started = source.indexOf("memory_read_started");
  const window = source.slice(started, started + 1600);
  assert.match(window, /phase: "error"/, "a recall that throws still reports a successful read");
});

test("nothing claims a project was resolved when nothing resolved one", () => {
  const source = code("src/core/orchestrator/Orchestrator.ts");
  assert.ok(
    !/Project identified/.test(source),
    "the timeline still announces a project resolution that does not happen in this path",
  );
});

/* ------------------------------------------------------------------ *
 * GROUPING, FROM REAL EVENTS
 * ------------------------------------------------------------------ */

const toolResult = (tool: string): AgentEvent => ({
  type: "tool_result",
  taskId: "t",
  tool,
  result: "ok",
  results: [],
  status: "complete",
});

test("events are grouped by what they are", () => {
  assert.equal(groupForEvent({ type: "memory_retrieval", taskId: "t", query: "q", count: 3 }), "Research");
  assert.equal(groupForEvent({ type: "task_planning", taskId: "t", plan: "p" }), "Analysis");
  assert.equal(groupForEvent(toolResult("sandbox_write")), "Actions");
  assert.equal(
    groupForEvent({ type: "execution_phase", taskId: "t", phase: "validation_completed", label: "ok", side: "backend" }),
    "Verification",
  );
  // An execution phase that is not one of the four is not forced into one.
  assert.equal(
    groupForEvent({ type: "execution_phase", taskId: "t", phase: "command_received", label: "x", side: "both" }),
    null,
  );
});

test("a group with no events is not shown", () => {
  const groups = groupEvents([toolResult("sandbox_write"), toolResult("sandbox_read")]);
  assert.deepEqual(groups.map((entry) => entry.group), ["Actions"]);
  assert.equal(groups[0].events.length, 2);
  // Nothing invents Research, Analysis or Verification headings.
  assert.equal(groupEvents([]).length, 0);
});

test("the groups read in a stable order whatever order the events arrived in", () => {
  const events: AgentEvent[] = [
    { type: "execution_phase", taskId: "t", phase: "validation_completed", label: "ok", side: "backend" },
    toolResult("sandbox_write"),
    { type: "memory_retrieval", taskId: "t", query: "q", count: 1 },
    { type: "task_planning", taskId: "t", plan: "p" },
  ];
  assert.deepEqual(
    groupEvents(events).map((entry) => entry.group),
    ["Research", "Analysis", "Actions", "Verification"],
  );
  assert.deepEqual(
    groupEvents([...events].reverse()).map((entry) => entry.group),
    ["Research", "Analysis", "Actions", "Verification"],
  );
});

test("the counts shown are the real number of events in each group", () => {
  const groups = groupEvents([
    toolResult("a"),
    toolResult("b"),
    toolResult("c"),
    { type: "memory_retrieval", taskId: "t", query: "q", count: 9 },
  ]);
  const actions = groups.find((entry) => entry.group === "Actions");
  const research = groups.find((entry) => entry.group === "Research");
  assert.equal(actions?.events.length, 3);
  assert.equal(research?.events.length, 1);
});

test("the timeline does not put internal identifiers in front of the user", () => {
  const source = code("src/app/scene/genesis/GenesisExecutionTimeline.tsx");
  // The raw event type was being used as a tooltip on every row.
  assert.ok(
    !/title=\{event\.type\}/.test(source),
    "the raw event type is still shown to the user as a tooltip",
  );
});
