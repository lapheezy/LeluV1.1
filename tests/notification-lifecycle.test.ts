/**
 * ==========================================================
 * LÉLU — NOTIFICATION LIFECYCLE
 *
 * CATEGORY: unit. Pure lifecycle decisions; no store, no DOM.
 *
 * Why this exists: the Fashion card. "Fashion is active but has
 * no defined next outcome" returned on every cognitive cycle,
 * could not be dismissed, and never changed no matter how long
 * the user ignored it. A question was either pending or it was
 * not, so ignoring one left it pending and pending meant ask.
 *
 * These pin the three properties that replace that: a repeated
 * cycle is a no-op, a closed question stays closed until the
 * SITUATION changes, and indifference accumulates into a
 * conclusion instead of into more cards.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  IGNORE_LIMIT,
  canSurface,
  effectivePriorityOffset,
  evolve,
  isWorkstreamOwned,
  markDeferred,
  markDismissed,
  markEngaged,
  markIgnored,
  markResolved,
  markSurfaced,
  markSuperseded,
  newLifecycle,
  parseLifecycle,
  shouldReconsider,
} from "../src/core/proactive/QuestionLifecycle";

const EVIDENCE = "p:fashion|st:active|items:0|q:0";

test("a freshly generated question may be surfaced", () => {
  const lifecycle = newLifecycle(EVIDENCE);
  assert.equal(lifecycle.state, "generated");
  assert.equal(canSurface(lifecycle), true);
  assert.equal(lifecycle.surfacedCount, 0);
});

test("the same evidence is never reconsidered — a repeated cycle is a no-op", () => {
  const lifecycle = markSurfaced(newLifecycle(EVIDENCE), 1000);
  // This is the whole idempotence guarantee: reload, StrictMode double
  // mount, Supabase reconnect and a loop restart all re-observe the same
  // situation, so they all land here.
  assert.equal(shouldReconsider(lifecycle, EVIDENCE), false);
});

test("a dismissed question stays dismissed on identical evidence", () => {
  const dismissed = markDismissed(markSurfaced(newLifecycle(EVIDENCE), 1));
  assert.equal(canSurface(dismissed), false);
  assert.equal(shouldReconsider(dismissed, EVIDENCE), false);
});

test("a deferred question stays silent until the situation moves", () => {
  const deferred = markDeferred(markSurfaced(newLifecycle(EVIDENCE), 1));
  assert.equal(canSurface(deferred), false);
  assert.equal(shouldReconsider(deferred, EVIDENCE), false);
  // Real movement — a work item appeared — may reopen it.
  assert.equal(shouldReconsider(deferred, "p:fashion|st:active|items:1|q:0"), true);
});

test("time alone never reopens a closed question", () => {
  // The original spam was "ask again later": nothing changed but the
  // clock. There is deliberately no deadline in the model, so the only
  // thing that can reopen a question is different evidence.
  const dismissed = markDismissed(markSurfaced(newLifecycle(EVIDENCE), 1));
  const muchLater = { ...dismissed, lastSurfacedAt: 0 };
  assert.equal(shouldReconsider(muchLater, EVIDENCE), false);
});

test("an ignored question deprioritises and then parks itself", () => {
  let lifecycle = newLifecycle(EVIDENCE);
  for (let shown = 1; shown < IGNORE_LIMIT; shown += 1) {
    lifecycle = markIgnored(markSurfaced(lifecycle, shown));
    assert.equal(lifecycle.state, "eligible", "still allowed to ask below the limit");
    assert.equal(canSurface(lifecycle), true);
  }
  lifecycle = markIgnored(markSurfaced(lifecycle, IGNORE_LIMIT));
  assert.equal(lifecycle.state, "parked", "repeated indifference is a conclusion");
  assert.equal(canSurface(lifecycle), false);
  assert.match(lifecycle.note ?? "", /low priority/i);
});

test("ignoring and deferring push a question down the queue without deleting it", () => {
  const fresh = newLifecycle(EVIDENCE);
  const ignored = markIgnored(markSurfaced(fresh, 1));
  const deferred = markDeferred(fresh);
  assert.equal(effectivePriorityOffset(fresh), 0);
  assert.ok(effectivePriorityOffset(ignored) > effectivePriorityOffset(fresh));
  assert.ok(
    effectivePriorityOffset(deferred) > effectivePriorityOffset(ignored),
    "an explicit 'not now' is a stronger signal than drifting past it",
  );
});

test("evolving keeps the user's accumulated disinterest", () => {
  let lifecycle = newLifecycle(EVIDENCE);
  lifecycle = markIgnored(markSurfaced(lifecycle, 1));
  lifecycle = markIgnored(markSurfaced(lifecycle, 2));
  const evolved = evolve(lifecycle, "p:fashion|st:active|items:3|q:1");
  assert.equal(evolved.state, "eligible");
  assert.equal(
    evolved.ignoredCount,
    2,
    "new evidence must not hand a tired suggestion a fresh set of attempts",
  );
  assert.equal(evolved.surfacedCount, 2);
});

test("an engaged question leaves the global surface for its workstream", () => {
  const engaged = markEngaged(markSurfaced(newLifecycle(EVIDENCE), 1), "conv-1");
  assert.equal(canSurface(engaged), false, "it is being handled, not pending");
  assert.equal(isWorkstreamOwned(engaged), true);
  assert.equal(engaged.workstreamId, "conv-1");
  // Even a changed situation belongs in the workstream now.
  assert.equal(shouldReconsider(engaged, "p:fashion|st:active|items:9"), false);
});

test("resolved and superseded questions are terminal", () => {
  for (const lifecycle of [
    markResolved(newLifecycle(EVIDENCE)),
    markSuperseded(newLifecycle(EVIDENCE), "absorbed into a broader question"),
  ]) {
    assert.equal(canSurface(lifecycle), false);
    assert.equal(shouldReconsider(lifecycle, "anything-at-all"), false);
  }
});

test("surfacing counts the showings, which is what ignoring is measured from", () => {
  const once = markSurfaced(newLifecycle(EVIDENCE), 10);
  assert.equal(once.state, "surfaced");
  assert.equal(once.surfacedCount, 1);
  assert.equal(once.lastSurfacedAt, 10);
  const twice = markSurfaced(once, 20);
  assert.equal(twice.surfacedCount, 2);
  assert.equal(twice.lastSurfacedAt, 20);
});

/* --------------------------- stored values --------------------------- */

