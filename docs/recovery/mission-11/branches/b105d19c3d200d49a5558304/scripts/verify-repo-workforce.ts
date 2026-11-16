/**
 * ==========================================================
 * LÉLU — LIVE REPOSITORY WORKFORCE VERIFICATION
 *
 * One real end-to-end acquisition, against a running runtime:
 *
 *   DISCOVER → RESEARCH → ACQUIRE → INSPECT → ADAPT → CONNECT
 *   → TEST → APPROVE → INTEGRATE → REGISTER → USE
 *
 * Usage:
 *   npm run dev            # or npm run serve, in another shell
 *   npx tsx scripts/verify-repo-workforce.ts [repository]
 *
 * The integration test command is executed here and its real exit
 * status is what authorises the TEST stage. Nothing is simulated:
 * a failing stage stops the run and the script exits non-zero.
 * ==========================================================
 */

import { spawnSync } from "node:child_process";

const RUNTIME_URL = process.env.LELU_RUNTIME_URL ?? "http://127.0.0.1:5173";
process.env.VITE_LELU_ENGINEER_URL = RUNTIME_URL;
process.env.__LELU_ENGINEER_URL__ = RUNTIME_URL;

// The browser singletons read localStorage; give the Node verifier the
// same durable surface the app has, backed by memory for this run.
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

const OPERATOR = "operator:mission-7-verification";
const REPOSITORY = process.argv[2] ?? "krisk/Fuse";
const KEYWORDS = "fuzzy search";
const OBJECTIVE =
  "Give LÉLU typo-tolerant search over her technology knowledge base so a mis-typed capability query still finds the right technology.";

