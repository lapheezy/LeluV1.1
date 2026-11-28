/**
 * ==========================================================
 * LÉLU — WORK THAT SURVIVES THE CONVERSATION IT STARTED IN
 *
 * Mission 44.8 WP04. The scenario, end to end:
 *
 *   objective in conversation A → three steps, two done
 *   → interrupted → resumed in conversation B
 *   → the plan names what is done, so it is NOT repeated
 *   → the project's checkpoint says the same thing
 *
 * The two properties the mission calls out explicitly — "identify
 * completed work without repeating it" and "continue remaining
 * authorized work" — are the last group of tests, and they assert on
 * the text a new conversation would actually be given.
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

import WorkContinuity, { stepKey } from "../src/core/continuity/WorkContinuity";
import ProjectStore from "../src/core/projects/ProjectStore";
import KvStore from "../src/core/storage/KvStore";

function fresh(): WorkContinuity {
  KvStore.getInstance().remove("work.v1");
  WorkContinuity.resetForTests();
  return WorkContinuity.getInstance();
}

/* ------------------------------------------------------------------ */
/* 1. The step ledger                                                  */
/* ------------------------------------------------------------------ */

test("an objective becomes a ledger of steps", () => {
  const work = fresh();
  const { record, created } = work.start({
    objective: "Ship the memory continuity layer",
    steps: ["Audit the memory systems", "Write the provenance reader", "Run the full suite"],
    conversationId: "chat-a",
  });
  assert.equal(created, true);
  assert.equal(record.steps.length, 3);
  assert.ok(record.steps.every((step) => step.status === "pending"));
  assert.equal(stepKey("Run the full suite!"), "run full suite");
});

test("a step records its evidence, and an unknown step is added rather than lost", () => {
  const work = fresh();
  const { record } = work.start({ objective: "Audit", steps: ["Read the code"], conversationId: "chat-a" });
  const done = work.completeStep(record.id, "Read the code", { evidence: "61 files inspected" });
  assert.ok(done);
  assert.equal(done.step.status, "completed");
  assert.equal(done.step.evidence, "61 files inspected");

  const added = work.completeStep(record.id, "Write the report", { evidence: "report written" });
  assert.ok(added);
  assert.equal(added.record.steps.length, 2);
});

test("a failed step is recorded as failed, never as done", () => {
  const work = fresh();
  const { record } = work.start({ objective: "Verify", steps: ["Run the suite"], conversationId: "chat-a" });
  const outcome = work.completeStep(record.id, "Run the suite", { ok: false, evidence: "2 failures" });
  assert.ok(outcome);
  assert.equal(outcome.step.status, "failed");

  const plan = work.resume({ projectId: null, conversationId: "chat-a" });
  assert.ok(plan);
  assert.equal(plan.completed.length, 0, "a failure is not completed work");
  assert.equal(plan.blocked.length, 1);
  assert.ok(plan.context.includes("Blocked or failed"));
});

/* ------------------------------------------------------------------ */
/* 2. Idempotency — no duplicated work                                 */
/* ------------------------------------------------------------------ */

test("contracting the same objective twice continues one record", () => {
  const work = fresh();
  const first = work.start({ objective: "Ship the layer", steps: ["A"], projectId: "p-1", conversationId: "chat-a" });
  const second = work.start({ objective: "Ship the layer", steps: ["A"], projectId: "p-1", conversationId: "chat-b" });

  assert.equal(second.created, false);
  assert.equal(second.record.id, first.record.id);
  assert.equal(work.list().length, 1, "no rival record was created");
  assert.ok(second.record.resumedIn.includes("chat-b"), "the second conversation is on the record");
});

test("completing a step twice changes nothing and says so", () => {
  const work = fresh();
  const { record } = work.start({ objective: "Ship", steps: ["Write the reader"], conversationId: "chat-a" });
  const first = work.completeStep(record.id, "Write the reader", { evidence: "first" });
  const second = work.completeStep(record.id, "Write the reader", { evidence: "second" });

  assert.ok(first && second);
  assert.equal(second.duplicatePrevented, true);
  assert.equal(second.step.evidence, "first", "the second run does not overwrite the evidence");
  assert.equal(second.step.attempts, 1);
});

test("starting a step that is already complete refuses to run it again", () => {
  const work = fresh();
  const { record } = work.start({ objective: "Ship", steps: ["Write the reader"], conversationId: "chat-a" });
  work.completeStep(record.id, "Write the reader", { evidence: "done" });

  const again = work.startStep(record.id, "Write the reader");
  assert.ok(again);
  assert.equal(again.duplicatePrevented, true);
  assert.equal(again.step.status, "completed", "it stays completed rather than reverting to active");
  assert.equal(again.step.attempts, 1);
});

/* ------------------------------------------------------------------ */
/* 3. Interruption and resumption                                      */
/* ------------------------------------------------------------------ */

test("an interruption puts in-flight work back to pending, not completed", () => {
  const work = fresh();
  const { record } = work.start({
    objective: "Ship",
    steps: ["Audit", "Write", "Verify"],
    conversationId: "chat-a",
  });
  work.completeStep(record.id, "Audit", { evidence: "audit done" });
  work.startStep(record.id, "Write");
  const interrupted = work.interrupt(record.id, "the tab closed");
  assert.ok(interrupted);

  const write = interrupted.steps.find((step) => step.label === "Write");
  assert.equal(write?.status, "pending", "an interrupted step is not known to be done");
  assert.equal(interrupted.lastInterruption?.interruptedSteps.join(), "Write");
  assert.equal(interrupted.interruptions, 1);
});

