/**
 * ==========================================================
 * LÉLU — MISSION 44.8 ACCEPTANCE
 *
 * The seven scenarios the mission defines, each as one executable
 * test against the real modules. These are not mocks of the
 * capability; they are the capability, exercised through its public
 * surface:
 *
 *   A  remember and retrieve across conversations
 *   B  correct, update, and survive a reload
 *   C  resume work without repeating completed steps
 *   D  a standing instruction does not authorize an action
 *   E  conflicting records are identified, not silently chosen
 *   F  a repeated correction produces an investigation
 *   G  measurements correspond to recorded operations
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

import WorkContinuity from "../src/core/continuity/WorkContinuity";
import StandingInstructions from "../src/core/governance/StandingInstructions";
import MemoryObservability from "../src/core/memory/MemoryObservability";
import { memoryProvenanceNote, readMemory } from "../src/core/memory/MemoryProvenance";
import ProjectStore from "../src/core/projects/ProjectStore";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import KvStore from "../src/core/storage/KvStore";

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function resetAll() {
  for (const key of ["work.v1", "instructions.v1", "memory.observability.v1"]) {
    KvStore.getInstance().remove(key);
  }
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
/* A — remember and retrieve, across conversations                     */
/* ------------------------------------------------------------------ */

test("A: an objective stated in one conversation is retrieved in another, with its source", () => {
  const { work } = resetAll();

  work.start({
    objective: "Close Mission 44.8 with a verified report",
    steps: ["Audit memory", "Write the modules", "Run acceptance"],
    constraints: ["no new dependencies"],
    conversationId: "conversation-a",
    at: NOW,
  });

  const plan = work.resume({ projectId: null, conversationId: "conversation-b", at: NOW + 1000 });
  assert.ok(plan, "the objective was found from a different conversation");
  assert.equal(plan.record.objective, "Close Mission 44.8 with a verified report");
  assert.equal(plan.record.conversationId, "conversation-a", "the source conversation is recorded");
  assert.match(plan.context, /Stated in conversation conversation-a/);
  assert.match(plan.context, /no new dependencies/);
});

/* ------------------------------------------------------------------ */
/* B — correct and update, and survive a reload                        */
/* ------------------------------------------------------------------ */

test("B: a corrected record replaces the wrong one and is what a reload sees", () => {
  resetAll();
  const projects = ProjectStore.getInstance();
  const project = projects.create({ name: "Correction acceptance" });

  // The wrong information, recorded first.
  projects.update(project.id, { objective: "Ship in rose gold" });
  assert.equal(projects.get(project.id)?.objective, "Ship in rose gold");

  // The correction.
  projects.update(project.id, { objective: "Ship in platinum, not rose gold" });

  // What durable storage holds — this is what a reload reads.
  const stored = KvStore.getInstance().get<Array<{ id: string; objective?: string }>>("projects.v1");
  const persisted = stored?.find((entry) => entry.id === project.id);
  assert.equal(persisted?.objective, "Ship in platinum, not rose gold");
  assert.ok(!JSON.stringify(stored).includes("Ship in rose gold"), "the wrong value is not still in the authoritative store");
});

test("B: a superseded memory states the correction instead of the old value", () => {
  const result = readMemory(
    [
      {
        id: "metal",
        response:
          "platinum, not rose gold\n(Superseded earlier statement, kept for the details it still carries: 18k rose gold)",
        category: "preference",
        createdAt: NOW - 8 * DAY,
        updatedAt: NOW - DAY,
        context: { conversationId: "conversation-a", history: ["I work exclusively in 18k rose gold."] },
      },
    ],
    { now: NOW },
  );
  const note = memoryProvenanceNote(result);
  assert.match(note, /superseded by/);
  assert.match(note, /platinum/);
});

/* ------------------------------------------------------------------ */
/* C — resume work without repeating it                                */
/* ------------------------------------------------------------------ */

test("C: completed steps are not repeated when the work resumes elsewhere", () => {
  const { work } = resetAll();
  const { record } = work.start({
    objective: "Implement continuity",
    steps: ["Write the ledger", "Wire it into the chat", "Test it"],
    conversationId: "conversation-a",
    at: NOW,
  });

  work.completeStep(record.id, "Write the ledger", { evidence: "WorkContinuity.ts", at: NOW });
  work.completeStep(record.id, "Wire it into the chat", { evidence: "MemoryBridge context", at: NOW });
  work.startStep(record.id, "Test it", NOW);
  work.interrupt(record.id, "the tab was closed", NOW + 10);

  const plan = work.resume({ projectId: null, conversationId: "conversation-b", at: NOW + 20 });
  assert.ok(plan);
  assert.equal(plan.completed.length, 2);
  assert.equal(plan.remaining.length, 1, "only the unfinished step is offered");
  assert.equal(plan.remaining[0].label, "Test it");

  // An attempt to redo completed work is refused rather than re-executed.
  const redo = work.completeStep(record.id, "Write the ledger", { evidence: "again" });
  assert.ok(redo);
  assert.equal(redo.duplicatePrevented, true);
  assert.equal(redo.step.evidence, "WorkContinuity.ts");
});

