/**
 * ==========================================================
 * LÉLU — GRAPH AND DRAWING ARTIFACTS (React Flow + Excalidraw)
 *
 * CATEGORY: integration. The real Creation Studio store, ops,
 * tools and dispatcher. Graphs and drawings are Studio artifacts
 * (stable id, revisions, conversation binding, chat cards) — not
 * a second store. Their editors are lazy chunks; this file checks
 * the data model, the tools LÉLU uses, and the wiring.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import StudioStore from "../src/core/studio/StudioStore";
import { normalizeSpec } from "../src/core/studio/StudioOps";
import { registerStudioTools } from "../src/core/studio/StudioTools";
import { agentHierarchyGraph } from "../src/core/studio/GraphSources";
import { FORMATS_BY_KIND } from "../src/core/studio/StudioTypes";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";

registerStudioTools();
const store = StudioStore.getInstance();
const call = (id: string, args: Record<string, unknown>) =>
  dispatchToolCall({ id: `c-${id}`, name: toolNameForModel(id), arguments: args }, "task-graph", { request: { prompt: "", timestamp: 7070, conversationId: "conv-graph" } } as never);

test("a graph spec is validated: unique ids, edges between real nodes, groups that exist", () => {
  const ok = normalizeSpec({ kind: "graph", title: "Pipeline", nodes: [{ id: "a", label: "Research" }, { id: "b", label: "Design", group: "a" }], edges: [{ from: "a", to: "b" }], links: ["moon-oasis", "moon-oasis"] });
  assert.equal(ok.ok, true);
  if (ok.ok && ok.spec.kind === "graph") {
    assert.equal(ok.spec.nodes[1].group, "a", "nested systems");
    assert.deepEqual(ok.spec.links, ["moon-oasis"], "links deduplicated");
    assert.equal(typeof ok.spec.nodes[0].x, "number", "positions filled in when missing");
  }
  assert.match((normalizeSpec({ kind: "graph", title: "x", nodes: [{ id: "a" }, { id: "a" }] }) as { reason: string }).reason, /two nodes have the id “a”/);
  assert.match((normalizeSpec({ kind: "graph", title: "x", nodes: [{ id: "a" }], edges: [{ from: "a", to: "z" }] }) as { reason: string }).reason, /must both be nodes/);
  assert.match((normalizeSpec({ kind: "graph", title: "x", nodes: [{ id: "a", group: "nope" }] }) as { reason: string }).reason, /not a node/);
});

test("a drawing keeps Excalidraw's scene data unchanged", () => {
  const element = { id: "r1", type: "rectangle", x: 10, y: 20, width: 100, height: 50, seed: 42, version: 3, customData: { keep: true } };
  const r = normalizeSpec({ kind: "drawing", title: "Sketch", scene: { elements: [element], appState: { viewBackgroundColor: "#fff" }, files: {} } });
  assert.equal(r.ok, true);
  if (r.ok && r.spec.kind === "drawing") assert.deepEqual(r.spec.scene.elements[0], element, "no conversion, nothing dropped");
});

test("LÉLU creates a graph and a drawing through studio.create, bound to the conversation", async () => {
  const graph = await call("studio.create", { kind: "graph", title: "Agent pipeline", nodes: [{ id: "r", label: "Researcher", type: "agent" }, { id: "d", label: "Designer", type: "agent" }], edges: [{ from: "r", to: "d", label: "hands off" }], open: false });
  assert.equal(graph.ok, true, graph.content);
  const g = store.get((graph.data as { id: string }).id)!;
  assert.equal(g.kind, "graph");
  assert.equal(g.conversationId, "conv-graph");
  const drawing = await call("studio.create", { kind: "drawing", title: "Lantern sketch", scene: { elements: [{ type: "rectangle", x: 0, y: 0, width: 120, height: 80 }, { type: "text", x: 10, y: 10, text: "Lumo" }] }, open: false });
  assert.equal(drawing.ok, true, drawing.content);
  assert.equal(store.get((drawing.data as { id: string }).id)!.kind, "drawing");
  // She can read what she made.
  const read = await call("studio.read", { artifact: g.id });
  assert.match(read.content, /node \[r\] Researcher \(agent\)/);
  assert.match(read.content, /edge \[[^\]]+\] r → d “hands off”/);
});

test("LÉLU revises a graph with a full spec; ops other than setTitle are refused with the reason", async () => {
  const created = await call("studio.create", { kind: "graph", title: "Rev graph", nodes: [{ id: "a", label: "A" }], open: false });
  const id = (created.data as { id: string }).id;
  const revised = await call("studio.revise", { artifact: id, spec: { kind: "graph", title: "Rev graph", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] } });
  assert.equal(revised.ok, true, revised.content);
  assert.equal(store.get(id)!.revisions.length, 2);
  const refused = await call("studio.revise", { artifact: id, ops: [{ op: "addBlock", block: { type: "paragraph", text: "x" } }] });
  assert.equal(refused.ok, false);
  assert.match(refused.content, /a graph is revised with a full spec/);
});

test("a hand edit is one revision per editing session; LÉLU's revision starts a new one", () => {
  const r = store.create({ kind: "graph", title: "Session", nodes: [{ id: "a", label: "A" }] }, { by: "user" });
  assert.ok(r.ok);
  const id = r.artifact.id;
  const edit = (x: number) => store.saveEdit(id, { kind: "graph", title: "Session", nodes: [{ id: "a", label: "A", x, y: 0 }], edges: [] });
  for (const x of [10, 20, 30, 40]) assert.ok(edit(x).ok);
  assert.equal(store.get(id)!.revisions.length, 2, "four drags → one 'edited' revision");
  assert.equal((store.get(id)!.revisions[1].spec as { nodes: Array<{ x: number }> }).nodes[0].x, 40);
  store.revise(id, { spec: { kind: "graph", title: "Session", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [] }, by: "lelu" });
  edit(50);
  assert.equal(store.get(id)!.revisions.length, 4, "her revision is kept; the next hand edit is a new revision");
  assert.equal(store.saveEdit(id, { kind: "drawing", title: "x", scene: { elements: [] } }).ok, false, "kind cannot change");
});

test("the agent hierarchy graph comes from the real ownership resolver", () => {
  const g = agentHierarchyGraph([
    { id: "u1", name: "Designer", templateId: "designer", tools: ["sketch"] },
    { id: "u2", name: "My custom agent", tools: [] },
    { id: "u3", name: "Old", tools: [], status: "archived" },
  ]);
  assert.ok(g.nodes.some((n) => n.id === "core") && g.nodes.some((n) => n.id === "shaman"));
  assert.ok(g.edges.some((e) => e.from === "core" && e.to === "shaman"));
  const custom = g.nodes.find((n) => n.ref === "u2")!;
  assert.ok(g.edges.some((e) => e.from === "exec:forge" && e.to === custom.id), "an agent with no template belongs to Agent Forge");
  assert.ok(!g.nodes.some((n) => n.ref === "u3"), "archived agents are left out");
  assert.equal(normalizeSpec(g).ok, true, "it is a valid graph artifact");
});

test("no Studio writer is claimed for graphs or drawings; the editors are lazy, one per kind", () => {
  assert.deepEqual(FORMATS_BY_KIND.graph, []);
  assert.deepEqual(FORMATS_BY_KIND.drawing, []);
  const win = readFileSync("src/app/scene/genesis/studio/StudioArtifactWindow.tsx", "utf8");
  assert.match(win, /const GraphEditor = lazy\(\(\) => import\("\.\/GraphEditor"\)\);/);
  assert.match(win, /const DrawingEditor = lazy\(\(\) => import\("\.\/DrawingEditor"\)\);/);
  for (const f of ["src/app/scene/genesis/studio/GenesisCreationStudio.tsx", "src/app/scene/genesis/studio/StudioArtifactWindow.tsx", "src/app/scene/genesis/GenesisInterface.tsx"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /from "@xyflow\/react"|from "@excalidraw\/excalidraw"/, `${f} must not import an editor library eagerly`);
  }
});
