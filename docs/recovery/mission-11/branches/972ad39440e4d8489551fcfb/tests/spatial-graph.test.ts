/**
 * LÉLUVERSE — THE SEMANTIC SPATIAL GRAPH
 *
 * Objects are entities she can reason about, not just meshes: a generated
 * piece contains its parts, things standing together are near, stacked ones
 * are above/below, and meaning geometry cannot see (connected-to, controls,
 * linked worlds) is declared and persisted.
 *
 * These are the rules the world engine and renderer both rely on, tested
 * without a browser, a filesystem or Three.js.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  RELATIONSHIP_KINDS,
  buildSpatialGraph,
  describeGraphQuery,
  entityKey,
  linkProblem,
  pieceKey,
  queryGraph,
  worldKey,
  type DeclaredLink,
  type EntityInput,
  type RelationshipKind,
} from "../src/core/world/SpatialGraph";

const torso: EntityInput = { id: "torso", worldId: "atelier", name: "Copper torso", position: [0, -2.55, 0] };
const shoulderL: EntityInput = { id: "shoulder-l", worldId: "atelier", name: "Left shoulder", group: "exoskeleton", position: [-0.5, -2.1, 0] };
const shoulderR: EntityInput = { id: "shoulder-r", worldId: "atelier", name: "Right shoulder", group: "exoskeleton", position: [0.5, -2.1, 0] };
const copper: EntityInput = { id: "copper", worldId: "atelier", name: "Oxidized copper", position: [4, -2.55, 0] };
const lelu: EntityInput = { id: "lelu", worldId: "atelier", name: "LÉLU", kind: "avatar", position: [0, -2.55, 3.3] };

const entities = [lelu, torso, shoulderL, shoulderR, copper];

test("a generated piece is a container: parts are part-of it and it contains them", () => {
  const graph = buildSpatialGraph({ entities });
  const piece = pieceKey("atelier", "exoskeleton");
  assert.ok(graph.entities.has(piece), "the piece itself is an entity");
  assert.equal(graph.entities.get(piece)!.synthetic, true);

  const partOf = graph.edges.find((e) => e.from === entityKey("atelier", "shoulder-l") && e.to === piece);
  assert.ok(partOf, "the shoulder is part of the exoskeleton");
  assert.equal(partOf!.kind, "part-of");
  assert.equal(partOf!.source, "structure");

  const contains = graph.edges.find((e) => e.from === piece && e.to === entityKey("atelier", "shoulder-r"));
  assert.equal(contains?.kind, "contains");
});

test("she can answer \"show me everything connected to the left shoulder\" through the piece", () => {
  const graph = buildSpatialGraph({ entities });
  // Structural path only: part-of the piece, then the piece contains its sibling.
  // (They are also `near`, which is a separate, honest relationship.)
  const result = queryGraph(graph, { world: "atelier", entity: "shoulder-l", kinds: ["part-of", "contains"], depth: 2 });

  const sibling = result.hits.find((h) => h.entity.id === "shoulder-r");
  assert.ok(sibling, "the other shoulder is reachable");
  assert.equal(sibling!.depth, 2, "one hop to the piece, one to its sibling");
  assert.equal(sibling!.relation, "contains", "reached because the piece contains it");
  assert.ok(result.matchedEntityIds.includes("shoulder-r"));
  assert.doesNotMatch(result.description, /piece:/, "synthetic container ids never leak into what she says");
});

test("proximity and vertical order are inferred from where things stand", () => {
  const graph = buildSpatialGraph({ entities });
  assert.ok(
    graph.edges.some((e) => e.from === entityKey("atelier", "shoulder-l") && e.to === entityKey("atelier", "shoulder-r") && e.kind === "near"),
    "shoulders standing 1 unit apart are near",
  );
  const above = graph.edges.find((e) => e.from === entityKey("atelier", "shoulder-l") && e.to === entityKey("atelier", "torso"));
  assert.equal(above?.kind, "above", "the raised shoulder is above the torso");
  assert.equal(above?.source, "proximity");
  assert.ok(
    !graph.edges.some((e) => e.to === entityKey("atelier", "copper") && e.kind === "near"),
    "an object 4 units away is not near",
  );
});

test("declared links carry meaning geometry cannot, including between worlds", () => {
  const links: DeclaredLink[] = [
    { id: "lnk_1", fromWorld: "atelier", fromEntity: "torso", toWorld: "atelier", toEntity: "copper", kind: "depends-on" },
    { id: "lnk_2", fromWorld: "atelier", fromEntity: "*", toWorld: "laboratory", toEntity: "*", kind: "linked-to" },
  ];
  const graph = buildSpatialGraph({ entities: [...entities, { id: "rig", worldId: "laboratory", name: "Test rig", position: [0, -2.55, 0] }], links });

  const depends = graph.edges.find((e) => e.from === entityKey("atelier", "torso") && e.to === entityKey("atelier", "copper"));
  assert.equal(depends?.kind, "depends-on");
  assert.equal(depends?.source, "declared");

  const result = queryGraph(graph, { world: "atelier", entity: "*", kinds: ["linked-to"], depth: 1 });
  assert.ok(result.hits.some((h) => h.entity.worldId === "laboratory" && h.entity.id === "*"), "Atelier reaches Laboratory");
  assert.match(result.description, /laboratory/);
});

test("a stale link is ignored rather than breaking the graph", () => {
  const graph = buildSpatialGraph({
    entities,
    links: [{ id: "lnk_gone", fromWorld: "atelier", fromEntity: "deleted", toWorld: "atelier", toEntity: "torso", kind: "connected-to" }],
  });
  assert.ok(!graph.edges.some((e) => e.source === "declared"));
  assert.equal(graph.entities.size, 7, "world + 5 entities + the exoskeleton piece");
});

test("the same placement id in two worlds stays two entities", () => {
  const graph = buildSpatialGraph({
    entities: [
      { id: "torso", worldId: "atelier", name: "Copper torso", position: [0, 0, 0] },
      { id: "torso", worldId: "laboratory", name: "Copper torso (test copy)", position: [0, 0, 0] },
    ],
  });
  assert.ok(graph.entities.has(entityKey("atelier", "torso")));
  assert.ok(graph.entities.has(entityKey("laboratory", "torso")));
  assert.equal(graph.entities.size, 4, "two worlds + two entities");
  assert.ok(!graph.edges.some((e) => e.kind === "near"), "entities in different worlds are never near");
});

test("queries can filter by name, relationship and size", () => {
  const graph = buildSpatialGraph({ entities });
  const byName = queryGraph(graph, { world: "atelier", name: "shoulder", depth: 2 });
  assert.ok(byName.hits.every((h) => h.entity.name.toLowerCase().includes("shoulder")));
  assert.equal(byName.hits.length, 2);

  const onlyNear = queryGraph(graph, { world: "atelier", entity: "shoulder-l", kinds: ["near"], depth: 1 });
  assert.deepEqual(onlyNear.hits.filter((h) => h.depth === 1).map((h) => h.entity.id), ["shoulder-r"]);

  const capped = queryGraph(graph, { world: "atelier", depth: 2, limit: 1 });
  assert.equal(capped.hits.length, 1);
  assert.equal(capped.truncated, true);
});

test("nothing connected is said plainly, not as an empty list", () => {
  const graph = buildSpatialGraph({ entities });
  const result = queryGraph(graph, { world: "atelier", entity: "copper", depth: 1, kinds: ["controls"] });
  assert.match(result.description, /Nothing is connected to Oxidized copper in atelier/);
  assert.deepEqual(result.matchedEntityIds, []);
});

test("declared links must point at things that exist", () => {
  const context = {
    worlds: new Set(["atelier", "laboratory"]),
    entities: new Map([
      ["atelier", new Set(["*", "lelu", "torso"])],
      ["laboratory", new Set(["*", "lelu"])],
    ]),
    existing: [] as DeclaredLink[],
  };
  const base = { fromWorld: "atelier", fromEntity: "torso", toWorld: "atelier", toEntity: "lelu", kind: "controls" as RelationshipKind };

  assert.equal(linkProblem(base, context), null);
  assert.match(linkProblem({ ...base, kind: "vibes" as RelationshipKind }, context)!, /kind must be one of/);
  assert.match(linkProblem({ ...base, fromWorld: "nowhere" }, context)!, /No world "nowhere"/);
  assert.match(linkProblem({ ...base, toEntity: "ghost" }, context)!, /No entity "ghost" in atelier/);
  assert.match(linkProblem({ ...base, toEntity: "torso" }, context)!, /cannot be linked to itself/);
  assert.match(linkProblem({ ...base, fromEntity: "*", toEntity: "*" }, context)!, /cannot be linked to itself/);
  assert.match(
    linkProblem(base, { ...context, existing: [{ id: "lnk_x", ...base }] })!,
    /already exists \(lnk_x\)/,
  );
  assert.ok(RELATIONSHIP_KINDS.includes("linked-to"));
});

test("the description names the subject and the distance to each hit", () => {
  const graph = buildSpatialGraph({ entities });
  const result = queryGraph(graph, { world: "atelier", entity: "shoulder-l", depth: 2 });
  assert.equal(
    describeGraphQuery(graph, { world: "atelier", entity: "shoulder-l", depth: 2 }, result),
    result.description,
    "the description is stable for the same query",
  );
  assert.match(result.description, /^Left shoulder in atelier: /);
  assert.match(result.description, /1 hop|2 hops/);
});
