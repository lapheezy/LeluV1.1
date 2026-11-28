/**
 * ==========================================================
 * LÉLU — A REMEMBERED INSTRUCTION IS NOT A PERMISSION
 *
 * Mission 44.8 WP03 + WP05. The five things this suite separates:
 *
 *   remembering an instruction
 *   understanding it
 *   being authorized to execute it
 *   successfully executing it
 *   verifying the outcome
 *
 * A record may reach 1 and 2. It may hold 5's result. It must never
 * reach 3 — and the way that is proved is by asking the record for
 * permission after it has been marked applied and verified, in every
 * scope, and getting a refusal each time.
 *
 * The second half is recurrence: a correction arriving twice must open
 * an investigation, not produce another acknowledgement.
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

import StandingInstructions, {
  classifyInstruction,
  instructionKey,
  sameInstruction,
  systemFor,
} from "../src/core/governance/StandingInstructions";
import KvStore from "../src/core/storage/KvStore";

const KEY = "instructions.v1";

function fresh(): StandingInstructions {
  KvStore.getInstance().remove(KEY);
  StandingInstructions.resetForTests();
  return StandingInstructions.getInstance();
}

/* ------------------------------------------------------------------ */
/* 1. Not every sentence is an instruction                             */
/* ------------------------------------------------------------------ */

test("a statement with no durability marker is not minted as an instruction", () => {
  assert.equal(classifyInstruction("I like coffee."), null);
  assert.equal(classifyInstruction("Use platinum."), null, "a decision, not a standing rule");
  assert.equal(classifyInstruction("Can you show me the projects?"), null);
  assert.equal(classifyInstruction("thanks"), null);
});

test("an explicit instruction is classified, in the right kind", () => {
  assert.equal(classifyInstruction("Always run the full test suite before committing."), "standing-preference");
  assert.equal(
    classifyInstruction("I told you to stop putting tables in replies."),
    "correction",
  );
  assert.equal(classifyInstruction("The avatar preview is still broken."), "unresolved-defect");
  assert.equal(classifyInstruction("That fix didn't work."), "failed-implementation");
  assert.equal(classifyInstruction("For now, keep replies short."), "temporary");
  assert.equal(
    classifyInstruction("Always keep the project's deploy notes up to date."),
    "project-requirement",
  );
});

test("two phrasings of one instruction are recognised as the same", () => {
  assert.ok(sameInstruction("Always run the tests.", "Please always run the tests"));
  assert.equal(instructionKey("Please always run the tests!"), "always run tests");
  assert.ok(!sameInstruction("Always run the tests.", "Never run the tests."));
});

test("every instruction maps to a real system, or says it could not", () => {
  assert.match(systemFor("Always run the tests before committing"), /verification/);
  assert.match(systemFor("Remember that I prefer platinum"), /MemoryBridge/);
  assert.match(systemFor("Always ask before approving a deployment"), /governance/);
  assert.match(systemFor("Always use the purple accent"), /interface/);
  assert.match(systemFor("Always hum a tune"), /unclassified/);
});

/* ------------------------------------------------------------------ */
/* 2. Authority: the refusal is structural                             */
/* ------------------------------------------------------------------ */

test("a recorded instruction carries preference authority and no grants", () => {
  const instructions = fresh();
  const outcome = instructions.record("Always commit the work you finish.", { conversationId: "c-1" });
  assert.ok(outcome);
  const permission = instructions.authorityOf(outcome.instruction.id);

  assert.equal(permission.allowed, false);
  assert.deepEqual(permission.grants, []);
  assert.match(permission.reason, /not an authorization/);
  assert.ok(permission.requires.some((entry) => /ApprovalGate/.test(entry)));
  assert.ok(permission.requires.some((entry) => /EngineeringAuthorization/.test(entry)));
});

test("no later status turns a remembered instruction into a permission", () => {
  const instructions = fresh();
  const outcome = instructions.record("Always push to the mission branch.", { conversationId: "c-1" });
  assert.ok(outcome);
  const id = outcome.instruction.id;

  for (const result of ["updated", "verified", "unchanged", "not-determined"] as const) {
    instructions.markInvestigated(id, { result });
    const permission = instructions.executionPermission(id);
    assert.equal(permission.allowed, false, `status ${result} must still refuse`);
  }

  // And a verified record — the strongest state this system has — is
  // still only a preference.
  instructions.markInvestigated(id, { result: "verified" });
  assert.equal(instructions.get(id)?.status, "verified");
  assert.equal(instructions.authorityOf(id).allowed, false);
});

test("the context block tells cognition that instructions are not permissions", () => {
  const instructions = fresh();
  instructions.record("Always run typecheck before you claim a build passed.", { conversationId: "c-1" });
  const block = instructions.contextBlock({ conversationId: "c-1" });

  assert.match(block, /Standing instructions \(preferences, not permissions\)/);
  assert.match(block, /does not authorize an action/);
  assert.match(block, /typecheck/);
});

/* ------------------------------------------------------------------ */
/* 3. Recurrence: investigate, do not acknowledge again                */
/* ------------------------------------------------------------------ */

