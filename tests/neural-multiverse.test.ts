/**
 * Neural Map Multiverse — shared layouts, the three aspects, saved views.
 *
 * Layouts: every one of the twelve places every node, inside the box,
 * the same way twice. Aspects: V1 is the canonical index as is; V2's
 * subsystems are real src/core directories and its import edges are
 * real; V3 draws only executives and persisted agents with their real
 * delegations, and says what it cannot show. Saved views store
 * presentation only and survive a reload.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LAYOUTS, layout, depthsFrom } from "../src/core/neural/multiverse/Layouts";
import { v1Graph, v2Graph, v3Graph } from "../src/core/neural/multiverse/Aspects";
import { SavedViewStore, sanitize } from "../src/core/neural/multiverse/SavedViews";
import type { MvGraph } from "../src/core/neural/multiverse/MultiverseTypes";
import { NeuralMapIndex } from "../src/core/neural/NeuralMap";
import { navigationPartition } from "../src/core/neural/adapters";
import { build } from "../scripts/neural/build-cognitive-architecture";
import architecture from "../src/core/neural/multiverse/cognitiveArchitecture.generated.json";
import type { LeluAgent } from "../src/core/agents/AgentTypes";

const ROOT = join(import.meta.dirname, "..");

function sample(): MvGraph {
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    kind: "k",
    group: `g${i % 5}`,
    evidence: "declared" as const,
    weight: i,
    time: i % 7 === 0 ? undefined : 1_700_000_000_000 + i * 1000,
    source: { authority: "test", id: `n${i}` },
    facts: {},
  }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${Math.floor(i / 3)}`, to: n.id, kind: "k", evidence: "declared" as const }));
  return { aspect: "v1", nodes, edges, gaps: [] };
}

test("the library has the twelve shared layouts", () => {
  assert.equal(LAYOUTS.length, 12);
  assert.equal(new Set(LAYOUTS.map((l) => l.id)).size, 12);
});

for (const { id } of LAYOUTS) {
  test(`layout ${id}: places every node, finite and deterministic`, () => {
    const g = sample();
    const a = layout(id, g, 1000);
    const b = layout(id, g, 1000);
    assert.deepEqual(a, b, "same graph, same picture");
    for (const n of g.nodes) {
      const p = a.positions[n.id];
      assert.ok(p, `${n.id} placed`);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      if (id !== "infinite-canvas") {
        // The canvas is deliberately wider than the box (it pans); all others fit.
        assert.ok(p.x >= -1 && p.x <= 1001 && p.y >= -1 && p.y <= 1001, `${id} ${n.id} inside the box: ${p.x},${p.y}`);
      }
    }
  });
}

test("layouts survive an empty graph and a single node", () => {
  for (const { id } of LAYOUTS) {
    assert.deepEqual(Object.keys(layout(id, { aspect: "v1", nodes: [], edges: [], gaps: [] }).positions), []);
    const one = sample();
    one.nodes = one.nodes.slice(0, 1);
    one.edges = [];
    assert.ok(layout(id, one).positions.n0, id);
  }
});

test("temporal river never invents a date: untimed nodes stay at the source", () => {
  const g = sample();
  const r = layout("temporal-river", g);
  for (const n of g.nodes.filter((n) => n.time === undefined)) assert.equal(r.positions[n.id].x, 20);
});

test("core orbit draws hierarchy only from real edges", () => {
  const g = sample();
  g.nodes.push({ ...g.nodes[0], id: "lonely", label: "Lonely" });
  const d = depthsFrom(g, "n0");
  assert.equal(d.get("lonely"), Infinity);
  const r = layout("core-orbit", g);
  assert.ok(r.guides.some((x) => x.kind === "ring" && x.label === "unconnected"));
});

test("V1 is the canonical index as it is", () => {
  const map = new NeuralMapIndex();
  const core = { id: "cosmos-core", level: "core", label: "Cosmos", parentId: null, ref: null, opens: null, position: [0, 0, 0], origin: "system", createdAt: 0, visits: 0, lastVisited: null, removable: false, archived: false } as never;
  map.setPartition(navigationPartition([core]));
  const g = v1Graph(map);
  assert.equal(g.nodes.length, map.all().filter((e) => e.authority !== "referenced").length);
  assert.ok(g.nodes.every((n) => map.has(n.id) && n.evidence === "declared"));
  assert.ok(g.edges.every((e) => map.relations(e.from, { direction: "out" }).some((r) => r.relation.id === e.id)));
});

test("V2 subsystems are real directories and its wiring is the real imports", () => {
  const g = v2Graph();
  const subsystems = g.nodes.filter((n) => n.kind === "subsystem");
  assert.ok(subsystems.length > 20);
  for (const n of subsystems) {
    const path = String(n.facts.path);
    if (path !== "src/core/*.ts") assert.ok(existsSync(join(ROOT, path)), `${path} exists`);
    assert.equal(n.evidence, "measured");
  }
  assert.ok(g.edges.filter((e) => e.kind === "imports").every((e) => e.evidence === "inferred" && (e.weight ?? 0) > 0));
  assert.ok(g.gaps.some((x) => /event bus/.test(x)), "says where live activity comes from, and that none is shown without events");
});

test("V2's committed evidence matches the source as it is now", () => {
  const fresh = build();
  const hint = "regenerate with: npx tsx scripts/neural/build-cognitive-architecture.ts";
  // Directories must match exactly: a new or removed subsystem is a real change.
  assert.deepEqual(fresh.nodes.map((n) => n.id), architecture.nodes.map((n) => n.id), hint);
  // Imports change with every commit; allow small drift so unrelated work does not fail here.
  const drift = Math.abs(fresh.edges.length - architecture.edges.length) / Math.max(1, architecture.edges.length);
  assert.ok(drift <= 0.1, `${hint} (edges ${architecture.edges.length} → ${fresh.edges.length})`);
});

function agent(p: Partial<LeluAgent> & { id: string; name: string }): LeluAgent {
  return {
    role: "r", description: "", instructions: "", personality: "", capabilities: [], tools: ["chat"], memoryAccess: "read", knowledge: [],
    provider: null, fallbackProvider: null, projectId: null, status: "active", enabled: true, createdAt: 1, updatedAt: 1, tasks: [], executions: [],
    permissions: { canBrowse: false, canUseTools: false } as never, ...p,
  } as LeluAgent;
}

test("V3 draws executives and persisted agents, with only their real delegations", () => {
  const execs = [
    { id: "forge", name: "Agent Forge", role: "", domain: "", systems: ["AgentStore"] },
    { id: "lelu", name: "Lélu", role: "", domain: "", systems: [] },
  ];
  const a = agent({ id: "a1", name: "Scout", executive: "lelu", tasks: [{ id: "t1", label: "x", status: "complete", createdAt: 1, delegatedBy: "lelu" }, { id: "t2", label: "y", status: "failed", createdAt: 2, delegatedBy: "a2" }] });
  const b = agent({ id: "a2", name: "Helper" });
  const g = v3Graph(execs, [a, b]);
  assert.equal(g.nodes.length, 4);
  assert.ok(g.edges.some((e) => e.id === "agent:a1|reports-to|executive:lelu" && e.evidence === "declared"));
  assert.ok(g.edges.some((e) => e.id === "agent:a2|reports-to|executive:forge" && e.evidence === "inferred"), "a default owner is marked inferred");
  assert.ok(g.edges.some((e) => e.id === "executive:lelu|delegated|agent:a1" && e.weight === 1));
  assert.ok(g.edges.some((e) => e.id === "agent:a2|delegated|agent:a1"));
  assert.equal(g.nodes.find((n) => n.id === "agent:a1")!.facts.reliability, "50% of 2");
  assert.equal(g.nodes.find((n) => n.id === "agent:a2")!.facts.reliability, undefined, "no record, no reliability");
  assert.ok(g.gaps.some((x) => /self-dialogue/.test(x)), "says what it cannot show");
  assert.ok(v3Graph(execs, []).gaps.some((x) => /No persistent agents/.test(x)));
});

test("saved views: save, rename, favourite, duplicate, restore, remove — and survive a reload", () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  let t = 1000;
  const store = new SavedViewStore(storage, () => t++);
  const v = store.save("Society by time", { aspect: "v3", layout: "temporal-river", query: "scout" });
  store.rename(v.id, "Society over time");
  store.toggleFavorite(v.id);
  const copy = store.duplicate(v.id)!;
  assert.equal(copy.name, "Society over time (copy)");
  assert.equal(store.list()[0].id, v.id, "favourites first");
  const reloaded = new SavedViewStore(storage, () => t++);
  assert.deepEqual(reloaded.restore(v.id), sanitize({ aspect: "v3", layout: "temporal-river", query: "scout" }));
  assert.equal(reloaded.search("copy").length, 1);
  assert.ok(reloaded.remove(copy.id));
  assert.equal(new SavedViewStore(storage).list().length, 1);
});

test("saved views reject malformed settings instead of trusting them", () => {
  const s = sanitize({ aspect: "v9" as never, layout: "nope" as never, density: 99, theme: "x" as never });
  assert.equal(s.aspect, "v1");
  assert.equal(s.layout, "neighbourhood");
  assert.equal(s.density, 2);
  assert.equal(s.theme, "cosmos");
});

/* ---------------------------------------------------------- WP12: V2 in 3D */