/* ------------------------------------------------------------------ */
/* D — a remembered instruction does not authorize                     */
/* ------------------------------------------------------------------ */

test("D: a standing instruction is remembered, understood, and still not a permission", () => {
  const { instructions } = resetAll();
  const levelBefore = AutonomyGate.getInstance().getLevel();

  const outcome = instructions.record("Always apply changes to the real project as soon as tests pass.", {
    conversationId: "conversation-a",
  });
  assert.ok(outcome);
  assert.equal(outcome.instruction.kind, "standing-preference", "it is understood as an instruction");

  const permission = instructions.authorityOf(outcome.instruction.id);
  assert.equal(permission.allowed, false);
  assert.ok(permission.requires.some((entry) => /ApprovalGate/.test(entry)));
  assert.ok(permission.requires.some((entry) => /EngineeringAuthorization/.test(entry)));

  assert.equal(
    AutonomyGate.getInstance().getLevel(),
    levelBefore,
    "remembering an instruction does not raise the autonomy ceiling",
  );
  assert.ok(permission.reason.includes("not an authorization"));
  assert.equal(outcome.instruction.authority, "preference");
});

/* ------------------------------------------------------------------ */
/* E — conflicting information                                         */
/* ------------------------------------------------------------------ */

test("E: two records with different timestamps produce an explicit conflict", () => {
  resetAll();
  const result = readMemory(
    [
      {
        id: "march",
        response: "The collection launches in March.",
        category: "project",
        createdAt: NOW - 40 * DAY,
        updatedAt: NOW - 40 * DAY,
        context: { conversationId: "conversation-a" },
      },
      {
        id: "may",
        response: "The collection does not launch in March; it moved to May.",
        category: "project",
        createdAt: NOW - 3 * DAY,
        updatedAt: NOW - 3 * DAY,
        context: { conversationId: "conversation-b" },
      },
    ],
    { now: NOW },
  );

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].resolution, "newer-wins");
  const note = memoryProvenanceNote(result);
  assert.match(note, /Memory conflict/);
  assert.match(note, /neither was verified in this turn/, "the answer is not presented as settled fact");
  assert.equal(result.records.find((reading) => reading.id === "may")?.status, "conflicting");
  assert.equal(result.records.find((reading) => reading.id === "march")?.status, "superseded");
});

/* ------------------------------------------------------------------ */
/* F — a repeated correction                                           */
/* ------------------------------------------------------------------ */

test("F: the second correction opens an investigation into why the first did not hold", () => {
  const { instructions } = resetAll();

  instructions.record("Always keep replies to three sentences.", { conversationId: "conversation-a" }, NOW);
  const second = instructions.record("I told you before: always keep replies to three sentences.", {
    conversationId: "conversation-a",
  }, NOW + 1000);

  assert.ok(second);
  assert.equal(second.investigationRequired, true);
  assert.match(second.note, /said this 2 times/);
  const system = second.instruction.investigation?.system ?? "";
  assert.match(system, /reply composition/, "the owning system is named, not guessed");

  // Locating and updating the record is recorded…
  instructions.markInvestigated(second.instruction.id, { result: "updated", limitation: "re-checked by hand" });
  assert.equal(instructions.get(second.instruction.id)?.status, "applied");

  // …and the context block a later turn sees reflects it, rather than
  // saying nothing changed.
  const block = instructions.contextBlock({ conversationId: "conversation-a" });
  assert.match(block, /investigation updated in reply composition/);

  // The behaviour correction is visible to cognition, but the record still
  // cannot authorize anything.
  assert.equal(instructions.authorityOf(second.instruction.id).allowed, false);
});

/* ------------------------------------------------------------------ */
/* G — measurements correspond to operations                           */
/* ------------------------------------------------------------------ */

test("G: every counter matches an operation that actually happened", () => {
  const { work, metrics } = resetAll();

  // Two retrievals, one write, one duplicate attempt.
  metrics.record({ kind: "retrieval", latencyMs: 40, items: 4, relevant: 3, conversationId: "conversation-a" });
  metrics.record({ kind: "retrieval", latencyMs: 60, items: 2, relevant: 1, conversationId: "conversation-a" });
  metrics.record({ kind: "memory-write", conversationId: "conversation-a" });

  const { record } = work.start({ objective: "Measured work", steps: ["One"], conversationId: "conversation-a" });
  work.completeStep(record.id, "One", { evidence: "done" });
  const duplicate = work.completeStep(record.id, "One", { evidence: "done again" });
  if (duplicate?.duplicatePrevented) metrics.record({ kind: "duplicate-prevented", conversationId: "conversation-a" });

  const snapshot = metrics.snapshot(Date.now());
  assert.equal(snapshot.total.retrievals, 2);
  assert.equal(snapshot.total.writes, 1);
  assert.equal(snapshot.total.duplicatePrevented, 1);
  assert.deepEqual(snapshot.total.latency, { min: 40, max: 60, average: 50, samples: 2 });
  assert.equal(snapshot.total.relevanceRate, 0.667, "4 of 6 retrieved records were used");
  assert.equal(snapshot.availability.retrievalLatency, "measured");
  assert.equal(snapshot.availability.totalStoreBytes, "unavailable", "an unmeasurable value is still declared");
});
