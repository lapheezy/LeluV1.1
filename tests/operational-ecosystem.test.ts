/**
 * ==========================================================
 * LÉLU — OPEN-SOURCE ECOSYSTEM, CHAT GROUNDING
 *
 * CATEGORY: unit. The ecosystem work is only honest if three
 * things hold:
 *
 *   • the repository catalog records verified provenance, and
 *     UNVERIFIED is a real value — Argus and OpenCam cannot be
 *     pinned from their names and must say so;
 *   • an undeclared dependency is reported as unknown, never
 *     promoted to ready;
 *   • the chat stage formats live data without inventing any, and
 *     only claims the intent it actually matched.
 *
 * These are additions. No existing test was weakened.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { describe } from "node:test";

import {
  REPOSITORY_CATALOG,
  repositoryCoverage,
  repositoriesFor,
} from "../src/core/operational-intelligence/repositories.ts";
import {
  NO_DEPENDENCY,
  declarationOf,
  dependencyCoverage,
  mayReadAsReady,
} from "../src/core/operational-intelligence/declarations.ts";
import { REQUIREMENTS } from "../src/core/operational-intelligence/dependencies.ts";
import {
  detectIntelligenceIntent,
  formatExplanation,
  formatPlan,
  formatRepositories,
  formatSnapshot,
} from "../src/core/router/IntelligenceResolver.ts";
import {
  buildSnapshot,
  normalizeCapability,
  normalizeStudio,
  type RawCapability,
} from "../src/core/operational-intelligence/index.ts";

const ROOT = process.cwd();

const RAW = (over: Partial<RawCapability> = {}): RawCapability => ({
  capabilityId: "test.capability",
  label: "Test capability",
  configured: true,
  available: true,
  authorized: true,
  selectable: true,
  executable: true,
  verified: false,
  detail: "observed",
  provenance: "local",
  source: "test",
  ...over,
});

const snapshot = () =>
  buildSnapshot(
    [
      normalizeStudio(
        "engineering",
        {
          ok: true,
          readAt: 1,
          capabilities: [
            normalizeCapability(
              RAW({ capabilityId: "engineering.openhands.execute", configured: false, available: false, selectable: false, executable: false }),
              "engineering",
              1,
            ),
            normalizeCapability(RAW({ capabilityId: "engineering.workspace.runtime", verified: true }), "engineering", 1),
          ],
        },
        1,
      ),
      normalizeStudio("voice", { ok: false, readAt: 1, capabilities: [], error: "connection refused" }, 1),
    ],
    { at: 1_700_000_000_000, durationMs: 42, fromCache: false },
  );

describe("repository catalog provenance", () => {
  test("ids are unique and every record states its studio and boundary", () => {
    const ids = REPOSITORY_CATALOG.map((record) => record.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const record of REPOSITORY_CATALOG) {
      assert.ok(record.boundary.trim().length > 0, `${record.id} has no boundary`);
      assert.ok(record.role.trim().length > 0, `${record.id} has no role`);
      assert.ok(record.statusDetail.trim().length > 0, `${record.id} has no status detail`);
    }
  });

  test("a verified record carries a real https upstream and a licence", () => {
    for (const record of REPOSITORY_CATALOG) {
      if (record.integration === "UNVERIFIED") continue;
      assert.match(record.upstream, /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/, `${record.id} upstream`);
      assert.ok(record.license && record.license !== "UNVERIFIED", `${record.id} licence`);
    }
  });

  test("Argus and OpenCam are recorded as unpinnable rather than guessed", () => {
    const unverified = REPOSITORY_CATALOG.filter((record) => record.integration === "UNVERIFIED");
    assert.deepEqual(unverified.map((record) => record.id).sort(), ["argus", "opencam"]);
    for (const record of unverified) {
      assert.equal(record.upstream, "");
      assert.equal(record.license, "UNVERIFIED");
    }
    assert.deepEqual(repositoryCoverage().unverified.sort(), ["argus", "opencam"]);
  });

  test("only adapters with real evidence are PRESENT", () => {
    const present = REPOSITORY_CATALOG.filter((record) => record.integration === "PRESENT").map((record) => record.id).sort();
    assert.deepEqual(present, ["gitleaks", "opa", "semgrep", "trivy"]);
  });

  test("a listing is never an installation", () => {
    const states = ["PRESENT", "ADAPTED", "PLANNED", "UNVERIFIED", "UNSUITABLE"];
    for (const record of REPOSITORY_CATALOG) {
      assert.ok(states.includes(record.integration), `${record.id} has an unknown state`);
      // Only a real adapter earns PRESENT; every other state says plainly
      // that the runtime is missing, unpinned or unsuitable.
      if (record.integration !== "PRESENT") {
        assert.ok(record.statusDetail.length > 0, `${record.id} does not say why it is not running`);
      }
    }
    // Some records are deliberately neither present nor planned: the
    // catalog keeps the unverified and unsuitable ones visible.
    const coverage = repositoryCoverage();
    assert.ok(coverage.total > coverage.present.length + coverage.planned.length);
  });

  test("studio queries return the right slice and never mutate the catalog", () => {
    const voice = repositoriesFor("voice");
    assert.ok(voice.length >= 4);
    assert.ok(voice.every((record) => record.studio === "voice"));
    const before = REPOSITORY_CATALOG.length;
    repositoriesFor("all").push();
    assert.equal(REPOSITORY_CATALOG.length, before);
  });
});

describe("dependency declarations", () => {
  test("a capability with no edge and no leaf declaration is undeclared", () => {
    assert.equal(declarationOf("some.new.capability"), "undeclared");
    assert.equal(mayReadAsReady("some.new.capability"), false);
  });

  test("a deliberate leaf is not confused with an omission", () => {
    assert.equal(declarationOf("security.policy.opa"), "no_dependencies");
    assert.equal(mayReadAsReady("security.policy.opa"), true);
    assert.ok(NO_DEPENDENCY.includes("voice.audio.input"));
  });

  test("dependent capabilities are declared, with their requirements", () => {
    assert.equal(declarationOf("engineering.openhands.execute"), "declared");
    const edges = REQUIREMENTS.filter((edge) => edge.dependentCapability === "engineering.openhands.execute");
    assert.ok(edges.length >= 2);
  });

  test("coverage names the undeclared ones instead of reporting full coverage", () => {
    const coverage = dependencyCoverage([
      "engineering.openhands.execute",
      "security.policy.opa",
      "engineering.something.unknown",
    ]);
    assert.deepEqual(coverage.undeclared, ["engineering.something.unknown"]);
    assert.ok(coverage.summary.includes("undeclared"));
    assert.ok(coverage.summary.includes("not treated as ready"));
  });

  test("empty input says nothing could be checked, not that all is well", () => {
    assert.ok(dependencyCoverage([]).summary.includes("nothing could be checked"));
  });
});

describe("chat intelligence intent", () => {
  test("status questions become a snapshot request", () => {
    assert.deepEqual(detectIntelligenceIntent("what is operational right now?"), { kind: "snapshot" });
    assert.deepEqual(detectIntelligenceIntent("which studios are working"), { kind: "snapshot" });
  });

  test("a blocker question names the capability it is about", () => {
    const intent = detectIntelligenceIntent("why can't you run OpenHands?");
    assert.equal(intent?.kind, "explain");
    assert.equal(intent?.kind === "explain" ? intent.capability : "", "engineering.openhands.execute");
  });

  test("voice blockers map to the real voice capabilities", () => {
    const intent = detectIntelligenceIntent("why can't you speak?");
    assert.equal(intent?.kind, "explain");
    assert.equal(intent?.kind === "explain" ? intent.capability : "", "voice.synthesis.speak");
  });

  test("preparation requests become plans, never installations", () => {
    const intent = detectIntelligenceIntent("prepare yourself to use OpenHands");
    assert.equal(intent?.kind, "plan");
  });

  test("repository questions go to the catalog", () => {
    const intent = detectIntelligenceIntent("which repository could provide the missing capability?");
    assert.equal(intent?.kind, "repositories");
  });

  test("ordinary conversation is left to the model", () => {
    assert.equal(detectIntelligenceIntent("write me a poem about the sea"), null);
    assert.equal(detectIntelligenceIntent("remind me to call my sister"), null);
  });
});

describe("chat formatting stays grounded", () => {
  test("a snapshot reports counts, unreadable studios and the failed count", () => {
    const text = formatSnapshot(snapshot());
    assert.ok(text.includes("Readiness"));
    assert.ok(text.includes("engineering"));
    assert.ok(text.includes("unreadable: connection refused"));
    assert.ok(text.includes("1 failed"));
    assert.ok(text.includes("Nothing here is inferred"));
  });

  test("an explanation lists requirements and marks the missing one", () => {
    const text = formatExplanation({
      capabilityId: "engineering.openhands.execute",
      state: "NOT_CONFIGURED",
      reasons: ["OpenHands base URL is not set"],
      requirements: [
        { required: "engineering.openhands.runtime", state: "NOT_CONFIGURED", reason: "OpenHands must answer first" },
        { required: "security.policy.opa", state: "VERIFIED", reason: "satisfied" },
      ],
    });
    assert.ok(text.includes("NOT_CONFIGURED"));
    assert.ok(text.includes("missing"));
    assert.ok(text.includes("met"));
  });

  test("an unreported capability is described as absent, not broken", () => {
    const text = formatExplanation({
      capabilityId: "voice.pipeline.realtime",
      state: "NOT_REPORTED",
      reasons: ["no studio reported this capability"],
      requirements: [],
    });
    assert.ok(text.includes("cannot describe it as working or broken"));
  });

  test("a plan shows awaiting approval and says nothing ran", () => {
    const text = formatPlan({
      plan: {
        goal: "prepare yourself to use OpenHands",
        status: "AWAITING_APPROVAL",
        approvalRequired: true,
        steps: [
          {
            title: "Configure engineering.openhands.runtime",
            status: "awaiting_approval",
            observedState: "NOT_CONFIGURED",
            description: "OpenHands must answer before a task can be dispatched",
            requiresApproval: true,
          },
        ],
        execution: { started: false, note: "Planning is not authorization and this plan has not run." },
        evidence: [],
      },
    });
    assert.ok(text.includes("AWAITING_APPROVAL"));
    assert.ok(text.includes("Nothing has run"));
    assert.ok(text.includes("approval is required"));
  });

  test("the repository answer separates real adapters from intent", () => {
    const text = formatRepositories();
    assert.ok(text.includes("Already providing a capability"));
    assert.ok(text.includes("Cannot be verified as named"));
    assert.ok(text.includes("Installation is never implied"));
  });
});

describe("architecture boundary", () => {
  test("the chat stage reaches adapters through no import", () => {
    const content = readFileSync(join(ROOT, "src/core/router/IntelligenceResolver.ts"), "utf8");
    assert.ok(!content.includes("AdapterRegistry"));
    assert.ok(!content.includes("EngineeringOrchestrator"));
    assert.ok(content.includes("/api/integration/intelligence"));
  });

  test("the repository catalog is browser-safe", () => {
    const content = readFileSync(join(ROOT, "src/core/operational-intelligence/repositories.ts"), "utf8");
    assert.ok(!content.includes("node:fs"));
    assert.ok(!content.includes("process.env"));
  });
});
