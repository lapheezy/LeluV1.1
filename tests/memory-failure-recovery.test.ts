/**
 * ==========================================================
 * LÉLU — RECOVERY AND MEMORY INTEGRITY
 *
 * Mission 44.8 WP07. Each test is one failure the mission names,
 * and each asserts the two things that make recovery meaningful:
 * the state afterwards is consistent, and a failed operation was
 * not reported as a success.
 *
 * Storage failure is produced by making `localStorage.setItem`
 * throw — the same thing a full quota or a private-mode browser
 * does — rather than by stubbing our own code.
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

import StandingInstructions from "../src/core/governance/StandingInstructions";
import WorkContinuity from "../src/core/continuity/WorkContinuity";
import MemoryObservability from "../src/core/memory/MemoryObservability";
import { readMemory } from "../src/core/memory/MemoryProvenance";
import KvStore from "../src/core/storage/KvStore";

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

/** Run `body` while every durable write fails, the way a full quota does. */
function withFailingStorage<T>(body: () => T): T {
  const storage = globalThis.localStorage as Storage;
  const original = storage.setItem;
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    return body();
  } finally {
    storage.setItem = original;
  }
}

function freshAll() {
  KvStore.getInstance().remove("work.v1");
  KvStore.getInstance().remove("instructions.v1");
  KvStore.getInstance().remove("memory.observability.v1");
  WorkContinuity.resetForTests();
  StandingInstructions.resetForTests();
  MemoryObservability.resetForTests();
  return {
    work: WorkContinuity.getInstance(),
    instructions: StandingInstructions.getInstance(),
    metrics: MemoryObservability.getInstance(),
  };
}

/* ------------------------------------------------------------------ */
/* 1. Interrupted memory write                                         */
/* ------------------------------------------------------------------ */

test("a write that storage refused is reported as not persisted", () => {
  const { instructions } = freshAll();

  const outcome = withFailingStorage(() =>
    instructions.record("Always run the suite before claiming a pass.", { conversationId: "chat-a" }, NOW),
  );

  assert.ok(outcome);
  assert.equal(outcome.persisted, false, "the caller is told the write did not land");
  assert.equal(outcome.instruction.text.includes("suite"), true, "the record still governs this session");
});

test("after a reload, a write that was refused is genuinely gone — not silently forgotten", () => {
  const { instructions } = freshAll();
  withFailingStorage(() =>
    instructions.record("Always run the suite before claiming a pass.", { conversationId: "chat-a" }, NOW),
  );
  assert.equal(instructions.list().length, 1, "it exists in this process");

  StandingInstructions.resetForTests();
  const reloaded = StandingInstructions.getInstance();
  assert.equal(reloaded.list().length, 0, "and it was never durable — the outcome said so");

  // With storage working, the same record survives the same reload.
  reloaded.record("Always run the suite before claiming a pass.", { conversationId: "chat-a" }, NOW);
  StandingInstructions.resetForTests();
  assert.equal(StandingInstructions.getInstance().list().length, 1);
});

test("a step whose ledger write failed says so", () => {
  const { work } = freshAll();
  const { record } = work.start({ objective: "Durable step", steps: ["Write it"], conversationId: "chat-a" });
  const outcome = withFailingStorage(() => work.completeStep(record.id, "Write it", { evidence: "done" }));

  assert.ok(outcome);
  assert.equal(outcome.persisted, false);
  assert.equal(outcome.step.status, "completed", "the in-session state is still coherent");
});

/* ------------------------------------------------------------------ */
/* 2. Duplicate execution                                              */
/* ------------------------------------------------------------------ */

test("a step cannot be completed twice, and the attempt is not counted", () => {
  const { work, metrics } = freshAll();
  const { record } = work.start({ objective: "No duplicates", steps: ["Deploy the report"], conversationId: "chat-a" });
  work.completeStep(record.id, "Deploy the report", { evidence: "published" });
  const again = work.completeStep(record.id, "Deploy the report", { evidence: "published again" });

  assert.ok(again);
  assert.equal(again.duplicatePrevented, true);
  metrics.record({ kind: "duplicate-prevented", conversationId: "chat-a" });
  assert.equal(metrics.snapshot(NOW).total.duplicatePrevented, 1);
});

/* ------------------------------------------------------------------ */
/* 3. Conflicting memory updates                                       */
/* ------------------------------------------------------------------ */