test("a stored lifecycle round-trips", () => {
  const original = markDeferred(markSurfaced(newLifecycle(EVIDENCE), 5));
  const parsed = parseLifecycle(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(parsed, original);
});

test("a malformed stored lifecycle reads as none, never as a dead state", () => {
  // A record whose state is a string nothing matches would never surface
  // again and never be reconsidered — silently losing the question.
  for (const bad of [null, undefined, 42, "surfaced", [], {}, { state: "nonsense" }]) {
    assert.equal(parseLifecycle(bad), null);
  }
});

test("a partial stored lifecycle is filled with safe defaults", () => {
  const parsed = parseLifecycle({ state: "dismissed" });
  assert.ok(parsed);
  assert.equal(parsed.state, "dismissed");
  assert.equal(parsed.surfacedCount, 0);
  assert.equal(parsed.ignoredCount, 0);
  assert.equal(parsed.evidence, "");
  assert.equal(canSurface(parsed), false, "a dismissal survives a partial record");
});

test("negative or non-finite counts from storage are not trusted", () => {
  const parsed = parseLifecycle({
    state: "eligible",
    surfacedCount: -5,
    ignoredCount: Number.NaN,
    deferredCount: "lots",
  });
  assert.ok(parsed);
  assert.equal(parsed.surfacedCount, 0);
  assert.equal(parsed.ignoredCount, 0);
  assert.equal(parsed.deferredCount, 0);
});
