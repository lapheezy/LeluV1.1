/**
 * ==========================================================
 * LÉLU — WHAT WAS REQUIRED, AND WHAT WAS SEEN
 *
 * CATEGORY: unit. Pure state in, words out.
 *
 * Phase 8 taught the runtime to give an objective a contract
 * before the work started and to check a completion claim
 * against it. Both facts lived only in the cycle records and
 * the log. These pin the projection that puts them in front of
 * a person through the existing briefing:
 *
 *   what had to be true
 *   where that requirement came from
 *   what the record really shows
 *   what it does not
 *   and whether a claim was sent back before the work ended
 *
 * The last one matters because "stopped after one action" is a
 * different thing to read when the runtime had already turned
 * the model back twice than when it never checked.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { AgentObjective, CognitionCycleRecord, ObjectiveOutcome } from "../src/core/cognition/AgentObjectives";
import {
  describeEvidence,
  objectiveEvidence,
} from "../src/core/cognition/ObjectiveEvidence";

const KNOWN_TOOLS = ["workflow_list", "workflow_author", "workflow_run", "memory_store", "project.manage"];

function objectiveWith(
  text: string,
  expectedOutcomes?: ObjectiveOutcome[],
  patch: Partial<AgentObjective> = {},
): AgentObjective {
  const now = 1_700_000_000_000;
  return {
    id: "objective-1",
    agentId: "agent-1",
    objective: text,
    state: "active",
    source: "cognition",
    basePriority: 50,
    priority: 50,
    createdAt: now,
    updatedAt: now,
    cyclesRun: 0,
    maxCycles: 8,
    actionsTaken: 0,
    maxActions: 12,
    deadline: now + 600_000,
    consecutiveFailures: 0,
    actionHistory: [],
    ...(expectedOutcomes ? { expectedOutcomes } : {}),
    ...patch,
  };
}

let cycleSeq = 0;

function cycle(
  executed: Array<{ tool: string; ok: boolean }>,
  patch: Partial<CognitionCycleRecord> = {},
): CognitionCycleRecord {
  cycleSeq += 1;
  return {
    cycleId: `cycle-${cycleSeq}`,
    agentId: "agent-1",
    objectiveId: "objective-1",
    trigger: "runtime:objective-created",
    startedAt: 1_700_000_000_000 + cycleSeq * 1_000,
    finishedAt: 1_700_000_000_000 + cycleSeq * 1_000 + 500,
    decision: "worked",
    executed,
    nextState: "active",
    ...patch,
  };
}

/* ================================================================== *
 * WHERE THE REQUIREMENTS CAME FROM
 * ================================================================== */

test("a declared contract is reported as declared, item by item", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Get the workflow done.", [
      { evidence: "tool-succeeded", tool: "workflow_list", what: "workflow_list ran successfully" },
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [cycle([{ tool: "workflow_list", ok: true }])],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(report.contractSource, "declared");
  assert.deepEqual(
    report.contract.map((item) => item.tool),
    ["workflow_list", "workflow_run"],
  );
  assert.deepEqual(report.observed, ["workflow_list ran successfully"]);
  assert.deepEqual(report.missing, ["workflow_run ran successfully"]);

  const text = describeEvidence(report);
  assert.match(text, /declared by whoever set the objective/);
  assert.match(text, /Observed: workflow_list ran successfully/);
  assert.match(text, /Not observed: workflow_run ran successfully/);
});

test("a requirement the objective states in its own words is reported as stated", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Create it with workflow_author, then check with workflow_list."),
    cycles: [],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(report.contractSource, "stated");
  assert.deepEqual(report.contract.map((item) => item.tool), ["workflow_author", "workflow_list"]);
  assert.equal(report.missing.length, 2);
  assert.match(describeEvidence(report), /read from the objective's own wording/);
});

test("a requirement the objective rules out is not turned into one", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Do not use memory_store; answer from what you already know."),
    cycles: [],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(
    report.contractSource,
    "none",
    "a prohibition was read as a requirement, which is the inversion the contract exists to prevent",
  );
  assert.deepEqual(report.contract, []);
  assert.deepEqual(report.missing, []);
  assert.match(describeEvidence(report), /No outcome contract/);
});

/* ================================================================== *
 * WHAT THE RECORD PROVES
 * ================================================================== */

