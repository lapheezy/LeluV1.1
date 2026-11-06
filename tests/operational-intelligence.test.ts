/**
 * ==========================================================
 * LÉLU — CROSS-STUDIO OPERATIONAL INTELLIGENCE
 *
 * CATEGORY: unit. What Phase 3A added must stay true:
 *
 *   • the state ladder (configured ≠ available ≠ authorized ≠
 *     executable ≠ verified) is the only way a capability is
 *     described;
 *   • one unreadable studio never becomes an empty healthy one,
 *     and never stops the other three being read;
 *   • the dependency graph explains a blocker instead of
 *     asserting one;
 *   • a plan is never an execution, and never approves itself;
 *   • the intelligence layer and the studio panels cannot reach
 *     an adapter.
 *
 * These are additions. No existing test was weakened or removed.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { describe } from "node:test";

import {
  OperationalCollector,
  OperationalPlanner,
  buildDependencyGraph,
  buildSnapshot,
  explainCapability,
  findCycles,
  normalizeCapability,
  normalizeStudio,
  redactSecrets,
  resolveState,
  summarizeReadiness,
  targetCapabilities,
  topologicalOrder,
  worstState,
  type RawCapability,
  type RawStudioPayload,
  type RequirementEdge,
  type StudioId,
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

const studioSource = (
  studioId: StudioId,
  payload: RawStudioPayload | (() => Promise<RawStudioPayload>),
) => ({
  studioId,
  read: typeof payload === "function" ? payload : async () => payload,
});

describe("capability state ladder", () => {
  test("unconfigured is NOT_CONFIGURED and never degraded", () => {
    const resolved = resolveState({ configured: false, available: false, authorized: false, executable: false, verified: false });
    assert.equal(resolved.state, "NOT_CONFIGURED");
    assert.ok(resolved.blockingReasons[0]?.includes("not configured"));
  });

  test("configured but unreachable is BLOCKED with a reason", () => {
    const resolved = resolveState({ configured: true, available: false, authorized: true, executable: false, verified: false });
    assert.equal(resolved.state, "BLOCKED");
    assert.ok(resolved.blockingReasons.join(" ").includes("not reachable"));
  });

  test("available but unauthorized is BLOCKED, not available", () => {
    const resolved = resolveState({ configured: true, available: true, authorized: false, executable: false, verified: false });
    assert.equal(resolved.state, "BLOCKED");
    assert.ok(resolved.blockingReasons.join(" ").includes("not authorized"));
  });

  test("authorized but not selectable is BLOCKED (no backend)", () => {
    const resolved = resolveState({
      configured: true,
      available: true,
      authorized: true,
      selectable: false,
      executable: false,
      verified: false,
    });
    assert.equal(resolved.state, "BLOCKED");
    assert.ok(resolved.blockingReasons.join(" ").includes("not selectable"));
  });

  test("executable but unverified is AVAILABLE, never VERIFIED", () => {
    const resolved = resolveState({ configured: true, available: true, authorized: true, executable: true, verified: false });
    assert.equal(resolved.state, "AVAILABLE");
    assert.ok(resolved.blockingReasons.join(" ").includes("no result has been verified"));
  });

  test("verified only when every earlier rung passed", () => {
    assert.equal(
      resolveState({ configured: true, available: true, authorized: true, executable: true, verified: true }).state,
      "VERIFIED",
    );
  });

  test("a studio takes the worst state of its capabilities", () => {
    assert.equal(worstState(["VERIFIED", "AVAILABLE", "NOT_CONFIGURED", "DEGRADED"]), "NOT_CONFIGURED");
    assert.equal(worstState(["VERIFIED", "AVAILABLE"]), "VERIFIED");
    assert.equal(worstState([]), "NOT_CONFIGURED");
  });

  test("normalization keeps the state and the blocking reasons together", () => {
    const capability = normalizeCapability(RAW({ capabilityId: "x.y", available: false }), "engineering", 1);
    assert.equal(capability.state, "BLOCKED");
    assert.ok(capability.blockingReasons.length > 0);
    assert.equal(capability.evidence[0]?.provenance, "local");
  });
});

describe("studio normalization", () => {
  test("a studio that could not be read is UNAVAILABLE with its error, not empty-and-fine", () => {
    const studio = normalizeStudio("voice", { ok: false, readAt: 5, capabilities: [], error: "timeout" }, 5);
    assert.equal(studio.operationalState, "UNAVAILABLE");
    assert.equal(studio.error, "timeout");
    assert.equal(studio.evidenceReferences[0]?.provenance, "unavailable");
  });

  test("a null payload is UNAVAILABLE rather than an empty healthy studio", () => {
    const studio = normalizeStudio("security", null, 10);
    assert.equal(studio.operationalState, "UNAVAILABLE");
    assert.deepEqual(studio.capabilities, []);
  });

  test("unavailable capabilities are listed for the studio", () => {
    const payload: RawStudioPayload = {
      ok: true,
      readAt: 3,
      capabilities: [RAW({ capabilityId: "a.ok" }), RAW({ capabilityId: "b.down", available: false })],
    };
    const studio = normalizeStudio("infrastructure", payload, 3);
    assert.deepEqual(studio.unavailableCapabilities, ["b.down"]);
  });
});

describe("collector", () => {
  test("reads all four studios and records how many succeeded", async () => {
    const collector = new OperationalCollector(
      (["engineering", "voice", "infrastructure", "security"] as StudioId[]).map((id) =>
        studioSource(id, { ok: true, readAt: 100, capabilities: [RAW({ capabilityId: `${id}.one` })] }),
      ),
      { now: () => 1_000, ttlMs: 1 },
    );
    const snapshot = await collector.collect();
    assert.equal(snapshot.studioStatuses.length, 4);
    assert.equal(snapshot.collection.studiosRead, 4);
    assert.equal(snapshot.collection.studiosFailed, 0);
  });

  test("one failing studio does not prevent the others being read", async () => {
    const collector = new OperationalCollector(
      [
        studioSource("engineering", { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "eng.one" })] }),
        studioSource("voice", async () => {
          throw new Error("connection refused");
        }),
        studioSource("infrastructure", { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "infra.one" })] }),
        studioSource("security", { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "sec.one" })] }),
      ],
      { now: () => 2_000, ttlMs: 1 },
    );
    const snapshot = await collector.collect();
    const voice = snapshot.studioStatuses.find((studio) => studio.studioId === "voice");
    assert.equal(voice?.operationalState, "UNAVAILABLE");
    assert.ok(voice?.error?.includes("connection refused"));
    assert.equal(snapshot.collection.studiosRead, 3);
    assert.ok(snapshot.capabilities.map((capability) => capability.capabilityId).includes("eng.one"));
  });

  test("a studio with no source is reported as unavailable, not omitted", async () => {
    const collector = new OperationalCollector(
      [studioSource("engineering", { ok: true, readAt: 1, capabilities: [] })],
      { now: () => 3_000, ttlMs: 1 },
    );
    const snapshot = await collector.collect();
    assert.equal(snapshot.studioStatuses.length, 4);
    const missing = snapshot.studioStatuses.filter((studio) => studio.error?.includes("no source"));
    assert.deepEqual(
      missing.map((studio) => studio.studioId).sort(),
      ["infrastructure", "security", "voice"],
    );
  });

  test("serves a cached snapshot inside the TTL and refreshes past it", async () => {
    let reads = 0;
    let clock = 0;
    const collector = new OperationalCollector(
      [
        {
          studioId: "engineering",
          read: async () => {
            reads += 1;
            return { ok: true, readAt: clock, capabilities: [RAW({ capabilityId: "eng.one" })] };
          },
        },
      ],
      { now: () => clock, ttlMs: 100 },
    );
    await collector.collect();
    clock = 50;
    const cached = await collector.collect();
    assert.equal(reads, 1);
    assert.equal(cached.collection.fromCache, true);
    clock = 200;
    await collector.collect();
    assert.equal(reads, 2);
  });

  test("readiness counts usable capabilities instead of assuming any", () => {
    const studios = [
      normalizeStudio("engineering", { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "a" })] }, 1),
      normalizeStudio("voice", { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "b", configured: false })] }, 1),
    ];
    const readiness = summarizeReadiness(studios);
    assert.equal(readiness.totalCapabilities, 2);
    assert.equal(readiness.score, 0.5);
    assert.ok(readiness.detail.includes("1 of 2"));
  });

  test("secret-shaped keys never survive redaction", () => {
    const redacted = redactSecrets({ apiKey: "sk-live", nested: { token: "t", Authorization: "b", keep: "ok" } });
    const serialized = JSON.stringify(redacted);
    assert.ok(!serialized.includes("sk-live"));
    assert.ok(!serialized.includes('"t"'));
    assert.equal((redacted as { nested: { keep: string } }).nested.keep, "ok");
  });
});

describe("dependency intelligence", () => {
  const edges: RequirementEdge[] = [
    { dependentCapability: "engine.execute", requiredCapability: "engine.runtime", reason: "runtime must answer" },
    { dependentCapability: "engine.execute", requiredCapability: "policy.opa", reason: "policy must authorize" },
  ];

  const capabilities = () => [
    normalizeCapability(RAW({ capabilityId: "engine.execute" }), "engineering", 1),
    normalizeCapability(
      RAW({ capabilityId: "engine.runtime", configured: false, available: false, executable: false }),
      "engineering",
      1,
    ),
    normalizeCapability(RAW({ capabilityId: "policy.opa" }), "security", 1),
  ];

  test("a missing prerequisite is reported with the requirement that explains it", () => {
    const graph = buildDependencyGraph(capabilities(), edges);
    const blockers = graph.blockersFor("engine.execute");
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0]?.requiredCapability, "engine.runtime");
    assert.ok(blockers[0]?.blockingReason.includes("runtime must answer"));
    assert.equal(graph.readinessOf("engine.execute").ready, false);
  });

  test("all requirements satisfied means ready", () => {
    const healthy = [
      normalizeCapability(RAW({ capabilityId: "engine.execute" }), "engineering", 1),
      normalizeCapability(RAW({ capabilityId: "engine.runtime" }), "engineering", 1),
      normalizeCapability(RAW({ capabilityId: "policy.opa" }), "security", 1),
    ];
    assert.equal(buildDependencyGraph(healthy, edges).readinessOf("engine.execute").ready, true);
  });

  test("cycles are detected rather than followed forever", () => {
    const cyclic: RequirementEdge[] = [
      { dependentCapability: "a", requiredCapability: "b", reason: "a needs b" },
      { dependentCapability: "b", requiredCapability: "a", reason: "b needs a" },
    ];
    const cycles = findCycles(["a", "b"], cyclic);
    assert.ok(cycles.length > 0);
    assert.ok(cycles[0]?.includes("a"));
  });

  test("ordering puts requirements before the capabilities that need them", () => {
    const order = topologicalOrder(["engine.execute", "engine.runtime", "policy.opa"], edges);
    assert.ok(order.indexOf("engine.runtime") < order.indexOf("engine.execute"));
    assert.ok(order.indexOf("policy.opa") < order.indexOf("engine.execute"));
  });

  test("impact counts the capabilities a missing requirement blocks", () => {
    assert.ok(buildDependencyGraph(capabilities(), edges).impactOf("engine.runtime") > 0);
  });

  test("an unreported capability is named as unreported, not silently healthy", () => {
    const studios = [normalizeStudio("engineering", { ok: true, readAt: 1, capabilities: [] }, 1)];
    const snapshot = buildSnapshot(studios, { at: 1, durationMs: 1, fromCache: false });
    assert.equal(explainCapability(snapshot, "voice.synthesis.speak").state, "NOT_REPORTED");
  });
});

describe("operational planner", () => {
  const blockedSnapshot = () =>
    buildSnapshot(
      [
        normalizeStudio(
          "engineering",
          {
            ok: true,
            readAt: 1,
            capabilities: [
              RAW({ capabilityId: "engineering.openhands.runtime", configured: false, available: false, executable: false }),
              RAW({
                capabilityId: "engineering.openhands.execute",
                configured: false,
                available: false,
                selectable: false,
                executable: false,
              }),
              RAW({ capabilityId: "engineering.workspace.runtime", verified: true }),
              RAW({ capabilityId: "security.policy.opa", verified: true }),
              RAW({ capabilityId: "security.scanner.gitleaks", verified: true }),
            ],
          },
          1,
        ),
      ],
      { at: 1, durationMs: 2, fromCache: false },
    );

  test("a blocked engine produces awaiting-approval steps, never an execution", () => {
    const plan = new OperationalPlanner().createActivationPlan("Get OpenHands working", blockedSnapshot());
    assert.equal(plan.status, "AWAITING_APPROVAL");
    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.execution.started, false);
    assert.ok(plan.steps.length > 0);
    assert.ok(plan.steps.every((step) => step.requiresApproval));
  });

  test("the plan is recorded by the existing PlanningEngine", () => {
    const planner = new OperationalPlanner();
    const plan = planner.createActivationPlan("Get OpenHands working", blockedSnapshot());
    const recorded = planner.plans().find((item) => item.id === plan.planningEnginePlanId);
    assert.ok(recorded);
    assert.equal(recorded?.steps.length, plan.steps.length);
  });

  test("an already-usable capability yields a verification step, not invented work", () => {
    const snapshot = buildSnapshot(
      [
        normalizeStudio(
          "voice",
          { ok: true, readAt: 1, capabilities: [RAW({ capabilityId: "voice.synthesis.speak", verified: true })] },
          1,
        ),
      ],
      { at: 1, durationMs: 1, fromCache: false },
    );
    const plan = new OperationalPlanner().createActivationPlan("Can you speak?", snapshot);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.status, "pending");
    assert.equal(plan.approvalRequired, false);
  });

  test("goal keywords select the real capabilities", () => {
    const snapshot = blockedSnapshot();
    assert.ok(targetCapabilities("why can't you run OpenHands?", snapshot).includes("engineering.openhands.execute"));
    assert.ok(targetCapabilities("why can't you speak?", snapshot).includes("voice.synthesis.speak"));
  });
});

describe("architecture boundary", () => {
  const intelligenceDir = join(ROOT, "src/core/operational-intelligence");
  const files = readdirSync(intelligenceDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, content: readFileSync(join(intelligenceDir, file), "utf8") }));

  test("the intelligence layer never imports an adapter or the registry", () => {
    for (const { content } of files) {
      // The rule is about imports, not prose: a comment may name the
      // registry, but no module here may import it or an adapter.
      assert.doesNotMatch(content, /^\s*import[^;]*AdapterRegistry/m);
      assert.doesNotMatch(content, /^\s*import[^;]*(nodeAdapters|denoAdapters|selfViewApi)/m);
    }
  });

  test("the intelligence layer is browser-safe: no node built-ins", () => {
    for (const { content } of files) {
      assert.ok(!content.includes("node:fs"));
      assert.ok(!content.includes("node:child_process"));
    }
  });

  test("studio panels reach capabilities only through the integration API", () => {
    const panelsDir = join(ROOT, "src/app/scene/genesis/integration");
    const panels = readdirSync(panelsDir).filter((file) => file.endsWith(".tsx"));
    assert.ok(panels.length > 0);
    for (const panel of panels) {
      const content = readFileSync(join(panelsDir, panel), "utf8");
      assert.ok(!content.includes("AdapterRegistry"));
      assert.ok(!content.includes("/plugins/"));
    }
  });
});
