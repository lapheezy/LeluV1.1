/**
 * ==========================================================
 * LÉLU — SELF-AWARENESS, LIFECYCLE AND JOURNAL
 *
 * CATEGORY: unit (no model, no network, no browser).
 *
 * Pins the behaviour the mission asks for:
 *
 *  · a capability is operational only with implementation AND a named
 *    check — never because it was committed or labelled;
 *  · a resolved limitation retires its recommendation, stays readable as
 *    history, and disappears from the active list;
 *  · duplicates collapse; completed work is not outstanding; a regression
 *    reopens it;
 *  · the self-model stops reporting limitations that no longer exist;
 *  · the journal is the memory the comparison runs against.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

import CapabilityRegistry from "../src/core/selfdev/CapabilityRegistry";
import ImprovementQueue, { type ImprovementProposal } from "../src/core/selfdev/ImprovementQueue";
import SelfAwareness from "../src/core/selfdev/SelfAwareness";
import DevelopmentJournal from "../src/core/selfdev/DevelopmentJournal";
import SelfImprovementCycle, { STAGE_ORDER } from "../src/core/selfdev/ImprovementCycle";
import { decideLifecycle } from "../src/core/selfdev/ImprovementLifecycle";
import {
  CAPABILITY_EVIDENCE,
  RESOLVED_LIMITATIONS,
  isVerified,
} from "../src/core/selfdev/CapabilityEvidence";
import SelfModel from "../src/core/cognition/SelfModel";

function draft(title: string, overrides: Partial<ImprovementProposal> = {}) {
  return {
    title,
    problem: "Observed during a self-awareness check.",
    observation: "Self-awareness test.",
    evidence: "diagnostic finding: test",
    proposedSolution: "Fix it in the sandbox and verify.",
    expectedBenefit: "One less limitation.",
    dependencies: [],
    risk: "None.",
    requiredTools: [],
    requiredAgents: [],
    complexity: "low" as const,
    kind: "Optimization" as const,
    version: "1.0",
    testPlan: "Run the verification.",
    ...overrides,
  };
}

/* ------------------------- evidence, not claims ------------------------- */

test("every capability claim names implementation and verification that exist", () => {
  assert.ok(CAPABILITY_EVIDENCE.length >= 15, "the evidence table covers the registry");
  for (const entry of CAPABILITY_EVIDENCE) {
    assert.ok(entry.sources.length > 0, `${entry.id}: no implementation evidence`);
    assert.ok(entry.tests.length + entry.selfTests.length > 0, `${entry.id}: no verification evidence`);
    for (const file of [...entry.sources, ...entry.tests]) {
      assert.ok(existsSync(file), `${entry.id}: ${file} does not exist`);
    }
    assert.ok(isVerified(entry.id), `${entry.id} should count as verified`);
  }
  for (const resolved of RESOLVED_LIMITATIONS) {
    assert.ok(resolved.resolvedBy.length > 0);
    for (const file of [...resolved.sources, ...resolved.tests]) {
      assert.ok(existsSync(file), `resolved limitation evidence missing: ${file}`);
    }
  }
});

test("a capability with no evidence cannot be called operational", () => {
  const snapshot = SelfAwareness.getInstance().assess();
  for (const capability of snapshot.operational) {
    assert.ok(capability.implemented, `${capability.id} is operational without an implementation`);
    assert.ok(capability.tested, `${capability.id} is operational without a check`);
  }
  assert.ok(snapshot.unverified.length + snapshot.partial.length > 0, "not everything is claimed as operational");
});

/* ------------------------- reconciliation ------------------------------ */

