/**
 * M17.2-WP02 — the Neural Map over the authorities behind the other
 * interfaces: conversations (Chat Universe), artifacts (Creation Studio /
 * Creative Kit), projects, the Code sandbox and the Home's catalog.
 *
 * Real stores where they can run isolated (StudioStore, SandboxFS);
 * conversation and project records shaped exactly as their stores keep
 * them. These prove the adapter RULES; the running interfaces are checked
 * by scripts/cosmos/verify-neural-embedded.mjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import StudioStore from "../src/core/studio/StudioStore";
import SandboxFS from "../src/core/engineering/SandboxFS";
import { NeuralMapIndex } from "../src/core/neural/NeuralMap";
import {
  artifactsPartition,
  capabilitiesPartition,
  conversationsPartition,
  cosmosObjectsPartition,
  homePartition,
  interfacesPartition,
  navigationPartition,
  projectsPartition,
  sandboxPartition,
} from "../src/core/neural/adapters";
import { NID } from "../src/core/neural/NeuralMapTypes";
import { INTERFACES } from "../src/core/interface/InterfaceCatalog";
import type { ChatConversation } from "../src/core/multichat/MultiChatStore";
import type { LeluProject } from "../src/core/projects/ProjectStore";

const chat = (id: string, extra: Partial<ChatConversation> = {}): ChatConversation => ({
  id,
  title: `Chat ${id}`,
  messages: [{ id: `${id}-m1`, role: "user", text: "hello", timestamp: 1, source: "local" }],
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
  archived: false,
  linkedIds: [],
  projectId: null,
  tags: [],
  topic: "",
  unread: 0,
  processing: false,
  ...extra,
});

const project = (id: string, name: string): LeluProject => ({ id, name, description: "", status: "active", agentIds: [], items: [], createdAt: 1, updatedAt: 1 });

/** The Cosmos core (CosmosNavigation's root): objects and the Cosmos interface point at it. */
const withCore = (map: NeuralMapIndex) =>
  map.setPartition(navigationPartition([{ id: "cosmos-core", level: "core", label: "Cosmos", parentId: null, ref: null, opens: null, position: [0, 0, 0], origin: "system", createdAt: 0, visits: 0, lastVisited: null, removable: false, archived: false } as never]));

const rels = (map: NeuralMapIndex, id: string, dir: "out" | "in" = "out") =>
  map.relations(id, { direction: dir }).map((n) => `${n.relation.type}>${dir === "out" ? n.relation.to : n.relation.from}`).sort();

test("conversations: canonical record ids, links, merges and project membership read from the chat itself", () => {
  const map = new NeuralMapIndex();
  const merged = chat("c3", {
    title: "Merged",
    messages: [
      { id: "a", role: "user", text: "x", timestamp: 1, source: "local", origin: { conversationId: "c1", title: "Chat c1" } },
      { id: "b", role: "user", text: "y", timestamp: 2, source: "local", origin: { conversationId: "c2", title: "Chat c2" } },
    ],
    linkedIds: ["c1"],
    projectId: "p1",
  });
  map.setPartition(conversationsPartition([chat("c1"), chat("c2", { archived: true }), merged]));
  const e = map.get(NID.conversation("c3"))!;
  assert.equal(e.id, "record:conversation:c3");
  assert.equal(e.type, "conversation");
  assert.equal(e.authority, "chats");
  assert.equal(map.get(NID.conversation("c2"))!.state, "archived");
  assert.deepEqual(rels(map, e.id), ["connected-to>record:conversation:c1", "created-from>record:conversation:c1", "created-from>record:conversation:c2", "part-of>record:project:p1"]);
  // The project is not indexed yet: it is a referenced record, so nothing dangles.
  assert.equal(map.get(NID.project("p1"))!.authority, "referenced");
  assert.equal(map.dangling().length, 0);
  // …and once the projects authority is connected, the SAME id is owned by it.
  map.setPartition(projectsPartition([project("p1", "Hoodie store")]));
  assert.equal(map.get(NID.project("p1"))!.authority, "projects");
  assert.equal(map.get(NID.project("p1"))!.label, "Hoodie store");
  assert.deepEqual(rels(map, NID.project("p1"), "in"), ["part-of>record:conversation:c3"]);
  assert.equal(map.duplicates().length, 0);
});

test("artifacts: a real StudioStore artifact is ONE entity for the Studio, its chat and the Cosmos object made from it", () => {
  const studio = StudioStore.createIsolated();
  const made = studio.create({ kind: "document", title: "Launch plan", blocks: [{ type: "paragraph", text: "hi" }] }, { by: "user", conversationId: "c1" });
  assert.ok(made.ok);
  const art = made.artifact;
  const revised = studio.revise(art.id, { ops: [{ op: "set_title", title: "Launch plan v2" } as never], note: "retitle" });
  const map = new NeuralMapIndex();
  withCore(map);
  map.setPartition(conversationsPartition([chat("c1")]));
  map.setPartition(artifactsPartition(studio.list()));
  // A Cosmos object built from the same artifact points at the same canonical id.
  map.setPartition(cosmosObjectsPartition({ objects: [{ id: "obj_1", name: "Plan board", provenance: [], frame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, parent: null, group: null, visible: true, locked: false, domain: "x", builder: "x", partCount: 1, place: "cosmos", motion: { kind: "still" }, source: { artifactId: art.id, rev: 1 }, updatedAt: 1 } as never], trash: [], groups: {} }));
  const e = map.get(NID.artifact(art.id))!;
  assert.equal(e.authority, "studio", "the owner wins over the Cosmos's reference");
  assert.equal(e.type, "artifact");
  assert.ok(e.operations.includes("studio.open"));
  assert.ok(e.provenance.some((p) => p.action === "created"));
  if (revised.ok) assert.ok(e.provenance.some((p) => p.action === "revised"), "every revision is history");
  assert.deepEqual(rels(map, e.id), ["created-from>record:conversation:c1"]);
  assert.deepEqual(rels(map, e.id, "in"), ["created-from>cosmos.object:obj_1"]);
  assert.equal(map.dangling().length, 0);
  assert.equal(map.duplicates().length, 0);
});

