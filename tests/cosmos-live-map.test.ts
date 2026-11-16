/**
 * The map must be the live LÉLUVERSE: galaxies, agent planets, projects,
 * open views and rooms — with stable ids, no duplicates on re-sync, renames
 * that keep history, and removals that are reversible.
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
import {
  MAP_ID,
  applyCosmosSnapshot,
  buildCosmosDestinations,
  isMapOwned,
  type LiveCosmosSnapshot,
} from "../src/core/cosmos/CosmosLiveMap";

function snapshot(): LiveCosmosSnapshot {
  return {
    includeShaman: true,
    galaxies: [
      {
        id: "exec-engineer",
        name: "ENGINEER",
        execType: "engineer",
        position: [16, -10, -3],
        agents: [
          { id: "agent-1", name: "Forge", position: [18, -9, -1] },
          { id: "agent-2", name: "Surveyor", position: [14, -12, -2] },
        ],
      },
      {
        id: "exec-sage",
        name: "SAGE",
        execType: "sage",
        position: [12, 10, 6],
        agents: [],
      },
    ],
    projects: [{ id: "proj-1", name: "LÉLUVERSE", status: "active" }],
    views: [{ id: "view-1", title: "Research brief", kind: "file" }],
  };
}

test("the map is built from live galaxies, agents, projects, views and shaman", () => {
  const destinations = buildCosmosDestinations(snapshot());
  const ids = destinations.map((destination) => destination.id);

  assert.ok(ids.includes(MAP_ID.galaxy("engineer")));
  assert.ok(ids.includes(MAP_ID.agent("agent-1")));
  assert.ok(ids.includes(MAP_ID.project("proj-1")));
  assert.ok(ids.includes(MAP_ID.view("view-1")));
  assert.ok(ids.includes(MAP_ID.shaman));

  const agent = destinations.find((destination) => destination.id === MAP_ID.agent("agent-1"));
  assert.equal(agent?.parentId, MAP_ID.galaxy("engineer"), "an agent planet hangs under its own galaxy");
  assert.deepEqual(agent?.ref, { kind: "agent", id: "agent-1" });
  assert.equal(agent?.removable, false, "a live record's destination follows its source");

  const project = destinations.find((destination) => destination.id === MAP_ID.project("proj-1"));
  assert.deepEqual(project?.opens, { module: "workspace", projectId: "proj-1" });

  const galaxy = destinations.find((destination) => destination.id === MAP_ID.galaxy("engineer"));
  assert.deepEqual(galaxy?.position, [16, -10, -3], "the ring sits where the renderer draws the galaxy");
});

test("re-syncing creates no duplicates and keeps visits", () => {
  CosmosNavigation.reset();
  const nav = CosmosNavigation.getInstance();
  nav.registerAll(buildCosmosDestinations(snapshot()));
  const before = nav.getState().nodes.length;

  nav.navigateTo(MAP_ID.agent("agent-1"));
  nav.navigateTo(MAP_ID.agent("agent-1"));
  assert.equal(nav.get(MAP_ID.agent("agent-1"))?.visits, 2);

  nav.registerAll(buildCosmosDestinations(snapshot()));
  nav.registerAll(buildCosmosDestinations(snapshot()));

  assert.equal(nav.getState().nodes.length, before, "the same live state produces the same map");
  assert.equal(nav.get(MAP_ID.agent("agent-1"))?.visits, 2, "history survives a re-sync");
});

test("a runtime rename updates the label without losing its history", () => {
  CosmosNavigation.reset();
  const nav = CosmosNavigation.getInstance();
  nav.registerAll(buildCosmosDestinations(snapshot()));
  nav.navigateTo(MAP_ID.agent("agent-2"));

  const renamed = snapshot();
  renamed.galaxies[0].agents[1].name = "Cartographer";
  nav.registerAll(buildCosmosDestinations(renamed));

  const node = nav.get(MAP_ID.agent("agent-2"));
  assert.equal(node?.label, "Cartographer");
  assert.equal(node?.visits, 1);
  assert.equal(
    nav.getState().nodes.filter((entry) => entry.id === MAP_ID.agent("agent-2")).length,
    1,
    "a rename is not a second destination",
  );
});

test("destinations that left the runtime are retired, never deleted", () => {
  CosmosNavigation.reset();
  const nav = CosmosNavigation.getInstance();
  nav.registerAll(buildCosmosDestinations(snapshot()));
  nav.navigateTo(MAP_ID.agent("agent-2"));

  const shrunk = snapshot();
  shrunk.galaxies[0].agents = shrunk.galaxies[0].agents.filter((agent) => agent.id !== "agent-2");
  const synced = applyCosmosSnapshot(shrunk);
  assert.equal(synced.retired, 1, "exactly the vanished destination is retired");

  const retired = nav.get(MAP_ID.agent("agent-2"));
  assert.ok(retired, "the node is kept");
  assert.equal(retired?.archived, true, "and archived rather than destroyed");
  assert.equal(
    nav.getState().currentId,
    MAP_ID.galaxy("engineer"),
    "being somewhere retired moves you up to its parent, not into nothing",
  );
  assert.equal(nav.retire(MAP_ID.agent("agent-2")), false, "retiring twice is not a change");
});

test("only the map's own destinations may be retired", () => {
  CosmosNavigation.reset();
  const nav = CosmosNavigation.getInstance();
  nav.registerAll(buildCosmosDestinations(snapshot()));

  const room = nav.createRoom({ label: "Reading nook" });
  assert.ok(room.ok);
  if (!room.ok) return;

  assert.equal(nav.retire(room.node.id), false, "a room the user made is not the map's to retire");
  assert.equal(nav.retire(COSMOS_CORE_ID), false, "the core cannot be retired");

  assert.equal(nav.retire(MAP_ID.project("proj-1")), true);
  assert.equal(nav.get(MAP_ID.project("proj-1"))?.archived, true);
});

test("a removed room can be restored, with its identity intact", () => {
  CosmosNavigation.reset();
  const nav = CosmosNavigation.getInstance();
  const room = nav.createRoom({ label: "Lab" });
  assert.ok(room.ok);
  if (!room.ok) return;

  nav.navigateTo(room.node.id);
  const removed = nav.removeRoom(room.node.id);
  assert.ok(removed.ok);
  assert.equal(nav.getState().currentId, COSMOS_CORE_ID);
  assert.equal(nav.archivedRooms().some((entry) => entry.id === room.node.id), true);

  const restored = nav.restoreRoom(room.node.id);
  assert.ok(restored.ok);
  assert.equal(nav.get(room.node.id)?.archived, false);
  assert.equal(nav.get(room.node.id)?.visits, 1, "restoring a room restores its history");
});

test("map ownership is limited to ids the synchroniser can recreate", () => {
  assert.equal(isMapOwned(MAP_ID.agent("agent-1")), true);
  assert.equal(isMapOwned(MAP_ID.galaxy("engineer")), true);
  assert.equal(isMapOwned("room-abc123"), false);
  assert.equal(isMapOwned(COSMOS_CORE_ID), false);
});
