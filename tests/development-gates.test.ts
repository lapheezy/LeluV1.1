/**
 * ==========================================================
 * LÉLU — THE TWO GATES CANNOT BE SKIPPED OR OUTLIVED
 *
 *   1. Every self-study proposal stays in the development record,
 *      even when its study is no longer on this device (the study
 *      history is capped and device-local; proposals sync).
 *   2. An implementation the owner ACCEPTED at Gate 2 is never
 *      replaced by a new, unreviewed one.
 *   3. A proposal RETURNED at Gate 2 is developed again with the
 *      owner's feedback in the engineering brief, and the new
 *      implementation awaits acceptance afresh.
 *   4. Neither gate can be recorded out of order.
 *   5. The owner decision survives the persisted round-trip
 *      (local store and the JSON state the remote sync writes).
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

import ImprovementQueue, { type ImprovementProposal } from "../src/core/selfdev/ImprovementQueue";
import SelfDevelopmentLoop from "../src/core/selfdev/SelfDevelopmentLoop";
import ProposalEngineer from "../src/core/selfdev/ProposalEngineer";
import { buildDevelopmentRecord, formatDevelopmentRecord } from "../src/core/selfdev/DevelopmentRecord";

const queue = ImprovementQueue.getInstance();

function selfStudyProposal(subject: string, status: ImprovementProposal["status"] = "Proposed"): ImprovementProposal {
  return queue.add({
    title: `Fix ${subject}`,
    problem: `What does ${subject} contribute?`,
    observation: `${subject} reports the wrong count.`,
    evidence: `Read ${subject}.\nFAILING count check`,
    proposedSolution: `Correct the count in ${subject}.`,
    expectedBenefit: "The count is right.",
    dependencies: [],
    risk: "low",
    requiredTools: [],
    requiredAgents: [],
    complexity: "low",
    kind: "Bug",
    version: "1",
    testPlan: "tests/x.test.ts",
    origin: { kind: "self-study", objectiveId: `gone-${subject}`, subject, cycle: 7 },
    status,
  });
}

const implemented = {
  lastExecution: {
    executionId: "e1", kind: "develop" as const, started: 1, finished: 2,
    filesInspected: ["src/a.ts"], filesChanged: ["src/a.ts"],
    checks: [{ name: "test", ok: true, detail: "3/3" }], diff: "--- a\n+++ b",
  },
};

test("a self-study proposal whose study is gone is still in the record, at its real stage", () => {
  const proposal = selfStudyProposal("src/core/demo/Orphan.ts");
  // No objectives at all: the study history was evicted or lives on another device.
  let record = buildDevelopmentRecord([], queue.list());
  let entry = record.find((item) => item.proposal?.id === proposal.id);
  assert.ok(entry, "the proposal is shown although its study is not on this device");
  assert.equal(entry!.stage, "awaiting-approval");
  assert.equal(entry!.conclusion.change, proposal.proposedSolution);
  assert.deepEqual(entry!.evidence, ["Read src/core/demo/Orphan.ts.", "FAILING count check"]);
  assert.match(formatDevelopmentRecord(record), /awaiting your approval \(Gate 1\)/);

  queue.update(proposal.id, { status: "Ready", ...implemented });
  record = buildDevelopmentRecord([], queue.list());
  entry = record.find((item) => item.proposal?.id === proposal.id);
  assert.equal(entry!.stage, "awaiting-acceptance");
  assert.equal(entry!.proposal?.implementation?.checks[0].ok, true);

  // Exactly one entry per proposal.
  assert.equal(record.filter((item) => item.proposal?.id === proposal.id).length, 1);
  queue.remove(proposal.id);
});

test("neither gate can be recorded out of order", () => {
  const proposal = selfStudyProposal("src/core/demo/Order.ts");
  // Gate 2 before any implementation: refused.
  assert.equal(queue.recordOwnerDecision(proposal.id, "accepted"), false);
  assert.equal(queue.recordOwnerDecision(proposal.id, "returned", "no"), false);
  for (const status of ["Approved", "In Development", "Testing", "Failed", "Blocked", "Rejected"] as const) {
    queue.update(proposal.id, { status });
    assert.equal(queue.recordOwnerDecision(proposal.id, "accepted"), false, `Gate 2 refused while ${status}`);
  }
  // Gate 1 approval does not apply to work that is implemented or decided.
  queue.update(proposal.id, { status: "Ready", ...implemented });
  assert.equal(SelfDevelopmentLoop.getInstance().approve(proposal.id), false, "a Ready proposal is not re-approved");
  assert.equal(queue.get(proposal.id)!.status, "Ready");
  queue.remove(proposal.id);
});

test("an implementation the owner accepted is never replaced by an unreviewed one", async () => {
  const proposal = selfStudyProposal("src/core/demo/Accepted.ts", "Ready");
  queue.update(proposal.id, implemented);
  assert.equal(queue.recordOwnerDecision(proposal.id, "accepted", "Good."), true);
  const before = queue.get(proposal.id)!;

  const loop = SelfDevelopmentLoop.getInstance();
  for (const run of [() => loop.retry(proposal.id), () => loop.develop(proposal.id)]) {
    const result = await run();
    assert.equal(result.success, false);
    assert.match(result.summary, /accepted this implementation at Gate 2/);
  }
  const after = queue.get(proposal.id)!;
  assert.equal(after.status, "Ready");
  assert.deepEqual(after.ownerDecision, before.ownerDecision);
  assert.deepEqual(after.lastExecution, before.lastExecution, "the accepted diff is untouched");
  assert.deepEqual(queue.canRedevelop(proposal.id).ok, false);
  queue.remove(proposal.id);
});

test("a returned proposal is developed again with the feedback, and awaits acceptance afresh", async () => {
  const proposal = selfStudyProposal("src/core/demo/Returned.ts", "Ready");
  queue.update(proposal.id, implemented);
  assert.equal(queue.recordOwnerDecision(proposal.id, "returned", "The count is still off by one on an empty list."), true);
  assert.equal(buildDevelopmentRecord([], queue.list()).find((e) => e.proposal?.id === proposal.id)!.stage, "returned");
  assert.equal(queue.canRedevelop(proposal.id).ok, true);

  // What the development loop does at the start of the new run.
  const feedback = queue.beginRedevelopment(proposal.id);
  assert.deepEqual(feedback, ["The count is still off by one on an empty list."]);
  const reopened = queue.get(proposal.id)!;
  assert.equal(reopened.ownerDecision, undefined, "the new implementation is judged afresh");
  assert.equal(reopened.ownerFeedbackHistory?.[0].decision, "returned");
  assert.equal(queue.beginRedevelopment(proposal.id).length, 1, "idempotent: the note is not duplicated");

  // The engineering agent's brief carries the feedback.
  const prompts: string[] = [];
  const engineer = new ProposalEngineer(async (prompt) => {
    prompts.push(prompt);
    return { text: "{}", provider: "stub", model: "stub" };
  });
  await engineer.generate(reopened, {
    listSources: async () => ["src/core/demo/Returned.ts"],
    listTests: async () => [],
    read: async () => "export const n = 1;\n",
  });
  assert.ok(prompts.length >= 1);
  assert.match(prompts[0], /Owner feedback on the previous implementation \(address this\): The count is still off by one on an empty list\./);

  // A new implementation lands: it awaits acceptance, showing what it addresses.
  queue.update(proposal.id, { status: "Ready", ...implemented });
  const entry = buildDevelopmentRecord([], queue.list()).find((e) => e.proposal?.id === proposal.id)!;
  assert.equal(entry.stage, "awaiting-acceptance");
  assert.equal(entry.proposal?.feedbackHistory?.[0].note, "The count is still off by one on an empty list.");
  queue.remove(proposal.id);
});

test("accepting a returned implementation keeps the earlier feedback on record", () => {
  const proposal = selfStudyProposal("src/core/demo/ChangedMind.ts", "Ready");
  queue.update(proposal.id, implemented);
  queue.recordOwnerDecision(proposal.id, "returned", "Check the empty list.");
  assert.equal(queue.recordOwnerDecision(proposal.id, "accepted"), true);
  const after = queue.get(proposal.id)!;
  assert.equal(after.ownerDecision?.decision, "accepted");
  assert.deepEqual(after.ownerFeedbackHistory?.map((item) => item.note), ["Check the empty list."]);
  queue.remove(proposal.id);
});

test("the owner's decision survives the persisted round-trip", () => {
  const proposal = selfStudyProposal("src/core/demo/Persisted.ts", "Ready");
  queue.update(proposal.id, implemented);
  queue.recordOwnerDecision(proposal.id, "returned", "Tighten the test.");
  queue.beginRedevelopment(proposal.id);
  queue.update(proposal.id, { status: "Ready" });
  queue.recordOwnerDecision(proposal.id, "accepted", "Now good.");

  // The remote sync writes the whole proposal as JSON `state` and reads it back.
  const stored = JSON.parse(JSON.stringify(queue.get(proposal.id))) as ImprovementProposal;
  queue.remove(proposal.id);
  queue.mergeRemote([{ ...stored, updated: stored.updated + 1 }]);
  const restored = queue.get(proposal.id)!;
  assert.equal(restored.ownerDecision?.decision, "accepted");
  assert.equal(restored.ownerDecision?.note, "Now good.");
  assert.equal(restored.ownerFeedbackHistory?.[0].note, "Tighten the test.");
  assert.equal(queue.canRedevelop(proposal.id).ok, false);

  // An older remote copy never overwrites the owner's newer local decision.
  queue.mergeRemote([{ ...stored, ownerDecision: undefined, updated: stored.updated - 10 }]);
  assert.equal(queue.get(proposal.id)!.ownerDecision?.decision, "accepted");
  queue.remove(proposal.id);
});

test("the standing self-test study never launches the project suite, and finishes inside a study step", { timeout: 60_000 }, async () => {
  const { default: StudyAgentRouter } = await import("../src/core/cognition/StudyAgentRouter");
  const { default: SourceAccess } = await import("../src/core/selfdev/SourceAccess");
  const access = SourceAccess.getInstance() as unknown as {
    status: (force?: boolean) => Promise<{ reachable: boolean; runtime: string }>;
    command: (operation: string) => Promise<unknown>;
  };
  const realStatus = access.status.bind(access);
  const realCommand = access.command.bind(access);
  const commands: string[] = [];
  access.status = async () => ({ reachable: true, runtime: "node-server" }) as never;
  access.command = async (operation: string) => { commands.push(operation); return { ok: true, stdout: "", stderr: "", durationMs: 0, origin: "development-runtime" }; };
  try {
    const started = Date.now();
    const result = await StudyAgentRouter.getInstance().investigate({
      id: "standing", question: "Do my own self-tests still pass?", detail: "", origin: "revalidation",
      domain: "testing", priority: 58, createdInCycle: 0, target: "self-tests@2026-11-17T00", status: "open", attempts: 0,
    } as never);
    assert.deepEqual(commands, [], "no project command (npm test) is run from background study");
    assert.ok(Date.now() - started < 30_000, "well inside the 60 s study-step deadline");
    assert.equal(result.ok, true);
    assert.match(result.evidence[0], /^Self-test suite: \d+\/\d+ passed/);
    assert.ok(result.evidence.some((line) => /full test suite is not run from background study/.test(line)));
  } finally {
    access.status = realStatus;
    access.command = realCommand;
  }
});
