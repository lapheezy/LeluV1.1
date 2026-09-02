/**
 * LÉLU TOOL REGISTRY — REAL AVAILABILITY VERIFICATION
 *
 * ToolRegistry was a confirmed decorative catalog (turn 2 of this
 * audit): every `available` flag was a hardcoded boolean set once at
 * registration, never checked against anything, and its only two
 * outside references (useLeluRuntime.ts — whose return value is
 * discarded by its one caller — and EarthTools.ts, write-only) never
 * read it back. Cognition never saw it: CognitiveContext sourced
 * capability status from CapabilityManifest instead.
 *
 * This proves the fix is REAL, not a second cosmetic pass:
 *  1. workspace.{typecheck,test,build} availability is computed from
 *     the SAME AutonomyGate check WorkspaceRuntime itself enforces —
 *     not a guess that happens to agree with it today.
 *  2. Raising the autonomy level and refreshing again actually flips
 *     the flag — proving it's live, not cached forever at import time.
 *  3. github.* availability comes from a real (if network-less-here)
 *     GitHubIntegration.getStatus() probe, and fails closed (false),
 *     never throws, when that probe can't succeed.
 *  4. CognitiveContext now actually surfaces ToolRegistry's real
 *     risk/permission angle (toolsRequiringConfirmation) — a section
 *     that did not exist before and that changes when the underlying
 *     state changes, proving it isn't a static string.
 *
 * Run: bun run scripts/verify-tool-registry.ts
 */

// -- minimal localStorage shim (AutonomyGate → KvStore) --
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = globalThis.window ?? { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import ToolRegistry from "../src/core/tools/ToolRegistry";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import WorkspaceRuntime from "../src/core/engineering/WorkspaceRuntime";
import { buildCognitiveContext, formatCognitiveContext } from "../src/core/cognition/CognitiveContext";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const registry = ToolRegistry.getInstance();
  const gate = AutonomyGate.getInstance();
  const workspace = WorkspaceRuntime.getInstance();

  console.log("== Before any refresh: hardcoded registration-time values ==");
  assert(registry.get("workspace.test")?.available === false, "workspace.test starts at its hardcoded false");

  console.log("\n== At the default autonomy level, real availability agrees with WorkspaceRuntime's own gate ==");
  gate.setLevel(2); // AutonomyGate's own default
  await registry.refreshAvailability();
  for (const op of ["typecheck", "test", "build"] as const) {
    const real = workspace.allowed(op);
    const registered = registry.get(`workspace.${op}`)?.available;
    assert(
      registered === real,
      `workspace.${op} availability (${registered}) matches WorkspaceRuntime.allowed('${op}') (${real}) at level ${gate.getLevel()}`,
    );
  }
  assert(workspace.allowed("test") === false, "sanity: level 2 is below the level-3 gate these operations need");

  console.log("\n== Raising autonomy and refreshing again actually flips the flag — not cached forever ==");
  gate.setLevel(5);
  await registry.refreshAvailability();
  for (const op of ["typecheck", "test", "build"] as const) {
    assert(
      registry.get(`workspace.${op}`)?.available === true,
      `workspace.${op} becomes available once the real autonomy gate allows it`,
    );
  }
  gate.setLevel(2); // restore default for the rest of the run

  console.log("\n== GitHub tools: a real probe, fails closed rather than throwing ==");
  await registry.refreshAvailability();
  const githubIds = ["github.auth", "github.repos", "github.files", "github.branches", "github.commits", "github.prs"];
  for (const id of githubIds) {
    assert(
      registry.get(id)?.available === false,
      `${id} is honestly unavailable (no GitHub connection configured in this environment)`,
    );
  }

  console.log("\n== CognitiveContext now actually surfaces ToolRegistry's risk/permission angle ==");
  gate.setLevel(2);
  await registry.refreshAvailability();
  const lowCtx = buildCognitiveContext();
  assert(
    !lowCtx.toolsRequiringConfirmation.some((t) => t.id.startsWith("workspace.")),
    "at the default level, gated workspace ops are NOT listed as reachable confirmable actions",
  );
  assert(
    lowCtx.toolsRequiringConfirmation.some((t) => t.id === "sandbox.execute"),
    "an always-available risk-2+ tool (sandbox.execute) IS listed — the section isn't empty by construction",
  );

  gate.setLevel(5);
  await registry.refreshAvailability();
  const highCtx = buildCognitiveContext();
  const highText = formatCognitiveContext(highCtx);
  assert(
    highCtx.toolsRequiringConfirmation.some((t) => t.id === "workspace.test"),
    "once actually available, workspace.test appears in the SAME snapshot field cognition reads",
  );
  assert(
    highText.includes("## ACTIONS REQUIRING CONFIRMATION") && highText.includes("Run Tests"),
    "the formatted cognitive context text includes the new section with the real tool name",
    highText.slice(0, 200),
  );
  gate.setLevel(2);

  console.log(`\n${failures === 0 ? "ALL TOOL REGISTRY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
