/**
 * ==========================================================
 * LÉLU — THE WORKSPACE API IS THE SAME DOOR FOR EVERYONE
 *
 * CATEGORY: integration. Real WorkspaceEngine, real
 * CosmosNavigation, real SpatialObjects, real TaskEngine and
 * the real ApprovalGate. No model and no network: the calls
 * are the ones LÉLU's tool path or a person's click makes.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import WorkspaceAPI from "../src/core/workspace/WorkspaceAPI";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import CosmosNavigation from "../src/core/cosmos/CosmosNavigation";
import SpatialObjects from "../src/core/cosmos/SpatialObjects";
import TaskEngine from "../src/core/tasks/TaskEngine";
import ApprovalGate from "../src/core/agentic/ApprovalGate";
import KvStore from "../src/core/storage/KvStore";

const api = () => WorkspaceAPI.getInstance();
const engine = () => WorkspaceEngine.getInstance();
const nav = () => CosmosNavigation.getInstance();

beforeEach(() => {
  engine().clear();
  CosmosNavigation.reset();
  SpatialObjects.reset();
  WorkspaceAPI.reset();
  KvStore.getInstance().remove("lelu.approvals.v1");
  ApprovalGate.getInstance().reload();
});

function seedMap() {
  nav().registerAll([
    { id: "cosmos-core", level: "core", label: "LÉLU CORE", parentId: null },
    { id: "exec-engineer", level: "galaxy", label: "Engineering & Systems", parentId: "cosmos-core" },
  ]);
}

test("a green action she starts herself runs immediately and is journaled", () => {
  const result = api().execute({
    action: "open-workspace",
    actor: "lelu",
    view: { kind: "browser", title: "Example Domain", url: "https://example.com/" },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.boundary, "green");
  assert.equal(result.requiresApproval, false);
  const view = engine().getState().views.find((item) => item.title === "Example Domain");
  assert.ok(view, "the REAL workspace has the view");
  assert.equal(view!.source?.tool, "workspace-api");
  assert.ok(api().journalEntries().some((entry) => entry.action === "open-workspace" && entry.ok));
});

test("arranging windows is real, not a recorded preference", () => {
  const w = api();
  w.execute({ action: "open-workspace", actor: "user", view: { kind: "browser", title: "Page A" } });
  w.execute({ action: "open-workspace", actor: "user", view: { kind: "image", title: "Shot B" } });

  const arranged = w.execute({ action: "arrange-windows", actor: "lelu", layout: "split" });
  assert.equal(arranged.ok, true, arranged.message);
  assert.equal(engine().getState().layout, "split");
  assert.equal(engine().getState().splitIds.length, 2, "the two open views are the split");
});

test("LÉLU's room waits for approval, and the approval is single-use", () => {
  seedMap();
  const asked = api().execute({ action: "create-room", actor: "lelu", room: { label: "Observatory" } });
  assert.equal(asked.ok, false);
  assert.equal(asked.boundary, "yellow");
  assert.equal(asked.requiresApproval, true);
  assert.ok(asked.approvalId);
  assert.equal(nav().rooms().length, 0, "nothing was created while waiting");

  ApprovalGate.getInstance().decide(asked.approvalId!, "approved");
  const sameCall = { action: "create-room" as const, actor: "lelu" as const, room: { label: "Observatory" } };
  const ran = api().execute({ ...sameCall, approvalId: asked.approvalId });
  assert.equal(ran.ok, true, ran.message);
  assert.equal(nav().rooms().length, 1);
  assert.equal(nav().rooms()[0].origin, "lelu", "the map remembers she asked for it");

  const reused = api().execute({ ...sameCall, approvalId: asked.approvalId });
  assert.equal(reused.ok, false, "an approval is spent once");
  assert.equal(reused.requiresApproval, true);
  assert.equal(nav().rooms().length, 1);
});

test("a yellow action the user asks for does not wait, because the click is the consent", () => {
  seedMap();
  const made = api().execute({ action: "create-room", actor: "user", room: { label: "Reading nook" } });
  assert.equal(made.ok, true, made.message);
  assert.equal(nav().rooms()[0].label, "Reading nook");
  assert.equal(nav().rooms()[0].origin, "user");
});

test("protected ground is red even when the action name is ordinary", () => {
  const asked = api().execute({ action: "switch-project", actor: "user", projectId: "secrets/production" });
  assert.equal(asked.ok, false);
  assert.equal(asked.boundary, "red");
  assert.equal(asked.requiresApproval, true);
  assert.equal(api().activeProject, null, "the project did not change");
});

test("a red action never runs autonomously, and its approval does not smuggle it through", () => {
  const asked = api().execute({ action: "alter-database", actor: "lelu" });
  assert.equal(asked.ok, false);
  assert.equal(asked.boundary, "red");
  assert.equal(asked.requiresApproval, true);

  const gate = ApprovalGate.getInstance();
  gate.decide(asked.approvalId!, "approved");
  const stillRefused = api().execute({ action: "alter-database", actor: "lelu", approvalId: asked.approvalId });
  assert.equal(stillRefused.ok, false, "the API does not carry out protected actions at all");
  assert.match(stillRefused.message, /protected/);
});

test("navigating a room and placing a real record, then returning to the saved workspace", () => {
  seedMap();
  const made = nav().createRoom({ label: "Research", parentId: "exec-engineer", origin: "user" });
  assert.ok(made.ok);
  const roomId = made.ok ? made.node.id : "";

  const went = api().execute({ action: "navigate", actor: "lelu", roomId });
  assert.equal(went.ok, true, went.message);
  assert.equal(nav().current().id, roomId);

  const placed = api().execute({
    action: "place-object",
    actor: "lelu",
    roomId,
    object: { kind: "research", title: "Deep-sea vents", link: { kind: "task", id: "task-77" } },
  });
  assert.equal(placed.ok, true, placed.message);
  const object = SpatialObjects.getInstance().find({ kind: "task", id: "task-77" });
  assert.ok(object);
  assert.equal(object!.roomId, roomId, "it sits in the room that was current");

  const snapshot = api().snapshot();
  assert.equal(snapshot.roomId, roomId);
  assert.deepEqual(snapshot.roomPath, ["LÉLU CORE", "Engineering & Systems", "Research"]);
  assert.equal(snapshot.objects, 1);

  api().execute({ action: "navigate", actor: "user", roomId: "cosmos-core" });
  assert.equal(nav().current().id, "cosmos-core");
  const restored = api().restore();
  assert.equal(restored.ok, true);
  assert.equal(restored.roomId, roomId, "the room came back");
})

test("background work is visible and controllable through the same door", () => {
  const task = TaskEngine.getInstance().create({ goal: "Read three papers on tides", origin: "test" });
  const started = api().execute({ action: "run-task", actor: "user", taskId: task.id });
  assert.equal(started.ok, true, started.message);
  assert.equal(TaskEngine.getInstance().get(task.id)!.status, "running");

  const paused = api().execute({ action: "pause-task", actor: "user", taskId: task.id });
  assert.equal(paused.ok, true, paused.message);
  assert.equal(TaskEngine.getInstance().get(task.id)!.status, "paused");
  assert.ok(TaskEngine.getInstance().get(task.id)!.checkpoint, "pausing leaves a checkpoint");

  const resumed = api().execute({ action: "resume-task", actor: "user", taskId: task.id });
  assert.equal(resumed.ok, true);
  assert.equal(TaskEngine.getInstance().get(task.id)!.status, "running");

  const missing = api().execute({ action: "pause-task", actor: "user", taskId: "no-task" });
  assert.equal(missing.ok, false);
});

test("a verified extension publishes and an unverified one does not", () => {
  const draft = api().beginExtension("Add a window to the observatory", ["workspace view"], { views: 0 });
  const early = api().publishExtension(draft.id, "user");
  assert.equal(early.ok, false, "unverified is not published");

  api().verifyExtension(draft.id, () => true);
  const published = api().publishExtension(draft.id, "user");
  assert.equal(published.ok, true, published.message);
  assert.ok(api().extensions_().some((record) => record.id === draft.id && record.status === "published"));
});
