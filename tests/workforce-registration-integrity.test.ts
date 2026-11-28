/**
 * Workforce consolidation (WP03) — registration integrity.
 *
 * Several workforces (Claude, Freebuff, Jules, Codelazr) contributed tool
 * registrars that all land in ONE ToolRegistry and ONE dispatch table. Both use
 * Map#set, so a second registrar reusing an id would silently replace the first
 * definition or executor. This test boots every registrar Bootstrap calls and
 * fails if any id is registered by two different definitions, and reports any
 * registered tool that has no executor behind it.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import SelfChangeAwareness from "../src/core/cognition/SelfChangeAwareness";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import type { ToolDefinition } from "../src/core/tools/ToolRegistry";
import { executableToolIds } from "../src/core/tools/ToolDispatcher";
import { registerEarthTools } from "../src/core/earth/EarthTools";
import { registerForgeTools } from "../src/core/forge/ForgeTools";
import { registerAsreTools } from "../src/core/asre/AsreTools";
import { registerFoundryTools } from "../src/core/asre/foundry/FoundryTools";
import { registerSelfTools } from "../src/core/cognition/SelfTools";
import { registerWorldTools } from "../src/core/world/WorldTools";
import { registerAgenticTools } from "../src/core/agentic/AgenticTools";
import { registerInterfaceTools } from "../src/core/interface/InterfaceTools";
import { registerEnvironmentTools } from "../src/core/orchestrator/EnvironmentTools";
import { registerStudioTools } from "../src/core/studio/StudioTools";
import { registerAtelierTools } from "../src/core/atelier/AtelierTools";
import { registerCreativeKitTools } from "../src/core/creative/kit/CreativeKitTools";
import { registerCosmosObjectTools } from "../src/core/cosmos/objects/CosmosObjectTools";
import { registerCosmosTools } from "../src/core/cosmos/CosmosTools";
import { registerInterfaceCompositionTools } from "../src/core/interface/InterfaceCompositionTools";
import { registerNeuralMapTools } from "../src/core/neural/NeuralMapTools";
import { registerCoutureTools } from "../src/core/couture/CoutureTools";
import { registerContinuityTools } from "../src/core/cognition/ContinuityTools";
import { registerUsageTools } from "../src/core/observability/UsageTools";
import { registerStewardTools } from "../src/core/selfdev/NeuralMapSteward";
import { registerReferenceTools } from "../src/core/references/ReferenceTools";
import { registerDiagnosticsTools } from "../src/core/diagnostics/DiagnosticsTools";
import { registerNeuralTools } from "../src/core/neural/NeuralTools";
import { registerPerformanceTools } from "../src/core/performance/PerformanceTools";

// registerSelfTools starts a 10-minute refresh timer; stop it so the run can exit.
after(() => SelfChangeAwareness.getInstance().stop());

const REGISTRARS: Array<[string, () => void]> = [
  ["earth", registerEarthTools],
  ["forge", registerForgeTools],
  ["asre", registerAsreTools],
  ["foundry", registerFoundryTools],
  ["self", registerSelfTools],
  ["world", registerWorldTools],
  ["agentic", registerAgenticTools],
  ["interface", registerInterfaceTools],
  ["environment", registerEnvironmentTools],
  ["studio", registerStudioTools],
  ["atelier", registerAtelierTools],
  ["creativeKit", registerCreativeKitTools],
  ["cosmosObjects", registerCosmosObjectTools],
  ["cosmos", registerCosmosTools],
  ["interfaceComposition", registerInterfaceCompositionTools],
  ["neuralMap", registerNeuralMapTools],
  ["usage", registerUsageTools],
  ["steward", registerStewardTools],
  ["continuity", () => void registerContinuityTools()],
  ["couture", registerCoutureTools],
  ["references", registerReferenceTools],
  ["diagnostics", registerDiagnosticsTools],
  ["neural", registerNeuralTools],
  ["performance", registerPerformanceTools],
];

test("re-registrations never lower a tool's risk level or swap one registrar's tool for another's", () => {
  // Known, deliberate pattern: ToolRegistry's builtin catalog declares some ids
  // (environment.*, studio.*, agent.delegate) that their owning registrar then
  // re-declares with its own executionRoute. That is allowed ONLY if the risk
  // level — the approval boundary — is unchanged. Between two non-builtin
  // registrars the only allowed re-registration is the creative kit adding a
  // capability `profile` to an existing definition.
  const registry = ToolRegistry.getInstance();
  const owner = new Map<string, { source: string; def: ToolDefinition }>();
  for (const t of registry.all()) owner.set(t.id, { source: "builtin", def: t });
  const violations: string[] = [];
  const original = registry.register.bind(registry);
  let current = "";
  registry.register = (def: ToolDefinition) => {
    const prior = owner.get(def.id);
    if (prior && prior.def !== def && prior.source !== current) {
      if (def.riskLevel < prior.def.riskLevel) {
        violations.push(`${def.id}: risk lowered ${prior.def.riskLevel}→${def.riskLevel} (${prior.source} → ${current})`);
      }
      if (prior.source !== "builtin") {
        const { profile: _a, ...a } = prior.def;
        const { profile: _b, ...b } = def;
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          violations.push(`${def.id}: ${prior.source} definition replaced by ${current}`);
        }
      }
    }
    owner.set(def.id, { source: current, def });
    original(def);
  };
  try {
    for (const [name, fn] of REGISTRARS) {
      current = name;
      fn();
    }
  } finally {
    registry.register = original;
  }
  assert.deepEqual(violations, []);
});

test("every registered tool id is unique and the dispatch table has no blank ids", () => {
  const ids = ToolRegistry.getInstance().all().map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const exec = executableToolIds();
  assert.equal(new Set(exec).size, exec.length);
  assert.ok(exec.every((id) => typeof id === "string" && id.length > 0));
});

test("registry ↔ executor coverage is reported, and executors never lack a definition", () => {
  const registry = ToolRegistry.getInstance();
  for (const [, fn] of REGISTRARS) fn();
  const defined = new Set(registry.all().map((t) => t.id));
  const executable = new Set(executableToolIds());
  const orphanExecutors = [...executable].filter((id) => !defined.has(id));
  const unexecutable = [...defined].filter((id) => !executable.has(id));
  // A definition with no executor is honestly reported unavailable elsewhere;
  // we only record the count. An executor with no definition can never be
  // offered or gated and is an orphaned integration.
  console.info(`[integrity] ${defined.size} definitions, ${executable.size} executors, ${unexecutable.length} definitions without executor`);
  assert.deepEqual(orphanExecutors, [], `executors with no registry definition: ${orphanExecutors.join(", ")}`);
});

test("this probe covers exactly the registrars Bootstrap calls", async () => {
  const { readFileSync } = await import("node:fs");
  const boot = readFileSync(new URL("../src/core/Bootstrap.ts", import.meta.url), "utf8");
  const called = [...new Set([...boot.matchAll(/\b(register[A-Za-z]*Tools)\(\)/g)].map((m) => m[1]))].sort();
  const probe = readFileSync(new URL(import.meta.url), "utf8");
  const covered = [...new Set([...probe.matchAll(/^import \{ (register[A-Za-z]*Tools) \}/gm)].map((m) => m[1]))].sort();
  assert.deepEqual(covered, called);
});