test("a resolved limitation retires its recommendation and keeps its record", () => {
  const queue = ImprovementQueue.getInstance();
  const id = "improve-reusable-workflows";
  const seeded = queue.get(id);
  assert.ok(seeded, "the seeded recommendation exists");
  assert.equal(seeded!.title, "Add reusable agent workflows");
  assert.ok(queue.open().some((proposal) => proposal.id === id), "it starts as outstanding work");

  const summary = SelfAwareness.getInstance().reconcile();
  const retired = queue.get(id)!;
  assert.equal(retired.lifecycle, "Superseded");
  assert.match(retired.lifecycleReason ?? "", /available and its implementation is verified/i);
  assert.ok(!queue.open().some((proposal) => proposal.id === id), "it is no longer outstanding");
  assert.ok(queue.get(id), "the historical record still exists");
  assert.ok((retired.history ?? []).length >= 1, "the transition is recorded");
  assert.ok(summary.retired.includes(id));

  const snapshot = SelfAwareness.getInstance().assess();
  assert.ok(snapshot.outdatedRecommendations.some((proposal) => proposal.id === id));
  assert.match(snapshot.answers.resolved, /reusable/i);
  assert.ok(!snapshot.answers.capabilities.includes("Add reusable agent workflows"));
});

test("reconciliation is idempotent: a second pass changes nothing", () => {
  SelfAwareness.getInstance().reconcile();
  const summary = SelfAwareness.getInstance().reconcile();
  assert.deepEqual(summary.retired, []);
  assert.deepEqual(summary.duplicates, []);
  assert.deepEqual(summary.modelChanges, []);
  assert.equal(summary.changed, false);
});

test("duplicate recommendations collapse, the oldest keeps the work", () => {
  const queue = ImprovementQueue.getInstance();
  const first = queue.add(draft("Reduce navigation overlap on phones"));
  const second = queue.add(draft("Reduce navigation overlap on phones"));
  const activeBefore = queue.open().length;

  SelfAwareness.getInstance().reconcile();
  const activeAfter = queue.open().length;
  assert.equal(activeAfter, activeBefore - 1, "two identical recommendations became one");

  const one = queue.get(first.id)!;
  const two = queue.get(second.id)!;
  const retired = one.lifecycle === "Superseded" ? one : two;
  const kept = one.lifecycle === "Superseded" ? two : one;
  assert.equal(retired.lifecycle, "Superseded");
  assert.equal(retired.supersededBy, kept.id);
  assert.match(retired.lifecycleReason ?? "", /duplicates/i);
  assert.ok(queue.get(retired.id), "the duplicate is kept as history");
});

test("a verified improvement is not outstanding; a regression reopens it", () => {
  const registry = CapabilityRegistry.getInstance();
  const browser = registry.get("browser")!;
  const originalStatus = browser.status;
  const queue = ImprovementQueue.getInstance();

  const proposal = queue.add(
    draft("Browser embedding fallback", {
      capabilityId: "browser",
      status: "Integrated",
      lastExecution: {
        executionId: "self-awareness-check",
        kind: "apply",
        started: Date.now() - 1000,
        finished: Date.now(),
        filesInspected: ["src/app/scene/genesis/GenesisBrowserPanel.tsx"],
        filesChanged: ["src/app/scene/genesis/GenesisBrowserPanel.tsx"],
        checks: [{ name: "sandbox tests", ok: true, detail: "1/1 passed" }],
      },
    }),
  );

  SelfAwareness.getInstance().reconcile();
  const verified = queue.get(proposal.id)!;
  assert.equal(verified.lifecycle, "VerifiedComplete");
  assert.ok(verified.verifiedAt);
  assert.ok(!queue.open().some((item) => item.id === proposal.id), "completed work is not outstanding");

  try {
    registry.update("browser", { status: "broken" });
    const summary = SelfAwareness.getInstance().reconcile();
    const reopened = queue.get(proposal.id)!;
    assert.equal(reopened.lifecycle, "Reopened");
    assert.ok(summary.reopened.includes(proposal.id));
    assert.match(reopened.lifecycleReason ?? "", /Reopened/i);
    assert.ok(queue.open().some((item) => item.id === proposal.id), "a real regression returns to the queue");
  } finally {
    registry.update("browser", { status: originalStatus });
    SelfAwareness.getInstance().reconcile();
  }
});

/* --------------------------- the self-model ---------------------------- */