test("resuming in another conversation names the completed work and the remaining work", () => {
  const work = fresh();
  const { record } = work.start({
    objective: "Ship the memory continuity layer",
    steps: ["Audit the memory systems", "Write the provenance reader", "Run the full suite"],
    constraints: ["no new dependencies"],
    conversationId: "chat-a",
  });
  work.completeStep(record.id, "Audit the memory systems", { evidence: "36 memory modules mapped" });
  work.completeStep(record.id, "Write the provenance reader", { evidence: "MemoryProvenance.ts" });
  work.startStep(record.id, "Run the full suite");
  work.interrupt(record.id, "server restarted");

  const plan = work.resume({ projectId: null, conversationId: "chat-b" });
  assert.ok(plan);
  assert.equal(plan.completed.length, 2);
  assert.equal(plan.remaining.length, 1);
  assert.equal(plan.remaining[0].label, "Run the full suite");
  assert.equal(plan.resumed, true);
  assert.equal(plan.resumptions, 1);
  assert.ok(plan.record.resumedIn.includes("chat-b"));

  // The block a new conversation actually receives.
  assert.match(plan.context, /## Work in progress — Ship the memory continuity layer/);
  assert.match(plan.context, /Stated in conversation chat-a/);
  assert.match(plan.context, /Already done \(do not repeat\):/);
  assert.match(plan.context, /- Audit the memory systems — 36 memory modules mapped/);
  assert.match(plan.context, /Still to do:\n- Run the full suite/);
  assert.match(plan.context, /Constraints: no new dependencies/);
  assert.match(plan.context, /Interrupted .*: server restarted — mid-way through: Run the full suite/);
  assert.match(plan.context, /do not redo a completed one/);

  // A completed step is not offered as work.
  assert.ok(!plan.remaining.some((step) => step.label === "Audit the memory systems"));
});

test("a finished record is no longer resumable", () => {
  const work = fresh();
  const { record } = work.start({ objective: "One-step job", steps: ["Do it"], conversationId: "chat-a" });
  work.completeStep(record.id, "Do it", { evidence: "done" });
  assert.equal(work.resume({ projectId: null, conversationId: "chat-b" }), null);
});

/* ------------------------------------------------------------------ */
/* 4. Project isolation and the shared checkpoint                      */
/* ------------------------------------------------------------------ */

test("two projects never share a ledger", () => {
  const work = fresh();
  const a = work.start({ objective: "Project A work", steps: ["A1", "A2"], projectId: "project-a", conversationId: "chat-a" });
  const b = work.start({ objective: "Project B work", steps: ["B1"], projectId: "project-b", conversationId: "chat-b" });
  work.completeStep(a.record.id, "A1", { evidence: "a done" });

  const planA = work.resume({ projectId: "project-a", conversationId: "chat-c" });
  assert.ok(planA);
  assert.equal(planA.record.id, a.record.id);
  assert.equal(planA.completed.length, 1);
  assert.equal(planA.remaining.length, 1);

  const planB = work.resume({ projectId: "project-b", conversationId: "chat-c" });
  assert.ok(planB);
  assert.equal(planB.record.id, b.record.id);
  assert.equal(planB.completed.length, 0, "project B's work was not credited with project A's step");
});

test("the project's existing checkpoint reflects the ledger", () => {
  const work = fresh();
  const project = ProjectStore.getInstance().create({ name: "Continuity acceptance" });

  const { record } = work.start({
    objective: "Build the continuity layer",
    steps: ["Write the ledger", "Verify it"],
    projectId: project.id,
    conversationId: "chat-a",
  });
  work.completeStep(record.id, "Write the ledger", { evidence: "WorkContinuity.ts" });

  const stored = ProjectStore.getInstance().get(project.id);
  assert.ok(stored?.checkpoint, "the checkpoint is written through the existing ProjectStore");
  assert.deepEqual(stored.checkpoint.completed, ["Write the ledger"]);
  assert.deepEqual(stored.checkpoint.pending, ["Verify it"]);
  assert.equal(stored.checkpoint.nextAction, "Verify it");
  assert.equal(stored.checkpoint.summary, "Build the continuity layer");

  work.completeStep(record.id, "Verify it", { evidence: "6 tests pass" });
  const finished = ProjectStore.getInstance().get(project.id);
  assert.equal(finished?.checkpoint?.status, "completed");
  assert.deepEqual(finished?.checkpoint?.pending, []);
});

test("the ledger survives a restart", () => {
  const work = fresh();
  const { record } = work.start({ objective: "Durable work", steps: ["One step"], conversationId: "chat-a" });
  work.completeStep(record.id, "One step", { evidence: "done" });

  WorkContinuity.resetForTests();
  const reloaded = WorkContinuity.getInstance();
  const restored = reloaded.get(record.id);
  assert.ok(restored, "the record was read back from storage");
  assert.equal(restored.steps[0].status, "completed");
  assert.equal(restored.steps[0].evidence, "done");
});
