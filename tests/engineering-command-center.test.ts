/**
 * ==========================================================
 * LÉLU — ENGINEERING COMMAND CENTER
 *
 * The Mission 8 surfaces, locked against their real effects:
 * marketplace activation gates tools, removal needs approval,
 * the council reviews in parallel, the creator plans runnable
 * files, and the acquired bounded cache actually evicts.
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

import AcquisitionStore from "../src/core/acquisition/AcquisitionStore";
import ApprovalGate from "../src/core/acquisition/ApprovalGate";
import CapabilityActivation from "../src/core/acquisition/CapabilityActivation";
import CapabilityMarketplace from "../src/core/acquisition/CapabilityMarketplace";
import EngineeringCouncil from "../src/core/acquisition/EngineeringCouncil";
import EngineeringCommandCenter from "../src/core/acquisition/EngineeringCommandCenter";
import CreatorStudio from "../src/core/acquisition/CreatorStudio";
import DurableAcquisitions from "../src/core/acquisition/DurableAcquisitions";
import { selftestBoundedCache } from "../src/core/acquisition/capabilities/BoundedCache";
import CapabilityManifest from "../src/core/capabilities/CapabilityManifest";
import CapabilityRegistry from "../src/core/selfdev/CapabilityRegistry";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { toolPermitted } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import type { CapabilityRecord, ResearchFindings } from "../src/core/acquisition/AcquisitionTypes";

const CAPABILITY_ID = "acquired.fuzzy-search";

const record: CapabilityRecord = {
  id: CAPABILITY_ID,
  name: "Acquired — fuzzy search",
  description: "Bitap fuzzy matcher adapted from krisk/Fuse for typo-tolerant technology search.",
  source: {
    identifier: "krisk/Fuse",
    url: "https://github.com/krisk/Fuse",
    commit: "edf2fb608eca0461508d1d71317e6e58309ffada",
    acquiredAt: Date.now(),
  },
  license: {
    spdx: "Apache-2.0",
    obligations: ["Keep the copyright notice and license text with the adapted source.", "State what was changed."],
    attributionPath: "lelu/fuzzy-search/ATTRIBUTION.md",
  },
  adaptedFrom: ["src/search/bitap/index.ts"],
  registeredTools: ["kb.search"],
  tests: [
    { command: "npx tsx --test tests/repository-acquisition.test.ts", exitCode: 0, ok: true, durationMs: 900, outputTail: "", ranAt: Date.now() },
  ],
  approvedBy: "tester",
  approvalBasis: "test",
  registeredAt: Date.now(),
  acquisitionId: "acq-test",
};

const findings: ResearchFindings = {
  candidateId: "github:krisk/Fuse",
  identifier: "krisk/Fuse",
  provenance: "acquired-repository",
  summary: "Lightweight fuzzy-search library with a Bitap matcher.",
  capabilities: ["fuzzy search", "search", "parser"],
  dependencies: [],
  buildSystem: "npm",
  entryPoints: ["dist/fuse.js"],
  license: { spdx: "Apache-2.0", name: "Apache 2.0", risk: "permissive", obligations: ["Keep the notice."] },
  maintenance: { lastCommit: "abc", lastCommitAt: "2026-01-01T00:00:00Z", commitsLast90Days: 3, archived: false, stars: 19000, openIssues: 12 },
  security: { observations: ["No install scripts declared."], riskLevel: "low" },
  compatibility: { runtime: "isomorphic", languages: ["TypeScript"], score: 0.85, reasons: ["ESM/browser entry point"] },
  researchedAt: Date.now(),
};

AutonomyGate.getInstance().setLevel(5);
CapabilityActivation.getInstance().reset();
AcquisitionStore.getInstance().saveCapability(record);
CapabilityManifest.getInstance().register({
  id: CAPABILITY_ID,
  name: record.name,
  category: "knowledge",
  description: record.description,
  status: "available",
  providers: ["acquired:krisk/Fuse"],
  lastSuccessful: null,
  lastChecked: Date.now(),
});
CapabilityRegistry.getInstance().add({
  id: CAPABILITY_ID,
  name: record.name,
  description: record.description,
  status: "available",
  requiredTools: ["kb.search"],
  requiredProviders: [],
  requiredAgents: [],
  requiredKnowledge: [],
  dependencies: ["repository-acquisition"],
  tests: [],
  limitations: [],
  version: "1.0",
});
ToolRegistry.getInstance().updateAvailability("kb.search", true);
ToolRegistry.getInstance().updateAvailability("repo.pipeline", true);

test("repo.pipeline is offered only with a canonical-write grant", () => {
  assert.equal(toolPermitted("repo.pipeline"), false, "no grant means the pipeline must not be offered");
  const decision = ApprovalGate.getInstance().authorize("canonical-write", "test-acq", "tester", "test the offer gate");
  assert.equal(decision.allowed, true);
  assert.equal(toolPermitted("repo.pipeline"), true, "a grant opens the offer");
  ApprovalGate.getInstance().consume("canonical-write", "test-acq");
  assert.equal(toolPermitted("repo.pipeline"), false);
});

test("deactivating an acquired capability removes its tool from the offered set", () => {
  const marketplace = CapabilityMarketplace.getInstance();
  const activated = marketplace.activate(CAPABILITY_ID);
  assert.equal(activated.ok, true);
  assert.equal(toolPermitted("kb.search"), true);
  assert.equal(toolSchemasForModel().some((schema) => schema.name === "kb_search"), true);

  const deactivated = marketplace.deactivate(CAPABILITY_ID);
  assert.equal(deactivated.ok, true);
  assert.equal(toolPermitted("kb.search"), false, "deactivation must reach the real tool gate");
  assert.equal(
    toolSchemasForModel().some((schema) => schema.name === "kb_search"),
    false,
    "a deactivated tool must not be offered to a model",
  );
  assert.equal(
    CapabilityManifest.getInstance().get(CAPABILITY_ID)?.status,
    "unavailable",
  );

  assert.equal(marketplace.activate(CAPABILITY_ID).ok, true);
  assert.equal(toolPermitted("kb.search"), true);
});

test("removal requires a named operator and clears the registries", async () => {
  const marketplace = CapabilityMarketplace.getInstance();
  const refused = await marketplace.remove(CAPABILITY_ID, "");
  assert.equal(refused.ok, false, "an unnamed removal is refused");

  const removed = await marketplace.remove(CAPABILITY_ID, "tester");
  assert.equal(removed.ok, true);
  assert.equal(CapabilityRegistry.getInstance().get(CAPABILITY_ID), undefined);
  assert.equal(CapabilityActivation.getInstance().isRemoved(CAPABILITY_ID), true);
  assert.equal(toolPermitted("kb.search"), false);

  const restored = marketplace.restore(CAPABILITY_ID);
  assert.equal(restored.ok, true);
  assert.ok(CapabilityRegistry.getInstance().get(CAPABILITY_ID));
  assert.equal(toolPermitted("kb.search"), true);
});

test("the council reviews with every specialist in parallel", async () => {
  const council = await EngineeringCouncil.getInstance().review(findings, {
    structure: [{ path: "package.json" }, { path: "src/index.ts" }],
    manifest: '{"scripts":{"test":"node --test"},"license":"Apache-2.0"}',
    readme: "# Fuse\nFuzzy search.",
  });
  assert.equal(council.parallel, true);
  assert.equal(council.reports.length, 7);
  assert.equal(council.verdict, "ready");
  for (const report of council.reports) {
    assert.ok(report.findings.length > 0, `${report.id} must return real findings`);
    assert.equal(report.source, "evidence");
  }
  assert.ok(council.durationMs >= 0);
});

test("the creator plans runnable files for every project kind", () => {
  const studio = CreatorStudio.getInstance();
  for (const kind of ["website", "dashboard", "api", "tool", "agent", "game"] as const) {
    const plan = studio.plan(`A ${kind} for the acquisition pipeline`, kind);
    assert.ok(plan.files.length >= 2, `${kind} needs real files`);
    assert.ok(plan.files.some((file) => file.path.endsWith("README.md")));
    assert.ok(plan.files.every((file) => file.content.trim().length > 0));
    assert.ok(plan.files.every((file) => file.path.startsWith(`lelu-creator/${plan.slug}/`)));
  }
  const website = studio.plan("Landing page", "website");
  assert.ok(website.files.some((file) => file.path.endsWith("index.html")));
  assert.ok(website.files.some((file) => file.path.endsWith("app.js")));
});

test("the acquired bounded cache evicts LRU entries and expires stale ones", () => {
  const result = selftestBoundedCache();
  assert.equal(result.ok, true, result.steps.join("\n"));
  assert.equal(result.stats.evictions, 1);
});

test("the command center reports real executive state and refuses unnamed cleanup", async () => {
  const snapshot = EngineeringCommandCenter.getInstance().snapshot();
  assert.ok(Array.isArray(snapshot.assignments));
  assert.ok(Array.isArray(snapshot.gaps));
  assert.ok(Array.isArray(snapshot.runs));
  assert.ok(snapshot.approvals.length >= 1, "the approval audit log is real");

  const refused = await DurableAcquisitions.getInstance().cleanup("");
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? "", /named operator/i);

  const entries = CapabilityMarketplace.getInstance().inventory("fuzzy");
  assert.equal(entries.some((entry) => entry.id === CAPABILITY_ID), true);
  assert.equal(entries[0]?.source.identifier, "krisk/Fuse");
});