test("the cycle that ends the work counts, even though it is not recorded yet", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Run it.", [
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [],
    // brief() sees the concluding cycle's own executions, which the store
    // does not hold until after the briefing is written.
    executedNow: [{ tool: "workflow_run", ok: true }],
    completed: true,
  });

  assert.deepEqual(report.observed, ["workflow_run ran successfully"]);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.executed, ["workflow_run"]);
});

test("a tool that ran and failed is named as an unmet requirement", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Run it.", [
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [cycle([{ tool: "workflow_run", ok: false }])],
    knownTools: KNOWN_TOOLS,
  });

  assert.deepEqual(report.missing, ["workflow_run ran successfully (it ran and failed)"]);
  assert.equal(report.contract[0].failedAttempt, true);
  assert.equal(report.contract[0].satisfied, false);
});

test("an answered objective with no contract reports the answer as its evidence", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Decide whether anything needs doing."),
    cycles: [cycle([], { nextState: "completed" })],
    knownTools: KNOWN_TOOLS,
    completed: true,
  });

  assert.equal(report.contractSource, "none");
  assert.deepEqual(report.contract, []);
  assert.deepEqual(report.observed, ["a reasoned answer was given"]);
  assert.deepEqual(report.missing, []);
  assert.match(describeEvidence(report), /Observed: a reasoned answer was given/);
});

test("finished work does not print a shortfall beside its headline", () => {
  // The same report, read for a completed objective: whatever the record
  // lacks must not appear next to "Finished".
  const report = objectiveEvidence({
    objective: objectiveWith("Run it.", [
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [],
    knownTools: KNOWN_TOOLS,
    completed: true,
  });

  assert.equal(report.missing.length, 1);
  assert.ok(!/Not observed/.test(describeEvidence(report, { missing: false })));
  assert.match(describeEvidence(report, { missing: true }), /Not observed/);
});

/* ================================================================== *
 * A CLAIM SENT BACK, AND WHAT FOLLOWED IT
 * ================================================================== */

test("rejected completions and the continuation they caused are visible", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("List it, author it, then run it.", [
      { evidence: "tool-succeeded", tool: "workflow_list", what: "workflow_list ran successfully" },
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [
      cycle([{ tool: "workflow_list", ok: true }], {
        decision: "DONE: it already exists.",
        verification: {
          verdict: "incomplete",
          reason: "1 of 2 required outcomes has not been observed: workflow_run ran successfully.",
          observed: ["workflow_list ran successfully"],
          missing: ["workflow_run ran successfully"],
        },
      }),
      cycle([{ tool: "workflow_run", ok: true }], {
        decision: "Ran it.",
        nextState: "completed",
      }),
    ],
    knownTools: KNOWN_TOOLS,
    completed: true,
  });

  assert.equal(report.rejections, 1);
  assert.equal(
    report.continuationsAfterRejection,
    1,
    "the runtime did not continue after rejecting the claim, so the rejection bought nothing",
  );
  assert.deepEqual(report.observed, [
    "workflow_list ran successfully",
    "workflow_run ran successfully",
  ]);
  assert.deepEqual(report.missing, []);
  assert.equal(report.verdicts.length, 1);

  const text = describeEvidence(report);
  assert.match(text, /rejected 1 premature completion claim/);
  assert.match(text, /continued the work for 1 more cycle/);
});

test("a rejection with no continuation says so rather than implying one", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Run it.", [
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ]),
    cycles: [
      cycle([], {
        decision: "DONE: done.",
        verification: {
          verdict: "incomplete",
          reason: "1 of 1 required outcome has not been observed: workflow_run ran successfully.",
          observed: [],
          missing: ["workflow_run ran successfully"],
        },
        nextState: "yielded",
      }),
    ],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(report.rejections, 1);
  assert.equal(report.continuationsAfterRejection, 0);
  assert.match(describeEvidence(report), /no further cycle ran/);
});

test("blocked is not counted as a rejected completion", () => {
  const report = objectiveEvidence({
    objective: objectiveWith("Ask which budget applies."),
    cycles: [
      cycle([], {
        verification: {
          verdict: "blocked",
          reason: "Cannot be finished without the user: which budget applies.",
          observed: [],
          missing: ["which budget applies"],
        },
      }),
    ],
    knownTools: KNOWN_TOOLS,
  });

  assert.equal(
    report.rejections,
    0,
    "waiting on the user was reported as the model claiming a completion it had not earned",
  );
  assert.equal(report.verdicts[0].verdict, "blocked");
});
