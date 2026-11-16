/**
 * ==========================================================
 * LÉLU — REPO EXECUTIVE & EXECUTOR
 *
 * The strategic ranking, the honest failure path and the
 * registration boundary, locked. The full pipeline was run
 * against a live runtime in scripts/verify-repo-workforce.ts.
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
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

import RepoExecutive from "../src/core/acquisition/RepoExecutive";
import RepoExecutor from "../src/core/acquisition/RepoExecutor";
import CapabilityIntegrator from "../src/core/acquisition/CapabilityIntegrator";
import AcquisitionRuntime from "../src/core/acquisition/AcquisitionRuntime";
import AcquisitionStore from "../src/core/acquisition/AcquisitionStore";
import ApprovalGate from "../src/core/acquisition/ApprovalGate";
import TechnologyKnowledgeBase from "../src/core/acquisition/TechnologyKnowledgeBase";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import CapabilityManifest from "../src/core/capabilities/CapabilityManifest";
import CapabilityRegistry from "../src/core/selfdev/CapabilityRegistry";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import type { RepositoryCandidate, ResearchFindings } from "../src/core/acquisition/AcquisitionTypes";

const candidate: RepositoryCandidate = {
  id: "github:krisk/Fuse",
  source: "github",
  identifier: "krisk/Fuse",
  url: "https://github.com/krisk/Fuse",
  description: "Lightweight fuzzy-search",
  stars: 19000,
  forks: 800,
  language: "TypeScript",
  topics: ["fuzzy", "search"],
  license: "Apache-2.0",
  defaultBranch: "main",
  updatedAt: "2026-11-01T00:00:00Z",
  archived: false,
  openIssues: 12,
};

function findings(overrides: Partial<ResearchFindings> = {}): ResearchFindings {
  return {
    candidateId: candidate.id,
    identifier: candidate.identifier,
    summary: "Lightweight fuzzy-search",
    capabilities: ["fuzzy search", "search"],
    dependencies: [],
    buildSystem: "npm",
    entryPoints: ["src/index.ts"],
    license: { spdx: "Apache-2.0", name: "Apache License 2.0", risk: "permissive", obligations: ["keep the licence"] },
    maintenance: {
      lastCommit: "edf2fb6",
      lastCommitAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      commitsLast90Days: 4,
      archived: false,
      stars: 19000,
      openIssues: 12,
    },
    security: { observations: [], riskLevel: "low" },
    compatibility: { runtime: "browser", languages: ["TypeScript"], score: 0.9, reasons: ["ESM entry point"] },
    researchedAt: Date.now(),
    ...overrides,
  };
}

test("the executive ranks a compatible, permissively licensed, maintained project above a stale copyleft one", () => {
  const executive = RepoExecutive.getInstance();
  const good = executive.evaluate(candidate, findings(), "add typo tolerant search");
  const risky = executive.evaluate(
    { ...candidate, identifier: "old/Copyleft", stars: 120, archived: true },
    findings({
      license: { spdx: "AGPL-3.0", name: "AGPL", risk: "copyleft", obligations: ["source disclosure"] },
      maintenance: { lastCommit: "", lastCommitAt: "2018-01-01T00:00:00Z", commitsLast90Days: 0, archived: true, stars: 120, openIssues: 90 },
      security: { observations: ["archived"], riskLevel: "high" },
      compatibility: { runtime: "node", languages: ["JavaScript"], score: 0.4, reasons: ["Node only"] },
    }),
    "add typo tolerant search",
  );

  assert.ok(good.priority > risky.priority, `${good.priority} should exceed ${risky.priority}`);
  assert.ok(good.reasons.some((reason) => /overlap the objective/.test(reason)));
  assert.ok(risky.risks.some((risk) => /Copyleft/.test(risk)));
  assert.ok(risky.risks.some((risk) => /Archived/.test(risk)));
});

test("gap analysis reads the real capability registries", () => {
  const gaps = RepoExecutive.getInstance().capabilityGaps();
  assert.ok(gaps.length > 0);
  assert.ok(gaps.every((gap) => gap.capabilityId && gap.reason));
  assert.ok(gaps.some((gap) => gap.status === "partial" || gap.status === "planned" || gap.status === "not_configured"));
  assert.match(RepoExecutive.getInstance().architectureContext(), /subsystems/);
});

test("an assignment is persisted with the executor's galaxy and a measurable proposal", () => {
  AcquisitionStore.resetForTests();
  const executive = RepoExecutive.getInstance();
  const proposal = {
    candidate,
    findings: findings(),
    priority: 84,
    reasons: ["overlap"],
    risks: [],
    requestedCapability: "fuzzy search",
    recommendedIntegration: "vendor the module",
  };
  const assignment = executive.assign(proposal, "add typo tolerant search", "operator@test");
  assert.equal(assignment.executive, "engineering");
  assert.equal(assignment.status, "assigned");
  assert.equal(assignment.assignedBy, "operator@test");
  assert.equal(AcquisitionStore.getInstance().getAssignment(assignment.id)?.priority, undefined);
  assert.equal(AcquisitionStore.getInstance().activeAssignment()?.id, assignment.id);
});

test("the executor refuses to pretend when no acquisition runtime is running", async () => {
  AcquisitionRuntime.resetForTests();
  RepoExecutor.resetForTests();
  AcquisitionStore.resetForTests();
  const assignment = RepoExecutive.getInstance().assign(
    {
      candidate,
      findings: findings(),
      priority: 84,
      reasons: [],
      risks: [],
      requestedCapability: "fuzzy search",
      recommendedIntegration: "vendor",
    },
    "offline test",
    "operator@test",
  );

  const outcome = await RepoExecutor.getInstance().execute(assignment, { committer: "operator@test" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.evidence, null);
  assert.equal(outcome.acquisitionId, null);
  assert.match(outcome.failure ?? "", /runtime is not reachable/);
  assert.equal(AcquisitionStore.getInstance().getAssignment(assignment.id)?.status, "failed");
});

test("registration needs both a named approval and a passing test", () => {
  ApprovalGate.resetForTests();
  CapabilityIntegrator.resetForTests();
  AcquisitionStore.resetForTests();
  AutonomyGate.getInstance().setLevel(5);
  try {
    const integrator = CapabilityIntegrator.getInstance();
    const evidence = {
      acquisitionId: "acq-test",
      capability: "acquired.fuzzy-text-search",
      extracted: ["src/search/bitap/search.ts"],
      written: ["lelu/fuzzy-text-search/source/src/search/bitap/search.ts"],
      rationale: ["search.ts carries the Bitap scan"],
      branch: "lelu/acquisition/fuzzy-text-search",
      commit: "abc1234",
      license: "Apache-2.0",
    };
    const base = {
      capabilityId: "acquired.fuzzy-text-search",
      name: "Acquired — fuzzy search",
      description: "Bitap matching adapted from Fuse",
      source: { identifier: "krisk/Fuse", url: candidate.url, commit: "edf2fb6", acquiredAt: Date.now() },
      license: "Apache-2.0",
      evidence,
      tools: ["kb.search"],
      acquisitionId: "acq-test",
    };
    const passing = { command: "repository-acquisition tests", exitCode: 0, ok: true, durationMs: 900, outputTail: "pass 12", ranAt: Date.now() };
    const failing = { ...passing, exitCode: 1, ok: false, outputTail: "1 failing" };

    assert.equal(integrator.register({ ...base, tests: [] }).ok, false);
    assert.equal(integrator.register({ ...base, tests: [failing] }).ok, false, "a failing test cannot register a capability");

    const approval = integrator.authorize("operator@test", "register the fuzzy search capability");
    assert.equal(approval.allowed, true);
    const registered = integrator.register({ ...base, tests: [passing] });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;

    assert.equal(registered.capability.approvedBy, "operator@test");
    assert.equal(CapabilityManifest.getInstance().get("acquired.fuzzy-text-search")?.status, "available");
    assert.ok(CapabilityRegistry.getInstance().get("acquired.fuzzy-text-search"));
    assert.equal(ToolRegistry.getInstance().get("kb.search")?.available, true);
    assert.match(integrator.describe("acquired.fuzzy-text-search"), /exit 0/);
  } finally {
    AutonomyGate.getInstance().setLevel(2);
  }
});

test("tools are offered from the real registries: kb.search yes, repo.commit never without an approval", () => {
  const offered = toolSchemasForModel().map((schema) => schema.name);
  assert.ok(offered.includes("kb_search"), `kb.search should be offered, got ${offered.join(", ")}`);
  assert.ok(!offered.includes("repo_commit"), "repo.commit must not be offered without an operator approval");
  assert.ok(!offered.includes("repo_rollback"), "repo.rollback must not be offered without an operator approval");
});

test("the registered capability answers a real call through the tool dispatcher", async () => {
  const kb = TechnologyKnowledgeBase.getInstance();
  kb.addFromResearch(
    { id: candidate.id, identifier: candidate.identifier, url: candidate.url, description: candidate.description, topics: candidate.topics, stars: candidate.stars, license: candidate.license },
    findings(),
    "edf2fb608eca0461508d1d71317e6e58309ffada",
  );

  const result = await dispatchToolCall({ id: "test-kb", name: "kb.search", arguments: { query: "fzzy search" } }, undefined);
  assert.equal(result.ok, true);
  assert.match(result.content, /krisk\/Fuse/);
});
