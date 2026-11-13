/**
 * ==========================================================
 * LÉLU — INTERRUPTED-EXECUTION POLICY AND TASK RESUME
 *
 * CATEGORY: integration. No network.
 *
 * Measured on 2026-11-13: reloading the page during `research.web` left one
 * execution at `started` with no terminal record, and the reloaded turn ran the
 * same tool again under a new id. Harmless for a read; a double-applied write
 * for anything else.
 *
 * These tests pin the policy and the resume path:
 *   1. an unfinished side-effecting attempt blocks the identical retry;
 *   2. a completed attempt does not block a later, deliberate repeat;
 *   3. reads are never held;
 *   4. the app's own resume action actually drives the executor.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import ExecutionLedger, { attemptKey, isSideEffecting } from "../src/core/tools/ExecutionLedger";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";

function withLocalStorage(): void {
  const scope = globalThis as Record<string, unknown>;
  if (scope.localStorage) return;
  const store = new Map<string, string>();
  const shim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  scope.localStorage = shim;
  scope.window = scope.window ?? scope;
  (scope.window as Record<string, unknown>).localStorage = shim;
}

test("an unfinished write blocks the identical retry, and says why", async () => {
  withLocalStorage();
  ExecutionLedger.resetForTests();
  const ledger = ExecutionLedger.getInstance();
  const signature = "delete the old draft and save the new one";
  const args = { title: "draft" };

  // What an interrupted page leaves behind: a started attempt, never finished.
  const first = ledger.begin("studio.delete", args, signature, "turn-1");
  assert.equal(first.blocked, false, "the first attempt should be allowed");

  // The reloaded turn asks for exactly the same thing.
  const retry = ledger.begin("studio.delete", args, signature, "turn-2");
  assert.equal(retry.blocked, true, "an interrupted write was allowed to run twice");
  assert.match(String(retry.reason), /outcome is unknown/i);
  assert.match(String(retry.reason), /apply the change twice/i);

  // A different request is not the retry of this one.
  const other = ledger.begin("studio.delete", args, "a different instruction", "turn-3");
  assert.equal(other.blocked, false, "an unrelated request was blocked by the ledger");
});

test("a completed write does not block a deliberate repeat", () => {
  withLocalStorage();
  ExecutionLedger.resetForTests();
  const ledger = ExecutionLedger.getInstance();
  const signature = "save the brief";

  const first = ledger.begin("studio.create", { title: "brief" }, signature, "turn-1");
  assert.equal(first.blocked, false);
  ledger.finish(first.key);

  const again = ledger.begin("studio.create", { title: "brief" }, signature, "turn-2");
  assert.equal(again.blocked, false, "a finished write must not be treated as an interruption");
});

test("the key is stable across a reload and changes with the arguments", () => {
  const a = attemptKey("studio.create", { title: "x", n: 1 }, "same request");
  const b = attemptKey("studio.create", { title: "x", n: 1 }, "same request");
  const c = attemptKey("studio.create", { title: "y", n: 1 }, "same request");
  assert.equal(a, b, "the same call and request must produce the same key after a reload");
  assert.notEqual(a, c, "different arguments must not collide");
});

test("only side-effecting tools are tracked", async () => {
  withLocalStorage();
  ExecutionLedger.resetForTests();
  assert.equal(isSideEffecting("system.config"), false, "a read tool was classified as a write");

  const read = await dispatchToolCall(
    { id: "r1", name: "system_config", arguments: {} },
    "turn-read-1",
    undefined,
    { path: "chat", turnSignature: "check the configuration" },
  );
  assert.equal(read.ok, true);

  // The same read in the same request is not held by the ledger.
  const readAgain = await dispatchToolCall(
    { id: "r2", name: "system_config", arguments: {} },
    "turn-read-2",
    undefined,
    { path: "chat", turnSignature: "check the configuration" },
  );
  assert.equal(readAgain.ok, true, "a read was blocked as if it were a write");
});

test("the application's own resume action drives the executor from the checkpoint", async () => {
  withLocalStorage();
  const { default: TaskEngine } = await import("../src/core/tasks/TaskEngine");
  const { default: TaskExecutor } = await import("../src/core/agentic/TaskExecutor");
  const { default: WorkspaceAPI } = await import("../src/core/workspace/WorkspaceAPI");

  const engine = TaskEngine.getInstance();
  const task = engine.create({
    goal: "resume verification",
    description: "one real tool step",
    steps: [
      {
        id: "s1",
        title: "Check configured capabilities",
        description: "real tool",
        status: "pending",
        action: { kind: "tool", tool: "system.config", args: {} },
      },
    ],
    requiredTools: ["system.config"],
    origin: "verification",
  });

  // Interrupted: paused before the step ran.
  engine.pause(task.id);
  assert.equal(engine.get(task.id)?.status, "paused");

  const api = WorkspaceAPI.getInstance?.() ?? WorkspaceAPI;
  const result = (api as { execute: (call: unknown) => { ok: boolean; output?: string } }).execute({
    action: "resume-task",
    actor: "user",
    taskId: task.id,
  });
  assert.equal(result.ok, true, `resume was refused: ${JSON.stringify(result)}`);

  // The action starts execution in the background; wait for a terminal state.
  let settled = engine.get(task.id);
  for (let attempt = 0; attempt < 60 && settled?.status === "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    settled = engine.get(task.id);
  }
  assert.equal(settled?.status, "completed", `the resumed task did not run: ${settled?.status}`);
  assert.match(String(settled?.steps[0]?.output ?? ""), /Configured:/i, "the resumed step did not really execute");
});
