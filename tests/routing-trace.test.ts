/**
 * ==========================================================
 * LÉLU — ROUTING TRACE
 *
 * The trace exists to answer one question honestly: which stage
 * claimed a turn. These tests hold it to that, and to being a
 * passive observer (a turn with no trace still routes).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { beforeEach, describe } from "node:test";

import {
  beginRoutingTrace,
  claimingStage,
  finishRoutingTrace,
  note,
  noteStage,
  resetRoutingTraceForTests,
  routingSnapshot,
} from "../src/core/router/RoutingTrace.ts";
import type RouterContext from "../src/core/router/RouterContext.ts";

function context(prompt: string): RouterContext {
  return {
    request: { prompt, timestamp: 1_700_000_000_000 },
    started: Date.now(),
    intent: "chat",
    logger: { info: () => undefined },
  } as unknown as RouterContext;
}

beforeEach(() => resetRoutingTraceForTests());

describe("routing trace", () => {
  test("records stage order and which stage claimed the turn", () => {
    const ctx = context("why can't you run OpenHands?");
    const trace = beginRoutingTrace(ctx, "why can't you run OpenHands?");
    noteStage(ctx, "time", false, { durationMs: 1 });
    noteStage(ctx, "brain", false, { durationMs: 4 });
    noteStage(ctx, "intelligence", true, { provider: "intelligence", durationMs: 12 });
    noteStage(ctx, "provider", false, { durationMs: 900 });
    finishRoutingTrace(ctx, {
      text: "answer",
      provider: "intelligence",
      model: "capability-explanation",
      processingTime: 20,
      metadata: { source: "IntelligenceResolver" },
    });

    assert.deepEqual(
      trace.stages.map((stage) => stage.stage),
      ["time", "brain", "intelligence", "provider"],
    );
    assert.equal(claimingStage(trace), "intelligence");
    assert.equal(trace.owner, "IntelligenceResolver");
    assert.equal(trace.provider, "intelligence");
  });

  test("keeps concurrent turns separate by context", () => {
    const first = context("first");
    const second = context("second");
    const a = beginRoutingTrace(first, "first");
    const b = beginRoutingTrace(second, "second");
    noteStage(first, "time", false);
    noteStage(second, "intelligence", true);
    finishRoutingTrace(second, {
      text: "x",
      provider: "intelligence",
      model: "m",
      processingTime: 1,
      metadata: {},
    });

    assert.equal(a.stages.length, 1);
    assert.equal(a.stages[0]!.stage, "time");
    assert.equal(b.stages[0]!.stage, "intelligence");
    assert.equal(b.owner, "intelligence");
    assert.equal(a.owner, undefined);
  });

  test("records mid-flight notes with their outcome", () => {
    const ctx = context("snapshot");
    const trace = beginRoutingTrace(ctx, "snapshot");
    note(ctx, "intelligence.fetch", "explain answered from live state", true);
    note(ctx, "intelligence.fetch", "declined the turn: failed with 502", false);

    assert.equal(trace.notes.length, 2);
    assert.equal(trace.notes[0]!.ok, true);
    assert.match(trace.notes[1]!.detail, /502/);
  });

  test("is bounded and reset-able", () => {
    for (let i = 0; i < 60; i += 1) beginRoutingTrace(context(`p${i}`), `p${i}`);
    const snapshot = routingSnapshot();
    assert.ok(snapshot.length <= 40);
    assert.equal(snapshot[snapshot.length - 1]!.prompt, "p59");

    resetRoutingTraceForTests();
    assert.equal(routingSnapshot().length, 0);
  });

  test("a stage with no trace is a no-op, not a crash", () => {
    const ctx = context("untraced");
    noteStage(ctx, "time", false);
    note(ctx, "intelligence.fetch", "nothing");
    // No assertion on absence is possible by design; the point is that
    // the calls above must not throw for a router that was never traced.
    assert.equal(routingSnapshot().length, 0);
  });
});
