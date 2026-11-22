/**
 * M22.12 WP05 — a reload from a live-map destination (an agent's planet,
 * a project, an open view) comes back to that destination once the live
 * map re-registers it, through CosmosNavigation's own KvStore record.
 * Nothing new is persisted: the same `lelu.cosmos.nav.v1` payload, read
 * the same way, waits for ids it does not know yet instead of dropping them.
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

import CosmosNavigation, { COSMOS_CORE_ID } from "../src/core/cosmos/CosmosNavigation";
import { MAP_ID, applyCosmosSnapshot, type LiveCosmosSnapshot } from "../src/core/cosmos/CosmosLiveMap";

function snapshot(agents = [{ id: "agent-1", name: "Forge", position: [18, -9, -1] as [number, number, number] }]): LiveCosmosSnapshot {
  return {
    includeShaman: true,
    galaxies: [{ id: "exec-engineer", name: "ENGINEER", execType: "engineer", position: [16, -10, -3], agents }],
    projects: [{ id: "proj-1", name: "LÉLUVERSE", status: "active" }],
    views: [],
  };
}

/** A page reload: the singleton goes, storage stays. */
function reload(): CosmosNavigation {
  CosmosNavigation.getInstance().destroy();
  return CosmosNavigation.getInstance();
}

const PLANET = MAP_ID.agent("agent-1");

test("a reload from a planet restores the planet once the live map syncs", () => {
  CosmosNavigation.reset();
  applyCosmosSnapshot(snapshot());
  const before = CosmosNavigation.getInstance();
  assert.ok(before.navigateTo(MAP_ID.galaxy("engineer")));
  assert.ok(before.navigateTo(PLANET));
  const visits = before.get(PLANET)!.visits;

  const nav = reload();
  // At boot the planet is not registered yet: you are at the core, waiting.
  assert.equal(nav.getState().currentId, COSMOS_CORE_ID);
  assert.equal(nav.pendingRestore(), PLANET);

  applyCosmosSnapshot(snapshot());
  const state = nav.getState();
  assert.equal(state.currentId, PLANET, "the planet is the current place again");
  assert.equal(nav.pendingRestore(), null);
  assert.deepEqual(state.trail, [COSMOS_CORE_ID, MAP_ID.galaxy("engineer"), PLANET], "the trail comes back in order");
  assert.equal(nav.get(PLANET)!.visits, visits, "visit counts survive the reload");
  assert.equal(nav.restoredArrival(), PLANET, "the scene is told, to frame it");
  assert.equal(nav.restoredArrival(), PLANET, "reading does not consume it (a scene may mount twice)");
  nav.restoredArrivalFramed(PLANET);
  assert.equal(nav.restoredArrival(), null, "once framed it is an ordinary place");
});

test("an early write before the sync does not erase the stored destination", () => {
  CosmosNavigation.reset();
  applyCosmosSnapshot(snapshot());
  CosmosNavigation.getInstance().navigateTo(PLANET);

  const nav = reload();
  nav.createRoom({ label: "Scratch" }); // persists while the planet is pending
  const again = reload();
  assert.equal(again.pendingRestore(), PLANET, "storage still names the planet");
  applyCosmosSnapshot(snapshot());
  assert.equal(again.getState().currentId, PLANET);
});

test("a destination that no longer exists fails safely to the core", () => {
  CosmosNavigation.reset();
  applyCosmosSnapshot(snapshot());
  CosmosNavigation.getInstance().navigateTo(PLANET);

  const nav = reload();
  applyCosmosSnapshot(snapshot([])); // the agent is gone
  assert.equal(nav.getState().currentId, COSMOS_CORE_ID);
  assert.equal(nav.pendingRestore(), null, "the sync settles the restore");
  assert.equal(nav.restoredArrival(), null);
  assert.ok(nav.getState().trail.every((id) => nav.get(id)), "the trail names only places that exist");

  const after = reload();
  assert.equal(after.pendingRestore(), null, "storage stops naming an unreachable place");
});

test("navigating before the sync wins over the pending restore", () => {
  CosmosNavigation.reset();
  applyCosmosSnapshot(snapshot());
  const first = CosmosNavigation.getInstance();
  const room = first.createRoom({ label: "Studio" });
  assert.ok(room.ok);
  first.navigateTo(PLANET);

  const nav = reload();
  assert.ok(nav.navigateTo(room.ok ? room.node.id : ""));
  applyCosmosSnapshot(snapshot());
  assert.equal(nav.getState().currentId, room.ok ? room.node.id : "", "the newer choice is kept");
  assert.equal(nav.restoredArrival(), null);
});

test("unknown non-map ids in storage are still ignored", () => {
  CosmosNavigation.reset();
  memory.set(
    "lelu.cosmos.nav.v1",
    JSON.stringify({ rooms: [], visits: {}, currentId: "ghost-node", trail: ["ghost-node"] }),
  );
  const nav = reload();
  assert.equal(nav.getState().currentId, COSMOS_CORE_ID);
  assert.equal(nav.pendingRestore(), null);
  assert.deepEqual(nav.getState().trail, []);
});

test("a persisted room is restored at boot and handed to the scene to frame", () => {
  CosmosNavigation.reset();
  const nav0 = CosmosNavigation.getInstance();
  const room = nav0.createRoom({ label: "Library" });
  assert.ok(room.ok);
  nav0.navigateTo(room.ok ? room.node.id : "");
  const nav = reload();
  assert.equal(nav.getState().currentId, room.ok ? room.node.id : "");
  assert.equal(nav.restoredArrival(), room.ok ? room.node.id : "");
});
