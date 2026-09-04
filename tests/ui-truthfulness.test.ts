/**
 * ==========================================================
 * LÉLU — UI TRUTHFULNESS
 * ==========================================================
 *
 * The activity line is the UI's claim about what LÉLU did.
 * These lock the cases where it was making claims the events
 * did not support.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  executionEventLabel,
  isExecutionEvent,
} from "../src/app/scene/genesis/GenesisExecutionTimeline";

test("a raw internal event type is never shown as LÉLU's activity", () => {
  // This produced the literal on-screen line
  // "LÉLU is visual_state_changed · 8 operations".
  const label = executionEventLabel({
    type: "visual_state_changed", taskId: "t", state: "engineering",
  } as never);

  assert.doesNotMatch(label, /^visual_state_changed$/, "raw identifier leaked to the user");
  assert.match(label, /view switched/i);

  // And the same for anything genuinely unhandled.
  const unknown = executionEventLabel({ type: "some_future_event", taskId: "t" } as never);
  assert.equal(unknown, "Internal event");
  assert.doesNotMatch(unknown, /some_future_event/);
});

test("view and workspace changes are not counted as operations LÉLU performed", () => {
  // "8 operations" must mean eight things she did, not eight renders.
  assert.equal(isExecutionEvent({ type: "visual_state_changed", taskId: "t", state: "research" } as never), false);
  assert.equal(isExecutionEvent({ type: "core_transform", taskId: "t", target: null } as never), false);
  assert.equal(isExecutionEvent({ type: "workspace_open", taskId: "t" } as never), false);
  assert.equal(isExecutionEvent({ type: "workspace_focus", taskId: "t", view: "x" } as never), false);

  // Real work still counts.
  assert.equal(isExecutionEvent({ type: "tool_started", taskId: "t", tool: "research" } as never), true);
  assert.equal(isExecutionEvent({ type: "tool_result", taskId: "t", tool: "research", result: "", results: [], status: "complete" } as never), true);
  assert.equal(isExecutionEvent({ type: "memory_update", taskId: "t", category: "conversation" } as never), true);
});

test("provider selection is not reported as completed work", () => {
  // "Connected to Anthropic" implied Anthropic had done the job. Being
  // routed to is not the same as having produced a result.
  const label = executionEventLabel({
    type: "provider_selected", taskId: "t", provider: "Anthropic",
  } as never);
  assert.doesNotMatch(label, /connected/i);
  assert.match(label, /routing to anthropic/i);
});