test("the Code sandbox: real SandboxFS writes notify, and files are part of their folders", () => {
  const fs = SandboxFS.getInstance();
  fs.reset();
  let notified = 0;
  const stop = fs.subscribe(() => (notified += 1));
  const map = new NeuralMapIndex();
  const sync = () => map.setPartition(sandboxPartition(fs.list()));
  fs.write("projects/shop/src/app.js", "export const a = 1;\n");
  fs.write("projects/shop/README.md", "# shop\n");
  sync();
  assert.ok(notified >= 2, "every write tells its subscribers");
  const file = map.get(NID.sandbox("projects/shop/src/app.js"))!;
  assert.equal(file.type, "file");
  assert.deepEqual(file.operations, ["sandbox.read", "sandbox.write"]);
  assert.deepEqual(rels(map, file.id), ["part-of>sandbox:projects/shop/src"]);
  assert.deepEqual(rels(map, "sandbox:projects/shop/src"), ["part-of>sandbox:projects/shop"]);
  assert.equal(map.get("sandbox:projects/shop")!.type, "folder");
  fs.remove("projects/shop/README.md");
  const u = sync();
  assert.ok(u.changed.includes(NID.sandbox("projects/shop/README.md")), "a removed file leaves the map");
  assert.equal(map.get(NID.sandbox("projects/shop/README.md")), undefined);
  stop();
  fs.reset();
});

test("the Home: itself, its apps and its destinations; app tools resolve to real capabilities", () => {
  const map = new NeuralMapIndex();
  withCore(map);
  map.setPartition(interfacesPartition(INTERFACES, []));
  map.setPartition(capabilitiesPartition([{ id: "sandbox.read", name: "Read sandbox", category: "x", riskLevel: 0, permissions: ["READ"], available: true } as never]));
  map.setPartition(
    homePartition(
      [
        { id: "engineering", label: "Code", hint: "", group: "development", operations: ["sandbox.read"] },
        { id: "genesisv2", label: "LÉLU's Room", hint: "", group: "system" },
      ],
      INTERFACES.map((i) => i.id),
      { genesisv2: "lelu-room" },
    ),
  );
  const home = rels(map, NID.app("home"));
  assert.ok(home.includes("presents>app:engineering"));
  for (const i of INTERFACES) assert.ok(home.includes(`presents>interface:${i.id}`), `the Home leads to ${i.id}`);
  assert.deepEqual(rels(map, NID.app("genesisv2")), ["presents>interface:lelu-room"]);
  assert.deepEqual(rels(map, NID.app("engineering")), ["operated-by>capability:sandbox.read"]);
  assert.equal(map.dangling().length, 0);
});

test("incremental: one authority's change updates only its partition, and re-deriving is identical (reload)", () => {
  const studio = StudioStore.createIsolated();
  const map = new NeuralMapIndex();
  map.setPartition(conversationsPartition([chat("c1")]));
  map.setPartition(projectsPartition([project("p1", "P")]));
  map.setPartition(artifactsPartition(studio.list()));
  const before = map.stats();
  const made = studio.create({ kind: "deck", title: "Deck", slides: [{ title: "Deck", layout: "title" }] }, { by: "user" });
  assert.ok(made.ok);
  const u = map.setPartition(artifactsPartition(studio.list()));
  assert.equal(u.authority, "studio");
  assert.deepEqual(u.changed, [NID.artifact(made.artifact.id)], "only the new artifact changed");
  assert.equal(map.stats().byAuthority.chats.entities, before.byAuthority.chats.entities);
  // Reload: a fresh index from the same state has the same ids and relations.
  const again = new NeuralMapIndex();
  again.setPartition(conversationsPartition([chat("c1")]));
  again.setPartition(projectsPartition([project("p1", "P")]));
  again.setPartition(artifactsPartition(studio.list()));
  assert.deepEqual(again.all().map((e) => e.id).sort(), map.all().map((e) => e.id).sort());
  assert.equal(again.stats().relations, map.stats().relations);
});

test("subscriptions: views subscribe and unsubscribe cleanly (no leak when an interface closes)", () => {
  const map = new NeuralMapIndex();
  const stops = Array.from({ length: 5 }, () => map.subscribe(() => {}));
  assert.equal(map.listenerCount(), 5);
  for (const stop of stops) stop();
  assert.equal(map.listenerCount(), 0);
});
