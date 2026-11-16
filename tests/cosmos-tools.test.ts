/**
 * LÉLU must be able to operate the cosmos through her REAL tool pipeline:
 * dispatcher → registry → autonomy gate → WorkspaceAPI → ApprovalGate.
 * These tests dispatch model-shaped tool calls, not WorkspaceAPI calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const memory = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

import { parseWorkspaceCall, registerCosmosTools } from "../src/core/cosmos/CosmosTools";
import { dispatchToolCall, executableToolIds, executorParameters, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import ApprovalGate from "../src/core/agentic/ApprovalGate";
import CosmosNavigation from "../src/core/cosmos/CosmosNavigation";
import SpatialObjects from "../src/core/cosmos/SpatialObjects";
import CosmosFocus from "../src/core/cosmos/CosmosFocus";
import WorkspaceAPI from "../src/core/workspace/WorkspaceAPI";
import ProjectStore from "../src/core/projects/ProjectStore";
import CosmosInspector from "../src/core/cosmos/CosmosInspector";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call-${Math.random().toString(36).slice(2)}`, name, arguments: args };
}

test("the cosmos tools are registered, executable and carry real parameter schemas", () => {
  registerCosmosTools();
  const registry = ToolRegistry.getInstance();

  for (const id of ["cosmos.workspace", "cosmos.map", "cosmos.inspect"]) {
    assert.ok(registry.get(id), `${id} is declared`);
    assert.ok(executableToolIds().includes(id), `${id} has an executor`);
    assert.ok(executorParameters(id), `${id} has parameters a model can be told about`);
    assert.equal(toolNameForModel(id), id.replace(".", "_"), "the model-facing name is the dotted id, mapped");
  }

  const workspace = registry.get("cosmos.workspace");
  assert.equal(workspace?.category, "Cosmos");
  assert.equal(workspace?.riskLevel, 1, "it changes local workspace state, not the outside world");
});

test("arguments are validated before anything executes", () => {
  const unknown = parseWorkspaceCall({ action: "drop-tables" });
  assert.equal(unknown.ok, false);

  const missingRoom = parseWorkspaceCall({ action: "navigate" });
  assert.equal(missingRoom.ok, false);

  const badKind = parseWorkspaceCall({ action: "open-workspace", view: { kind: "hologram", title: "x" } });
  assert.equal(badKind.ok, false);

  const badObject = parseWorkspaceCall({ action: "place-object", object: { kind: "note", title: "x" } });
  assert.equal(badObject.ok, false, "an object without a record link is refused");

  const good = parseWorkspaceCall({ action: "navigate", roomId: "cosmos-core" });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.call.actor, "lelu");

  // A model must not be able to claim the user's consent.
  const impersonation = parseWorkspaceCall({ action: "create-room", actor: "user", room: { label: "x" } });
  assert.equal(impersonation.ok, true);
  if (impersonation.ok) assert.equal(impersonation.call.actor, "lelu");
});

test("LÉLU reads the live map through the dispatcher", async () => {
  const mapped = await dispatchToolCall(call(toolNameForModel("cosmos.map"), { sync: false }), "task-map");
  assert.ok(mapped.ok, "the map tool runs");
  assert.match(mapped.content, /You are at/);
  assert.ok((mapped.data as { destinations: number }).destinations >= 1);
});

test("a yellow action returns a real approval instead of running", async () => {
  CosmosNavigation.reset();
  WorkspaceAPI.reset();
  const nav = CosmosNavigation.getInstance();
  const before = nav.rooms().length;

  const attempt = await dispatchToolCall(
    call(toolNameForModel("cosmos.workspace"), { action: "create-room", room: { label: "Observatory" } }),
    "task-approval",
  );

  assert.equal(attempt.ok, false, "nothing happened yet, so this is not a success");
  assert.match(attempt.content, /NOT DONE YET/);
  const pendingId = (attempt.data as { approvalId?: string }).approvalId;
  assert.ok(pendingId, "the model is given the id it must present after approval");
  assert.equal(nav.rooms().length, before, "the room does not exist until a person approves");
  assert.ok(ApprovalGate.getInstance().pending().some((request) => request.id === pendingId));

  ApprovalGate.getInstance().decide(pendingId as string, "approved");

  const approved = await dispatchToolCall(
    call(toolNameForModel("cosmos.workspace"), { action: "create-room", room: { label: "Observatory" }, approvalId: pendingId }),
    "task-approval",
  );
  assert.equal(approved.ok, true, "the approved call runs");
  assert.ok(nav.rooms().some((room) => room.label === "Observatory"));

  // Single-use: the same approval cannot create a second life for itself.
  const replay = await dispatchToolCall(
    call(toolNameForModel("cosmos.workspace"), { action: "create-room", room: { label: "Observatory" }, approvalId: pendingId }),
    "task-approval",
  );
  assert.equal(replay.ok, false);
  assert.match(replay.content, /NOT DONE YET/);
});

test("a rejected approval does not run the action", async () => {
  WorkspaceAPI.reset();
  const nav = CosmosNavigation.getInstance();
  const attempt = await dispatchToolCall(
    call(toolNameForModel("cosmos.workspace"), { action: "remove-room", roomId: nav.rooms()[0]?.id ?? "none" }),
    "task-reject",
  );
  const id = (attempt.data as { approvalId?: string }).approvalId;
  assert.ok(id, "removal is also yellow and waits");
  ApprovalGate.getInstance().decide(id as string, "rejected");

  const replay = await dispatchToolCall(
    call(toolNameForModel("cosmos.workspace"), { action: "remove-room", roomId: nav.rooms()[0]?.id ?? "none", approvalId: id }),
    "task-reject",
  );
  assert.equal(replay.ok, false);
});

test("protected actions are not reachable as tools at all", async () => {
  for (const action of ["deploy", "access-secrets", "alter-database", "modify-auth", "change-autonomy"]) {
    const parsed = parseWorkspaceCall({ action });
    assert.equal(parsed.ok, false, `${action} is not a tool action`);
    const dispatched = await dispatchToolCall(call(toolNameForModel("cosmos.workspace"), { action }), "task-red");
    assert.equal(dispatched.ok, false);
    assert.match(dispatched.content, /never available as tools/);
  }
});

test("a placed record is inspected from its own store, not its label", () => {
  CosmosFocus.reset();
  SpatialObjects.reset();
  const project = ProjectStore.getInstance().list()[0];
  assert.ok(project, "the project store has a real project to point at");

  const placed = SpatialObjects.getInstance().place({
    kind: "project",
    // A deliberately stale label: inspection must read the store, not this.
    title: "Stale project card",
    link: { kind: "project", id: project.id },
    roomId: "cosmos-core",
  });
  assert.ok(placed.ok);
  if (!placed.ok) return;

  CosmosFocus.getInstance().set({ kind: "object", id: placed.object.id });
  assert.deepEqual(CosmosFocus.getInstance().get(), { kind: "object", id: placed.object.id });

  const inspection = CosmosInspector.getInstance().inspect(placed.object.id);
  assert.equal(inspection.ok, true);
  assert.ok(
    inspection.lines.some((line) => line.includes(project.name)),
    "the record's own name comes from the store",
  );
  assert.equal(inspection.openable, true, "a project can be opened in the workspace");
});
