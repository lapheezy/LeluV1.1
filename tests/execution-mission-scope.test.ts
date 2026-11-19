/**
 * ==========================================================
 * LÉLU — MISSION AND REVISION PROVENANCE
 *
 * CATEGORY: unit. The real ExecutionEvidence helpers.
 *
 * M22.5 recorded that execution records carried no repository, branch,
 * commit or mission identity. The app genuinely cannot know them — a
 * browser tab has no repository — so they are not invented. A runner that
 * does know them (a mission harness, CI) declares the scope once, and every
 * record produced while it is set carries it into the existing ledger.
 *
 * These assertions pin both halves: the declared scope survives, and an
 * undeclared one is ABSENT rather than guessed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  currentMissionScope,
  formatExecutionLine,
  sanitizeExecutionRecord,
  setMissionScope,
  type ExecutionRecord,
} from "../src/core/tools/ExecutionEvidence";

function record(): ExecutionRecord {
  return {
    executionId: "chat-test-1",
    taskId: "task-1",
    path: "chat",
    tool: "memory.recall",
    approval: "not-required",
    stage: "succeeded",
    outcome: "succeeded",
  };
}

test("no declared scope means no mission field, never a guessed one", () => {
  setMissionScope(null);
  assert.equal(currentMissionScope(), null);
  assert.equal("mission" in sanitizeExecutionRecord(record()), false);
});

test("a declared mission, work package and commit survive sanitisation", () => {
  setMissionScope({
    id: "M22.6",
    workPackage: "G1",
    repo: "lapheezy/LeluV1.1",
    branch: "freebuff/m22-6-voice-runtime-release-qualification",
    commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  });

  // The dispatcher attaches the declared scope; sanitisation must preserve it.
  const scope = currentMissionScope();
  assert.ok(scope);
  const sanitized = sanitizeExecutionRecord({ ...record(), mission: scope });
  assert.equal(sanitized.mission?.id, "M22.6");
  assert.equal(sanitized.mission?.workPackage, "G1");
  assert.equal(sanitized.mission?.branch, "freebuff/m22-6-voice-runtime-release-qualification");
  assert.equal(sanitized.mission?.commit?.slice(0, 7), "deadbee");

  const line = formatExecutionLine({ ...record(), mission: sanitized.mission });
  assert.match(line, /mission=M22\.6/);
  assert.match(line, /wp=G1/);
  assert.match(line, /commit=deadbeefdead/);

  setMissionScope(null);
});

test("the scope is copied, so a caller cannot mutate a record's provenance", () => {
  setMissionScope({ id: "M22.6" });
  const first = currentMissionScope();
  assert.ok(first);
  first.id = "tampered";
  assert.equal(currentMissionScope()?.id, "M22.6");
  setMissionScope(null);
});
