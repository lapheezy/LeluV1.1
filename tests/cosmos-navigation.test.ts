/**
 * ==========================================================
 * LÉLU — COSMOS NAVIGATION, SPATIAL OBJECTS, BOUNDARIES
 *
 * CATEGORY: unit. No model, no network, no browser: the real
 * stores with the storage shim the rest of the suite uses.
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

import CosmosNavigation, { childPosition } from "../src/core/cosmos/CosmosNavigation";
import SpatialObjects from "../src/core/cosmos/SpatialObjects";
import { ExtensionJournal, classifyCosmosAction, isProtectedTarget } from "../src/core/cosmos/CosmosAutonomy";
import KvStore from "../src/core/storage/KvStore";

beforeEach(() => {
  CosmosNavigation.reset();
  SpatialObjects.reset();
});

function seedMap() {
  const nav = CosmosNavigation.getInstance();
  nav.registerAll([
    { id: "cosmos-core", level: "core", label: "LÉLU CORE", parentId: null },
    { id: "exec-engineer", level: "galaxy", label: "Engineering & Systems", parentId: "cosmos-core", ref: { kind: "cosmos", id: "exec-engineer" } },
    { id: "agent-kernel", level: "planet", label: "Kernel", parentId: "exec-engineer", ref: { kind: "agent", id: "agent-kernel" } },
  ]);
  return nav;
}

test("the map starts at the core, and registering a destination is idempotent", () => {
  const nav = seedMap();
  const first = nav.getState().nodes.length;
  assert.equal(nav.current().id, "cosmos-core");
  assert.equal(first, 3);

  nav.navigateTo("agent-kernel");
  nav.register({ id: "agent-kernel", level: "planet", label: "Kernel (renamed)", parentId: "exec-engineer" });

  const nodes = nav.getState().nodes;
  assert.equal(nodes.length, first, "re-registering does not duplicate");
  const kernel = nodes.find((node) => node.id === "agent-kernel")!;
  assert.equal(kernel.label, "Kernel (renamed)", "the runtime can correct a name");
  assert.equal(kernel.visits, 1, "and the visit count survives the correction");
});

test("travel records the trail once per place, not once per visit", () => {
  const nav = seedMap();
  nav.navigateTo("exec-engineer");
  nav.navigateTo("agent-kernel");
  nav.navigateTo("agent-kernel");
  nav.navigateTo("exec-engineer");

  const state = nav.getState();
  assert.deepEqual(state.trail, ["cosmos-core", "agent-kernel", "exec-engineer"]);
  assert.equal(nav.get("agent-kernel")!.visits, 2);
  assert.ok(nav.get("agent-kernel")!.lastVisited);
  assert.equal(nav.back()!.id, "agent-kernel", "back is the previous place in the trail");
  assert.equal(nav.navigateTo("nowhere"), null, "an unknown destination does not move you");
});

test("a room hangs under its parent and the breadcrumb runs root → room", () => {
  const nav = seedMap();
  const made = nav.createRoom({ label: "Research nook", parentId: "exec-engineer", origin: "user", opens: { module: "browser" } });
  assert.ok(made.ok && made.created);
  const room = made.ok ? made.node : null;
  assert.ok(room);
  assert.equal(room!.level, "room");
  assert.equal(room!.removable, true);
  assert.deepEqual(nav.pathTo(room!.id).map((node) => node.id), ["cosmos-core", "exec-engineer", room!.id]);
  assert.equal(nav.children("exec-engineer").filter((node) => node.level === "room").length, 1);

  const again = nav.createRoom({ label: "research NOOK", parentId: "exec-engineer" });
  assert.ok(again.ok);
  assert.equal(again.ok && again.created, false, "the same name under the same parent is the same room");
  assert.equal(again.ok && again.node.id, room!.id);
  assert.equal(nav.createRoom({ label: "   " }).ok, false, "a room needs a name");
  assert.equal(nav.createRoom({ label: "orphan", parentId: "no-such-place" }).ok, false);
});

test("removing a room is reversible; part of the environment is not removable", () => {
  const nav = seedMap();
  const made = nav.createRoom({ label: "Scratch", parentId: "agent-kernel" });
  assert.ok(made.ok);
  const id = made.ok ? made.node.id : "";
  nav.navigateTo(id);

  const removed = nav.removeRoom(id);
  assert.ok(removed.ok);
  assert.ok(!nav.getState().nodes.some((node) => node.id === id), "it is gone from the map");
  assert.equal(nav.current().id, "agent-kernel", "you are returned to its parent");

  const restored = nav.restoreRoom(id);
  assert.ok(restored.ok);
  assert.ok(nav.getState().nodes.some((node) => node.id === id), "and comes back as it was");

  assert.equal(nav.removeRoom("exec-engineer").ok, false, "a galaxy is not a room");
  assert.equal(nav.removeRoom("ghost").ok, false);
});

test("the map survives a restart: rooms and visits are read back from storage", () => {
  const nav = seedMap();
  const made = nav.createRoom({ label: "Persisted room", parentId: "exec-engineer", origin: "user" });
  assert.ok(made.ok);
  const id = made.ok ? made.node.id : "";
  nav.navigateTo(id);
  nav.navigateTo("agent-kernel");

  const stored = KvStore.getInstance().get<{ rooms: Array<{ id: string }>; visits: Record<string, { visits: number }> }>("lelu.cosmos.nav.v1");
  assert.ok(stored);
  assert.ok(stored!.rooms.some((room) => room.id === id), "the room is written down");
  assert.equal(stored!.visits[id].visits, 1, "so is its visit");

  nav.reload();
  const reloaded = nav.get(id);
  assert.ok(reloaded, "the room is still there");
  assert.equal(reloaded!.visits, 1);
});

test("a spatial object is a pointer to a real record, never a copy", () => {
  const objects = SpatialObjects.getInstance();
  const missing = objects.place({ kind: "message", title: "Reply", link: { kind: "", id: "" } });
  assert.equal(missing.ok, false, "without a record there is no object");

  const placed = objects.place({
    kind: "message",
    title: "Her reply about the cosmos",
    link: { kind: "conversation", id: "conv-1" },
    roomId: "room-a",
  });
  assert.ok(placed.ok);
  assert.equal(placed.ok && placed.duplicate, false);
  const object = placed.ok ? placed.object : null;
  assert.deepEqual(object!.link, { kind: "conversation", id: "conv-1" });

  const again = objects.place({ kind: "message", title: "Her reply (edited)", link: { kind: "conversation", id: "conv-1" }, roomId: "room-b" });
  assert.ok(again.ok && again.duplicate);
  assert.equal(objects.list().length, 1, "the same record cannot be in two places");
  assert.equal(objects.list()[0].title, "Her reply (edited)");
  assert.equal(objects.list()[0].roomId, "room-a", "an update never teleports it");

  objects.move(object!.id, [2, 0, 1], "room-b");
  objects.pin(object!.id);
  assert.deepEqual(objects.inRoom("room-b")[0].position, [2, 0, 1]);
  assert.equal(objects.inRoom("room-b")[0].pinned, true);
  assert.equal(objects.find({ kind: "conversation", id: "conv-1" })!.id, object!.id);
  assert.equal(objects.remove(object!.id), true);
  assert.equal(objects.remove(object!.id), false);
});

test("positions are deterministic, so a room lays out the same way twice", () => {
  const a = childPosition([0, 0, 0], 0);
  const b = childPosition([0, 0, 0], 0);
  const c = childPosition([0, 0, 0], 1);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("GREEN, YELLOW, RED: what she may do alone and what waits for a person", () => {
  const navigate = classifyCosmosAction("navigate", "lelu");
  assert.equal(navigate.boundary, "green");
  assert.equal(navigate.allowed, true);
  assert.equal(navigate.requiresApproval, false);

  const room = classifyCosmosAction("create-room", "lelu");
  assert.equal(room.boundary, "yellow");
  assert.equal(room.requiresApproval, true, "LÉLU's own expansion waits for approval");
  assert.equal(classifyCosmosAction("create-room", "user").requiresApproval, false, "the user's click IS the approval");

  const database = classifyCosmosAction("alter-database", "lelu");
  assert.equal(database.boundary, "red");
  assert.equal(database.allowed, false, "never autonomous");
  assert.equal(database.requiresApproval, true);

  const deploy = classifyCosmosAction("deploy", "user");
  assert.equal(deploy.boundary, "red");
  assert.equal(deploy.requiresApproval, true, "even when a person asks, red is confirmed");

  assert.equal(classifyCosmosAction("nonsense" as never).boundary, "red", "an unknown action fails closed");
});

test("protected ground is recognised wherever it appears", () => {
  for (const target of [".env.local", "src/core/auth/session.ts", "supabase/migrations/001.sql", "secrets.json", "wrangler.toml"]) {
    assert.equal(isProtectedTarget(target).protected, true, target);
  }
  for (const target of ["src/app/scene/genesis/chat/ChatTranscript.tsx", "room-4921", "src/core/cosmos/CosmosNavigation.ts"]) {
    assert.equal(isProtectedTarget(target).protected, false, target);
  }
});

test("an extension cannot be published before it is verified, and a draft rolls back", () => {
  const journal = new ExtensionJournal(() => { /* no persistence in this check */ });
  const draft = journal.begin({ label: "Observatory room", applies: ["add room", "add a window"], snapshot: { rooms: 0 } });
  assert.equal(journal.publish(draft.id).ok, false, "unverified is not published");

  assert.equal(journal.verify(draft.id, () => false), false, "a failed check is not a verification");
  assert.equal(journal.publish(draft.id).ok, false);

  const good = journal.begin({ label: "Observatory room", applies: ["add room"], snapshot: { rooms: 0 } });
  assert.equal(journal.verify(good.id, () => true), true);
  assert.equal(journal.publish(good.id).ok, true);
  assert.ok(journal.list().some((record) => record.id === good.id && record.status === "published"));

  const rolled = journal.begin({ label: "Wild idea", applies: ["move everything"], snapshot: { rooms: 1 } });
  const back = journal.rollback(rolled.id);
  assert.ok(back.ok && back.snapshot);
  assert.deepEqual(back.ok && back.snapshot, { rooms: 1 }, "rollback hands back the checkpoint");
  assert.equal(journal.rollback("nope").ok, false);
});
