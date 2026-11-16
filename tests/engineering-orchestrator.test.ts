/**
 * ==========================================================
 * LÉLU — ENGINEERING ORCHESTRATOR
 *
 * CATEGORY: unit. What this proves:
 *   • an explicit engine request is honoured or refused with the
 *     engine's REAL state — never silently swapped for another;
 *   • two engines may not edit one workspace at the same time;
 *   • "verified" requires a real test run with zero failures;
 *   • a change outside the allowed paths is not verified;
 *   • merging always needs a human approval afterwards.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import EngineeringOrchestrator, {
  verify,
  type BackendRunResult,
  type CodingBackend,
  type CodingTask,
  type EngineId,
} from "../src/core/engineering/EngineeringOrchestrator";
import type { AdapterHealth } from "../src/core/integration/protocol";

function backend(
  id: EngineId,
  state: AdapterHealth["state"],
  run?: (task: CodingTask) => Promise<BackendRunResult>,
): CodingBackend {
  return {
    id,
    name: `${id} backend`,
    source: "https://example.invalid",
    health: async () => ({ state, detail: `${id} is ${state}`, checkedAt: Date.now(), contacted: state === "healthy" }),
    run: run ?? (async () => result(id)),
  };
}

function result(engine: EngineId, overrides: Partial<BackendRunResult> = {}): BackendRunResult {
  return {
    ok: true,
    engine,
    summary: "changed the parser and the test passed",
    changedFiles: ["src/parser.ts"],
    commands: [{ command: "tsc -b", exitCode: 0, output: "" }],
    tests: { passed: 12, failed: 0, failures: [], ran: true, command: "npm test" },
    artifacts: [{ kind: "diff", ref: "diff.patch", label: "change" }],
    ...overrides,
  };
}

function task(overrides: Partial<CodingTask> = {}): CodingTask {
  return {
    id: "task-1",
    objective: "fix the failing tests",
    repository: "LeluV1.1",
    workspaceId: "ws-1",
    allowedPaths: ["src/parser.ts"],
    ...overrides,
  };
}

function orchestrator(): EngineeringOrchestrator {
  const instance = EngineeringOrchestrator.getInstance();
  instance.resetForTests();
  return instance;
}

test("the requested engine is used when it is healthy", async () => {
  const engine = orchestrator();
  engine.registerBackend(backend("openhands", "healthy"));
  engine.registerBackend(backend("local", "healthy"));
  const outcome = await engine.run(task({ engine: "openhands" }));
  assert.equal(outcome.engine, "openhands");
  assert.equal(outcome.ran, true);
  assert.equal(outcome.verification.verified, true);
  assert.match(outcome.selectedReason, /requested openhands/);
});

test("an explicitly requested engine that is down is refused, not replaced", async () => {
  const engine = orchestrator();
  engine.registerBackend(backend("opencode", "not_configured"));
  engine.registerBackend(backend("local", "healthy"));
  const outcome = await engine.run(task({ engine: "opencode" }));
  assert.equal(outcome.ran, false);
  assert.equal(outcome.engine, null);
  assert.match(outcome.selectedReason, /not_configured/);
  assert.match(outcome.selectedReason, /OPENCODE_BASE_URL|not_configured/i);
  assert.equal(outcome.verification.verified, false);
});

test("with no explicit request the preference order applies, and a down engine is skipped", async () => {
  const engine = orchestrator();
  engine.registerBackend(backend("openhands", "unavailable"));
  engine.registerBackend(backend("opencode", "not_configured"));
  engine.registerBackend(backend("local", "healthy"));
  const outcome = await engine.run(task());
  assert.equal(outcome.engine, "local");
  assert.match(outcome.selectedReason, /preference order/);
});

test("two tasks cannot hold one workspace at the same time", async () => {
  const engine = orchestrator();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  engine.registerBackend(
    backend("local", "healthy", async () => {
      await gate;
      return result("local");
    }),
  );

  const first = engine.run(task({ id: "task-a" }));
  // Let the first task take the lock.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await engine.run(task({ id: "task-b" }));
  release?.();
  const firstOutcome = await first;

  assert.equal(firstOutcome.ran, true);
  assert.equal(second.ran, false);
  assert.match(second.selectedReason, /already held by local for task task-a/);
  assert.deepEqual(engine.activeLocks(), [], "the lock is released when the task finishes");
});

test("a change with no test run is NOT verified", () => {
  const report = verify(task(), result("local", { tests: undefined }));
  assert.equal(report.verified, false);
  const check = report.checks.find((item) => item.name === "tests_ran");
  assert.equal(check?.ok, false);
  assert.match(String(check?.detail), /no test run was recorded/);
});

test("a failing test run is NOT verified, and the failure text is kept", () => {
  const report = verify(
    task(),
    result("local", { tests: { passed: 10, failed: 2, failures: ["parser.test.ts: expected 3, got 2"], ran: true, command: "npm test" } }),
  );
  assert.equal(report.verified, false);
  assert.ok(report.evidence.some((line) => line.includes("parser.test.ts: expected 3, got 2")));
});

test("a change outside the allowed paths is NOT verified", () => {
  const report = verify(task(), result("local", { changedFiles: ["src/parser.ts", "src/unrelated.ts"] }));
  assert.equal(report.verified, false);
  const check = report.checks.find((item) => item.name === "changes_within_allowed_paths");
  assert.equal(check?.ok, false);
  assert.match(String(check?.detail), /src\/unrelated\.ts/);
});

test("a verified task still needs approval before it can merge", async () => {
  const engine = orchestrator();
  engine.registerBackend(backend("local", "healthy"));
  const outcome = await engine.run(task({ requiresMerge: true }));
  assert.equal(outcome.verification.verified, true);
  assert.equal(outcome.needsApproval, true, "a merge is never implied by a successful run");
});

test("a backend that throws becomes a recorded failure, not an exception", async () => {
  const engine = orchestrator();
  engine.registerBackend(
    backend("local", "healthy", async () => {
      throw new Error("sandbox ran out of disk");
    }),
  );
  const outcome = await engine.run(task());
  assert.equal(outcome.ran, true);
  assert.equal(outcome.verification.verified, false);
  assert.match(String(outcome.result?.error), /ran out of disk/);
});