test("the self-model no longer reports limitations the system resolved", () => {
  SelfAwareness.getInstance().reconcile();
  const self = SelfModel.getInstance().get();
  assert.ok(!self.limitations.includes("sandbox execution is confined to files, not a runtime"));
  assert.ok(!self.unavailable.includes("real-time embodied avatar"));
  assert.ok(self.limitations.length > 0, "limitations that are still true are kept");
  assert.ok(
    self.improvements.every((line) => !/^Improvement: Add reusable agent workflows$/.test(line)),
    "a retired recommendation is not presented as current work",
  );
  assert.ok(
    self.capabilities.some((name) => /workflow/i.test(name)),
    "a verified capability appears in the self-model",
  );
});

/* ------------------------------ the journal ---------------------------- */

test("the journal is development memory: missions, commits and evidence", () => {
  const journal = DevelopmentJournal.getInstance();
  const entries = journal.entries();
  assert.ok(entries.length > 0);
  for (let index = 1; index < entries.length; index += 1) {
    assert.ok(entries[index - 1].at >= entries[index].at, "newest first");
  }
  const mission = entries.find((entry) => entry.missionId === "mission-41");
  assert.ok(mission, "this mission is in the journal");
  assert.ok((mission!.evidence ?? []).length >= 2, "the mission carries its evidence");
  assert.ok(journal.forCapability("cosmos-navigation").length >= 2, "the journal answers per capability");
  assert.equal(journal.latest(2).length, 2);
});

/* ------------------------ the eight questions -------------------------- */

test("her answers agree with the registry, the journal and the queue", () => {
  const queue = ImprovementQueue.getInstance();
  const snapshot = SelfAwareness.getInstance().assess();

  assert.ok(snapshot.answers.capabilities.includes(String(snapshot.counts.operational)));
  for (const capability of snapshot.operational) {
    assert.ok(snapshot.answers.capabilities.includes(capability.name), `${capability.name} is named as operational`);
  }
  assert.ok(snapshot.answers.recent.length > 0);
  assert.match(snapshot.answers.resolved, /reusable/i);
  assert.ok(snapshot.answers.incomplete.length > 0);
  assert.ok(snapshot.answers.outdated.length > 0);
  assert.ok(snapshot.answers.next.length > 0);
  assert.match(snapshot.answers.evidence, /evidence/i);

  if (snapshot.nextImprovement) {
    assert.ok(
      queue.open().some((proposal) => proposal.id === snapshot.nextImprovement!.id),
      "the next improvement is real outstanding work",
    );
  }
  for (const proposal of snapshot.outdatedRecommendations) {
    assert.ok(["VerifiedComplete", "Superseded"].includes(proposal.lifecycle ?? ""), "outdated means retired");
  }

  // The routed questions must land on the same answers.
  const awareness = SelfAwareness.getInstance();
  assert.equal(awareness.answer("which recommendations are outdated?"), snapshot.answers.outdated);
  assert.equal(awareness.answer("what should I improve next?"), snapshot.answers.next);
  assert.equal(awareness.answer("which limitations have been resolved?"), snapshot.answers.resolved);
});

test("a stale proposal cannot be resurrected by re-deriving its status", () => {
  const queue = ImprovementQueue.getInstance();
  const retired = queue.get("improve-reusable-workflows")!;
  assert.equal(decideLifecycle(retired).lifecycle, "Superseded");
  assert.equal(decideLifecycle(retired).changed, false);
});

/* -------------------------- the whole cycle ---------------------------- */

test("the improvement cycle runs identify → reassess and executes nothing when unasked", async () => {
  const result = await SelfImprovementCycle.getInstance().run();
  assert.deepEqual(result.stages.map((stage) => stage.stage), STAGE_ORDER);
  assert.deepEqual(result.executed, [], "no development starts without an explicit request");
  assert.ok(result.verification.length > 0, "every proposal was checked against its own evidence");
  assert.ok(result.next === null || result.next.id.length > 0);
  assert.equal(SelfImprovementCycle.getInstance().getLastResult(), result);
});