import { ARCH_VIEWS, EVENT_SUBSYSTEM, archLayout, liveActivity } from "../src/core/neural/multiverse/Architecture3D";

test("V2 has ten 3D architecture views and each places every real node in 3D", () => {
  const g = v2Graph();
  assert.equal(ARCH_VIEWS.length, 10);
  for (const { id } of ARCH_VIEWS) {
    const a = archLayout(id, g);
    assert.deepEqual(archLayout(id, g), a, `${id} deterministic`);
    for (const n of g.nodes) {
      const p = a.positions[n.id];
      assert.ok(p && p.every(Number.isFinite), `${id}: ${n.id} placed`);
    }
    // A real 3D view uses depth: not every node on one plane (except the board and the time axis).
    if (id !== "circuit-board" && id !== "temporal-activation") {
      const ys = new Set(g.nodes.map((n) => a.positions[n.id][1].toFixed(2)));
      const zs = new Set(g.nodes.map((n) => a.positions[n.id][2].toFixed(2)));
      assert.ok(ys.size > 3 && zs.size > 3, `${id} is three-dimensional`);
    }
  }
});

test("temporal activation draws exactly the measured commit days, and multiscale one particle per real file", () => {
  const g = v2Graph();
  const t = archLayout("temporal-activation", g);
  const expected = g.nodes.filter((n) => n.kind === "subsystem").reduce((s, n) => s + (n.series ?? []).filter((c) => c > 0).length, 0);
  assert.equal(t.bars!.length, expected);
  assert.ok(t.bars!.every((b) => b.height > 0), "no invented zero-height activity");
  const m = archLayout("multiscale", g);
  const files = g.nodes.filter((n) => n.kind === "subsystem").reduce((s, n) => s + Number(n.facts.files), 0);
  assert.equal(m.particles!.length, files);
});

test("live activity is counted from real events, by a table that names only real subsystems", () => {
  const subsystems = new Set(v2Graph().nodes.filter((n) => n.kind === "subsystem").map((n) => n.label));
  for (const [type, sub] of Object.entries(EVENT_SUBSYSTEM)) assert.ok(subsystems.has(sub), `${type} → ${sub} exists`);
  const live = liveActivity([{ type: "tool_started" }, { type: "tool_result" }, { type: "memory_update" }, { type: "mystery" }]);
  assert.deepEqual(live.bySubsystem, { "subsystem:tools": 2, "subsystem:memory": 1 });
  assert.deepEqual(live.unmapped, { mystery: 1 }, "an unknown type is reported, not dropped");
  assert.deepEqual(liveActivity([]).bySubsystem, {}, "no events, no activity");
});