test("the first mention is recorded without an investigation", () => {
  const instructions = fresh();
  const outcome = instructions.record("Always keep replies short.", { conversationId: "c-1" });
  assert.ok(outcome);
  assert.equal(outcome.repeated, false);
  assert.equal(outcome.investigationRequired, false);
  assert.equal(outcome.instruction.investigation, undefined);
  assert.equal(outcome.note, "");
});

test("a repeated correction opens an investigation naming the system", () => {
  const instructions = fresh();
  instructions.record("Always keep replies short.", { conversationId: "c-1" }, 1_000);
  const second = instructions.record("I told you again: always keep replies short.", { conversationId: "c-2" }, 2_000);

  assert.ok(second);
  assert.equal(second.repeated, true);
  assert.equal(second.investigationRequired, true);
  assert.equal(second.instruction.timesSeen, 2);
  assert.equal(second.instruction.status, "investigating");
  assert.ok(second.instruction.investigation);
  assert.equal(second.instruction.investigation.result, "pending");
  assert.match(second.instruction.investigation.system, /reply composition/);
  assert.match(second.note, /You have said this 2 times/);
  assert.match(second.note, /recording it again is not the answer/);
  assert.match(second.note, /not verified that the behaviour changed/);
  assert.ok(second.instruction.conversationIds.includes("c-2"), "both conversations are on the record");
});

test("a third repetition counts as a further attempt, not a new record", () => {
  const instructions = fresh();
  // Distinct turns, minutes apart — not the same message retried within
  // seconds, which StandingInstructions deliberately counts once.
  instructions.record("The avatar preview is still broken.", { conversationId: "c-1" }, 1_000);
  instructions.record("The avatar preview is still broken.", { conversationId: "c-1" }, 120_000);
  const third = instructions.record("The avatar preview is still broken.", { conversationId: "c-1" }, 240_000);

  assert.ok(third);
  assert.equal(third.instruction.timesSeen, 3);
  assert.equal(third.instruction.investigation?.attempts, 2);
  assert.equal(instructions.list().length, 1);
});

test("the repeated correction supplies the line the reply must lead with", () => {
  const instructions = fresh();
  instructions.record("Always run the full test suite before claiming a pass.", { conversationId: "c-1" }, 1_000);
  assert.equal(instructions.recurrenceFor("Always run the full test suite before claiming a pass."), "", "nothing to say before it repeats");

  instructions.record("I told you before: always run the full test suite before claiming a pass.", { conversationId: "c-1" }, 120_000);
  const note = instructions.recurrenceFor("I told you before: always run the full test suite before claiming a pass.");
  assert.match(note, /You have said this 2 times/);
  assert.match(note, /not the answer/);
  assert.match(note, /verification/, "the owning system is named");
  assert.equal(instructions.recurrenceFor("hello"), "", "an unrelated message gets nothing");
});

test("an investigation can be closed only by recording what was found", () => {
  const instructions = fresh();
  instructions.record("Always run the tests.", { conversationId: "c-1" }, 1_000);
  const second = instructions.record("I told you: always run the tests.", { conversationId: "c-1" }, 2_000);
  assert.ok(second?.instruction.investigation);

  const updated = instructions.markInvestigated(second.instruction.id, {
    result: "updated",
    limitation: "the record now says so; not re-run yet",
  });
  assert.equal(updated?.status, "applied");
  assert.equal(updated?.investigation?.result, "updated");
  assert.match(updated?.investigation?.limitation ?? "", /not re-run yet/);

  const verified = instructions.markInvestigated(second.instruction.id, { result: "verified" });
  assert.equal(verified?.status, "verified");
  assert.ok(verified?.investigation?.verifiedAt);
});

/* ------------------------------------------------------------------ */
/* 4. Scope, withdrawal, persistence                                   */
/* ------------------------------------------------------------------ */

test("a project instruction does not leak into another project", () => {
  const instructions = fresh();
  instructions.record("Always keep the project's deploy notes current.", { projectId: "project-a" });
  assert.equal(instructions.contextBlock({ projectId: "project-a" }).includes("deploy notes"), true);
  assert.equal(instructions.contextBlock({ projectId: "project-b" }).includes("deploy notes"), false);
});

test("a temporary instruction is kept out of the standing block", () => {
  const instructions = fresh();
  instructions.record("For now, answer in one line.", { conversationId: "c-1" });
  assert.equal(instructions.contextBlock({ conversationId: "c-1" }), "");
});

test("an instruction can be withdrawn", () => {
  const instructions = fresh();
  const outcome = instructions.record("Never use em dashes.", { conversationId: "c-1" });
  assert.ok(outcome);
  assert.equal(instructions.retract(outcome.instruction.id), true);
  assert.equal(instructions.list().length, 0);
  assert.equal(instructions.authorityOf(outcome.instruction.id).allowed, false);
});

test("instructions survive a restart", () => {
  const instructions = fresh();
  instructions.record("Always name the branch in a handover.", { conversationId: "c-1" }, 5_000);

  StandingInstructions.resetForTests();
  const reloaded = StandingInstructions.getInstance();
  const records = reloaded.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].text, "Always name the branch in a handover.");
  assert.equal(records[0].firstSeenAt, 5_000);
});
