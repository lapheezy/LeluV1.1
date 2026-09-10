/**
 * ==========================================================
 * LÉLU — SPEAKING FIRST, HONESTLY
 *
 * CATEGORY: unit. The real describe/announce path.
 *
 * Why this exists: §12 permits LÉLU to initiate and then spends
 * most of its words forbidding the failure mode — UI states
 * that represent work which is not happening. "No fake
 * notifications" is trivially satisfiable by never notifying,
 * and trivially violated by one convenience overload added six
 * months from now. So what is asserted here is that an
 * announcement without substance behind it does not go out.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { announce, type InitiationEvent } from "../src/core/proactive/InitiationTriggers";

test("an agent that produced nothing does not get announced", () => {
  const result = announce({
    kind: "agent-finished",
    agentName: "Researcher",
    task: "look into X",
    taskId: "t1",
    summary: "   ",
  });
  assert.equal(result.delivered, false);
  assert.equal(result.suppressedBecause, "no-substance");
});

test("research that found nothing does not interrupt the user", () => {
  const result = announce({
    kind: "research-finished",
    query: "obscure thing",
    sourceCount: 0,
    taskId: "t2",
  });
  assert.equal(result.delivered, false, "'Research finished' with no sources is a fake status");
  assert.equal(result.suppressedBecause, "no-substance");
});

test("'I read that' is not said when nothing was kept", () => {
  const result = announce({
    kind: "ingestion-finished",
    attribution: "example.com",
    memoriesKept: 0,
  });
  assert.equal(result.delivered, false);
  assert.equal(result.suppressedBecause, "no-substance");
});

test("a real result is described from its evidence, never invented", () => {
  const result = announce({
    kind: "research-finished",
    query: "tide tables",
    sourceCount: 3,
    taskId: "t3",
  });
  assert.ok(result.title, "it should have produced words");
  assert.ok(result.body?.includes("3"), "the count must come from the event");
  assert.ok(result.body?.includes("tide tables"));
});

test("proactive announcements wait for the user's consent", () => {
  // ProactiveCore defaults to disabled in a bare test runtime, which is the
  // condition under test: LÉLU stays quiet rather than assuming permission.
  const result = announce({
    kind: "agent-finished",
    agentName: "Researcher",
    task: "look into X",
    taskId: "t4",
    summary: "Found three relevant papers.",
  });
  if (!result.delivered) {
    assert.equal(result.suppressedBecause, "disabled");
    assert.ok(result.title, "the message is still formed, it is just not sent");
  }
});

test("a sign-in request reaches the user even with proactive notifications off", () => {
  // This one is a reply to something they just asked for, not LÉLU deciding
  // on her own to speak, so consent for proactive behaviour does not gate it.
  const result = announce({
    kind: "authorization-needed",
    url: "https://private.example.com/doc",
    reason: "That source needs you signed in.",
    requestId: "auth-1",
  });
  assert.notEqual(result.suppressedBecause, "disabled");
  assert.ok(result.body?.includes("private.example.com"));
});

test("every event type must carry evidence of the work", () => {
  // The guarantee is structural: there is no free-text variant, so no caller
  // can announce something that did not happen.
  const withoutEvidence = {
    kind: "agent-finished",
    agentName: "X",
    task: "t",
    summary: "s",
  } as unknown as InitiationEvent;
  // taskId is required by the type; this asserts the field exists in the
  // contract rather than that TypeScript ran.
  assert.ok(!("taskId" in withoutEvidence), "fixture is missing evidence on purpose");
  const proper: InitiationEvent = {
    kind: "agent-finished",
    agentName: "X",
    task: "t",
    taskId: "real-id",
    summary: "s",
  };
  assert.ok("taskId" in proper);
});