async function main(): Promise<void> {
  const { default: AutonomyGate } = await import("../src/core/cognition/AutonomyGate");
  const { default: AcquisitionRuntime } = await import("../src/core/acquisition/AcquisitionRuntime");
  const { default: CapabilityPipeline } = await import("../src/core/acquisition/CapabilityPipeline");
  const { default: AcquisitionStore } = await import("../src/core/acquisition/AcquisitionStore");
  const { default: ApprovalGate } = await import("../src/core/acquisition/ApprovalGate");
  const { default: TechnologyKnowledgeBase } = await import("../src/core/acquisition/TechnologyKnowledgeBase");
  const { default: CapabilityManifest } = await import("../src/core/capabilities/CapabilityManifest");
  const { default: CapabilityRegistry } = await import("../src/core/selfdev/CapabilityRegistry");
  const { toolSchemasForModel } = await import("../src/core/tools/ToolSchemas");
  // Evaluated after the pipeline's availability probe, not before it:
  // repo.* are declared unavailable until a runtime probe succeeds.
  const repoSearchOffered = (): boolean =>
    toolSchemasForModel().some((schema) => schema.name === "repo_search");

  AutonomyGate.getInstance().setLevel(5);
  const runtime = AcquisitionRuntime.getInstance();
  const status = await runtime.status();
  if (!status.ok) {
    console.error(`[FAIL] No acquisition runtime at ${RUNTIME_URL}: ${status.error}`);
    process.exit(1);
  }
  console.log(`[runtime] ${status.runtime} at ${RUNTIME_URL}; ${status.acquisitions} acquisition(s); limits ${JSON.stringify(status.limits)}`);

  /* ------------------------------------------------------------------ */
  /* TEST: LÉLU's own integration suite, executed for real               */
  /* ------------------------------------------------------------------ */

  const started = Date.now();
  const test = spawnSync(
    "npx",
    ["tsx", "--test", "--test-concurrency=1", "tests/repository-acquisition.test.ts"],
    { encoding: "utf8", timeout: 240_000 },
  );
  const testOutput = `${test.stdout ?? ""}\n${test.stderr ?? ""}`.trim();
  const testEvidence = {
    command: "npx tsx --test tests/repository-acquisition.test.ts (acquired capability + acquisition boundaries)",
    exitCode: test.status ?? 1,
    ok: test.status === 0,
    durationMs: Date.now() - started,
    outputTail: testOutput.slice(-4000),
    ranAt: Date.now(),
  };
  console.log(`[test] exit ${testEvidence.exitCode} in ${Math.round(testEvidence.durationMs / 1000)}s`);
  if (!testEvidence.ok) {
    console.error(testEvidence.outputTail);
    console.error("[FAIL] The integration suite did not pass; nothing will be registered.");
    process.exit(1);
  }

  /* ------------------------------------------------------------------ */
  /* Start from a fresh acquisition so the adaptation is re-measured     */
  /* ------------------------------------------------------------------ */

  const existing = await runtime.list();
  if (existing.ok) {
    const match = existing.acquisitions.find(
      (record) => record.source.identifier.toLowerCase() === REPOSITORY.toLowerCase(),
    );
    if (match) {
      const local = ApprovalGate.getInstance().authorize(
        "destructive",
        match.id,
        OPERATOR,
        "Re-run the verification from a pristine acquisition",
      );
      if (!local.allowed) {
        console.error(`[FAIL] Could not authorise the reset: ${local.reason}`);
        process.exit(1);
      }
      const approval = await runtime.approve({ scope: "destructive", targetId: match.id });
      if (!approval.ok) {
        console.error(`[FAIL] Runtime refused the reset approval: ${approval.error}`);
        process.exit(1);
      }
      const removed = await runtime.remove(match.id, approval.nonce);
      ApprovalGate.getInstance().consume("destructive", match.id);
      if (!removed.ok) {
        console.error(`[FAIL] Could not remove the previous acquisition: ${removed.error}`);
        process.exit(1);
      }
      console.log(`[reset] removed previous acquisition ${match.id}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* THE PIPELINE                                                       */
  /* ------------------------------------------------------------------ */

  const pipeline = CapabilityPipeline.getInstance();
  const result = await pipeline.run({
    objective: OBJECTIVE,
    keywords: KEYWORDS,
    repository: REPOSITORY,
    limit: 5,
    minStars: 500,
    requestedBy: OPERATOR,
    approver: OPERATOR,
    integrationTests: [testEvidence],
    runRepositoryTests: false,
    use: { tool: "kb.search", args: { query: "fuzzy serach", limit: 3 } },
  });

  const run = AcquisitionStore.getInstance().getRun(result.run.id) ?? result.run;
  console.log("\n[stages]");
  for (const event of run.events) {
    console.log(`  ${event.ok ? "✓" : "✗"} ${event.stage.padEnd(10)} ${event.detail}`);
  }

  if (!result.proposal) {
    console.error(`\n[FAIL] The pipeline stopped: ${run.failure ?? "no proposal"}`);
    process.exit(1);
  }

  console.log("\n[selection]");
  console.log(`  repository : ${result.proposal.candidate.identifier} (${result.proposal.candidate.stars} stars)`);
  console.log(`  priority   : ${result.proposal.priority}/100`);
  console.log(`  licence    : ${result.proposal.findings.license.spdx} (${result.proposal.findings.license.risk})`);
  console.log(`  provenance : ${result.proposal.findings.provenance ?? "github-api"}`);
  console.log(`  why        : ${result.proposal.reasons.join(" ")}`);

  if (!result.capability) {
    console.error(`\n[FAIL] No capability was registered. Run failure: ${run.failure ?? "unknown"}`);
    process.exit(1);
  }

  console.log("\n[capability]");
  console.log(`  id         : ${result.capability.id}`);
  console.log(`  source     : ${result.capability.source.identifier}@${result.capability.source.commit.slice(0, 10)}`);
  console.log(`  licence    : ${result.capability.license.spdx} — ${result.capability.license.obligations.join(" ")}`);
  console.log(`  adapted    : ${result.capability.adaptedFrom.join(", ")}`);
  console.log(`  tools      : ${result.capability.registeredTools.join(", ")}`);
  console.log(`  approved   : ${result.capability.approvedBy} (${result.capability.approvalBasis})`);
  console.log(`  tests      : ${result.capability.tests.map((entry) => `${entry.command} exit ${entry.exitCode}`).join("; ")}`);

  console.log("\n[use]");
  console.log(`  ${result.useResult ?? "the use stage produced no result"}`);

  const manifestCapability = CapabilityManifest.getInstance().get(result.capability.id);
  const registryCapability = CapabilityRegistry.getInstance().get(result.capability.id);
  const knowledge = TechnologyKnowledgeBase.getInstance();

  console.log("\n[registry proof]");
  console.log(`  CapabilityManifest : ${manifestCapability?.status ?? "MISSING"}`);
  console.log(`  CapabilityRegistry : ${registryCapability?.status ?? "MISSING"}`);
  console.log(`  knowledge base     : ${knowledge.size()} entries; ${knowledge.search("fzzy search", 2).length} hit(s) for "fzzy search"`);
  console.log(
    `  offered tools      : ${toolSchemasForModel()
      .map((schema) => schema.name)
      .filter((name) => name.startsWith("repo_") || name.startsWith("kb_"))
      .join(", ") || "(none)"}${repoSearchOffered() ? "" : " — repo.search is NOT offered"}`,
  );

  const acquisition = await runtime.get(result.capability.acquisitionId);
  if (acquisition.ok) {
    console.log("\n[acquisition]");
    console.log(`  id         : ${acquisition.acquisition.id}`);
    console.log(`  status     : ${acquisition.acquisition.status}`);
    console.log(`  versions   : ${acquisition.acquisition.versions.map((version) => `${version.version}=${version.commit.slice(0, 8)}`).join(", ")}`);
    console.log(`  capability : ${acquisition.acquisition.capability}`);
    const logs = await runtime.logs(acquisition.acquisition.id, 6);
    if (logs.ok) {
      console.log("  last log entries:");
      for (const entry of logs.entries) {
        console.log(`    - ${entry.action} ${entry.ok ? "ok" : "FAILED"} ${entry.detail.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    }
  }

  if (!run.complete || !result.useResult) {
    console.error(`\n[FAIL] Pipeline complete=${run.complete}, use=${result.useResult ? "returned" : "no result"}.`);
    process.exit(1);
  }
  console.log("\n[PASS] All eleven stages have real evidence; the capability is registered and answered a live tool call.");
}

void main().catch((error: unknown) => {
  console.error(`[FAIL] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