test("a conflicting update is surfaced rather than silently resolved", () => {
  const result = readMemory(
    [
      { id: "a", response: "The report ships on Friday.", category: "project", createdAt: NOW - 20 * DAY, updatedAt: NOW - 20 * DAY, context: { conversationId: "chat-a" } },
      { id: "b", response: "The report does not ship on Friday; it moved to March.", category: "project", createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, context: { conversationId: "chat-b" } },
    ],
    { now: NOW },
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.records.find((reading) => reading.id === "b")?.status, "conflicting");
  assert.equal(result.records.find((reading) => reading.id === "a")?.status, "superseded");
  assert.ok(result.records.every((reading) => reading.status !== "current"), "neither is presented as settled");
});

/* ------------------------------------------------------------------ */
/* 4. Stale retrieval                                                  */
/* ------------------------------------------------------------------ */

test("a stale record retrieved for a question is labelled stale, not answered as current", () => {
  const result = readMemory(
    [{ id: "old", response: "The build passes on the mission branch.", category: "project", createdAt: NOW - 90 * DAY, updatedAt: NOW - 90 * DAY, context: { conversationId: "chat-a" } }],
    { now: NOW },
  );
  assert.equal(result.records[0].status, "stale");
  assert.equal(result.records[0].evidence, "memory");
  assert.ok(result.records[0].reasons.some((reason) => /recorded 3 months ago/.test(reason)));
});

/* ------------------------------------------------------------------ */
/* 5. Failed governance authorization                                  */
/* ------------------------------------------------------------------ */

test("a refusal is a refusal before and after an investigation", () => {
  const { instructions } = freshAll();
  const outcome = instructions.record("Always apply changes to the real project.", { conversationId: "chat-a" });
  assert.ok(outcome);
  assert.equal(instructions.authorityOf(outcome.instruction.id).allowed, false);

  instructions.markInvestigated(outcome.instruction.id, { result: "verified" });
  assert.equal(instructions.authorityOf(outcome.instruction.id).allowed, false);
  assert.match(instructions.authorityOf(outcome.instruction.id).reason, /not an authorization/);
});

/* ------------------------------------------------------------------ */
/* 6. Concurrent conversations, shared project                         */
/* ------------------------------------------------------------------ */

test("two conversations working the same project converge on one ledger", () => {
  const { work } = freshAll();
  const first = work.start({ objective: "Ship the layer", steps: ["Write", "Verify"], projectId: "p-1", conversationId: "chat-a" });
  const second = work.start({ objective: "Ship the layer", steps: ["Write", "Verify"], projectId: "p-1", conversationId: "chat-b" });

  assert.equal(second.record.id, first.record.id);
  assert.equal(work.list().length, 1);

  work.completeStep(first.record.id, "Write", { evidence: "from chat-a" });
  const duplicate = work.completeStep(second.record.id, "Write", { evidence: "from chat-b" });
  assert.ok(duplicate);
  assert.equal(duplicate.duplicatePrevented, true, "the second conversation cannot redo it");
  assert.equal(duplicate.step.evidence, "from chat-a");

  const record = work.get(first.record.id);
  assert.equal(record?.steps.filter((step) => step.status === "completed").length, 1);
});

/* ------------------------------------------------------------------ */
/* 7. Interruption leaves a consistent, auditable state                */
/* ------------------------------------------------------------------ */

test("an interruption mid-step leaves no half-finished state", () => {
  const { work } = freshAll();
  const { record } = work.start({ objective: "Recoverable", steps: ["One", "Two", "Three"], conversationId: "chat-a" });
  work.completeStep(record.id, "One", { evidence: "done" });
  work.startStep(record.id, "Two");
  const interrupted = work.interrupt(record.id, "server terminated");

  assert.ok(interrupted);
  assert.deepEqual(
    interrupted.steps.map((step) => step.status),
    ["completed", "pending", "pending"],
    "no step is left active after an interruption",
  );
  assert.equal(interrupted.lastInterruption?.reason, "server terminated");
  assert.equal(interrupted.interruptions, 1);

  const plan = work.resume({ projectId: null, conversationId: "chat-b" });
  assert.ok(plan);
  assert.equal(plan.completed.length, 1);
  assert.equal(plan.remaining.length, 2);
  assert.equal(plan.resumed, true);
});
