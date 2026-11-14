/**
 * ==========================================================
 * LÉLU — JOB 2: OPEN-SOURCE CREATIVE KIT + PUBLIC DATA
 *
 * CATEGORY: integration. Every tool runs through the REAL
 * ToolDispatcher (gate, events, Studio cards). Network is
 * replaced by a recorder that FAILS any request, so a tool
 * claimed to work offline is proven not to touch the network,
 * and the connector tests prove which hosts are contacted and
 * that none needs a key. The direct (no-model) path is proven
 * with every model provider unavailable.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import StudioStore from "../src/core/studio/StudioStore";
import type { VisualSpec } from "../src/core/studio/StudioTypes";
import { registerStudioTools } from "../src/core/studio/StudioTools";
import { registerCreativeKitTools, CREATIVE_KIT_TOOLS, visualFile } from "../src/core/creative/kit/CreativeKitTools";
import { dispatchToolCall, toolNameForModel, executableToolIds } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel, toolSchemasForRequest } from "../src/core/tools/ToolSchemas";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { GENERATIVE_STYLES, normalizeGenerative, renderGenerative } from "../src/core/creative/kit/GenerativeArt";
import { checkMermaid, normalizeDiagram, structureToMermaid } from "../src/core/creative/kit/Diagram";
import { exportScene, inspectGlb, normalizeScene, PRESETS } from "../src/core/creative/kit/Scene3D";
import { normalizeViz, vizHtml } from "../src/core/creative/kit/InteractiveViz";
import { normalizeVideo, sceneAt, filmDuration, inspectWebm } from "../src/core/creative/kit/VideoComposer";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";
import { CAPABILITY_PROFILES } from "../src/core/creative/kit/CapabilityProfiles";
import { clearConnectorCache, connectorHosts, connectorProfiles, queryConnector, rowsToViz } from "../src/core/data/PublicDataConnectors";
import DirectResolver from "../src/core/router/DirectResolver";

registerStudioTools();
registerCreativeKitTools();

const ctx = { request: { prompt: "", timestamp: 9090, conversationId: "conv-kit" } } as never;
const call = (id: string, args: Record<string, unknown>) => dispatchToolCall({ id: `c-${id}-${Math.random()}`, name: toolNameForModel(id), arguments: args }, "task-kit", ctx);

/** Run fn with every network request recorded and refused. */
async function noNetwork<T>(fn: () => Promise<T>): Promise<{ result: T; requests: string[] }> {
  const real = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (u: unknown) => { requests.push(String(u)); throw new Error("network disabled in this test"); }) as typeof fetch;
  try { return { result: await fn(), requests }; } finally { globalThis.fetch = real; }
}

test("every creative-kit tool is registered, executable, profiled and offered to a model", () => {
  const names = toolSchemasForModel().map((s) => s.name);
  for (const d of CREATIVE_KIT_TOOLS) {
    assert.ok(executableToolIds().includes(d.id), `${d.id} has an executor`);
    assert.ok(names.includes(toolNameForModel(d.id)), `${d.id} is offered`);
    const profile = ToolRegistry.getInstance().get(d.id)?.profile;
    assert.ok(profile, `${d.id} carries a capability profile`);
    assert.equal(profile!.credentials, "none", `${d.id} needs no credentials`);
  }
  // existing tools gained profiles without changing their executors
  assert.ok(ToolRegistry.getInstance().get("browser.read")?.profile?.fallbacks.includes("direct fetch"));
});

test("a turn about a 3D environment, a film, a diagram or earthquakes is offered the matching tool", () => {
  const offered = (p: string) => toolSchemasForRequest(p).map((s) => s.name);
  assert.ok(offered("Build me a 3D desert environment I can export").includes("creative_scene3d"));
  assert.ok(offered("make a short film about tides").includes("creative_film"));
  assert.ok(offered("draw an architecture diagram of the system").includes("creative_diagram"));
  assert.ok(offered("chart this week's earthquakes").includes("data_query"));
  assert.ok(offered("make some generative art").includes("creative_art"));
});

test("generative art: every style is deterministic, valid SVG, and touches no network", async () => {
  const { requests } = await noNetwork(async () => {
    for (const style of GENERATIVE_STYLES) {
      const p = normalizeGenerative({ style, seed: 42, width: 600, height: 400 });
      assert.notEqual(typeof p, "string");
      const a = renderGenerative(p as never), b = renderGenerative(p as never);
      assert.equal(a.svg, b.svg, `${style} is deterministic`);
      assert.ok(a.elements > 0 && /^<svg[\s\S]*<\/svg>$/.test(a.svg), `${style} draws`);
    }
  });
  assert.deepEqual(requests, []);
  assert.equal(typeof normalizeGenerative({ style: "nope" }), "string");
});

test("creative.art through the dispatcher: a Studio visual, a card, a verified SVG and JSON — offline", async () => {
  const { result: r, requests } = await noNetwork(() => call("creative.art", { title: "Tide lines", style: "ridgelines", palette: "ocean", seed: 7, export: ["svg", "json", "png"] }));
  assert.deepEqual(requests, [], "no network");
  const id = (r.data as { artifactId: string }).artifactId;
  const a = StudioStore.getInstance().get(id)!;
  assert.equal(a.kind, "visual");
  assert.equal(a.conversationId, "conv-kit");
  assert.match(r.content, /✓ Tide-lines\.svg .* sha256/);
  assert.match(r.content, /✓ Tide-lines\.json/);
  assert.match(r.content, /✗ png: PNG is rasterised with Canvas in the browser/, "PNG honestly needs a browser here");
  assert.ok(visualFile(id, 1, "svg")!.bytes.byteLength > 1000);
});

test("diagrams: Mermaid source and structure are checked; malformed source is refused with a reason", () => {
  const src = structureToMermaid({ nodes: [{ id: "chat", label: "Chat" }, { id: "tools", label: "Tools [kit]", group: "core" }], edges: [{ from: "chat", to: "tools", label: "calls" }] });
  assert.equal(checkMermaid(src), null, src);
  assert.match(src, /subgraph core/);
  assert.equal(typeof normalizeDiagram({ source: "sequenceDiagram\n  A->>B: hi" }), "object");
  assert.match(String(normalizeDiagram({ source: "not a diagram" })), /must declare a diagram type/);
  assert.match(String(normalizeDiagram({ source: "flowchart LR\n  a[open --> b" })), /unbalanced/);
  assert.match(String(normalizeDiagram({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "zz" }] })), /does not exist/);
});

test("3D: every preset builds and exports a valid GLB with meshes; animation survives; offline", async () => {
  const { requests } = await noNetwork(async () => {
    for (const preset of Object.keys(PRESETS)) {
      const p = normalizeScene({ preset, seed: 5 });
      assert.notEqual(typeof p, "string", String(p));
      const { bytes, stats } = await exportScene(p as never, "glb");
      const glb = inspectGlb(bytes);
      assert.ok(glb.ok && glb.version === 2, `${preset}: ${glb.reason}`);
      assert.ok((glb.meshes ?? 0) > 0 && stats.triangles > 1000, `${preset} has geometry`);
      if ((p as { objects: Array<{ animate?: unknown }> }).objects.some((o) => o.animate)) assert.equal(glb.animations, 1, `${preset} keeps its animation`);
    }
  });
  assert.deepEqual(requests, []);
});

test("creative.scene3d with custom objects → GLB through the dispatcher", async () => {
  const r = await call("creative.scene3d", {
    title: "Pavilion", objects: [
      { shape: "terrain", size: { width: 30, depth: 30, height: 1.5 }, color: "#52b788" },
      { shape: "torusKnot", position: [0, 3, 0], color: "gold", metalness: 0.9, roughness: 0.2, animate: "spin" },
      { shape: "tree", repeat: { count: 12, pattern: "ring", radius: 9 } },
    ], export: ["glb", "gltf"],
  });
  assert.equal(r.ok, true, r.content);
  assert.match(r.content, /✓ Pavilion\.glb .*meshes \d+/);
  assert.match(r.content, /✓ Pavilion\.gltf/);
  assert.match(String(normalizeScene({ objects: [{ shape: "dragon" }] })), /unknown shape/);
});

test("interactive chart: one focusable mark per value, sources cited, table and toggles present", () => {
  const p = normalizeViz({ kind: "line", title: "Tides", labels: ["Mon", "Tue", "Wed"], series: [{ name: "High", values: [3.1, 3.4, 2.9] }, { name: "Low", values: [0.2, 0.4, 0.1] }], sources: [{ title: "NOAA Tides", url: "https://tidesandcurrents.noaa.gov/" }] });
  assert.notEqual(typeof p, "string");
  const html = vizHtml(p as never);
  assert.equal((html.match(/class="mark"/g) ?? []).length, 6);
  assert.match(html, /data-toggle="1"/);
  assert.match(html, /<table>/);
  assert.match(html, /NOAA Tides/);
  assert.match(String(normalizeViz({ kind: "pie", labels: ["a"], series: [{ values: [-1] }] })), /negative/);
});

test("film: timeline normalised, scene timing and crossfades are exact; WebM read-back recognises a real header", () => {
  const p = normalizeVideo({ scenes: [{ duration: 2, title: "A" }, { duration: 3, visual: { type: "generative", style: "orbits" } }], transitionSec: 0.5, soundtrack: "bright" });
  assert.notEqual(typeof p, "string", String(p));
  const v = p as never as Parameters<typeof sceneAt>[0];
  assert.equal(filmDuration(v), 5);
  assert.deepEqual(sceneAt(v, 0.5).index, 0);
  assert.ok(sceneAt(v, 1.75).blend && sceneAt(v, 1.75).blend!.index === 1, "crossfade into scene 2");
  assert.equal(sceneAt(v, 4.9).index, 1);
  assert.match(String(normalizeVideo({ scenes: Array.from({ length: 10 }, () => ({ duration: 10 })) })), /limit is 90 s/);
  assert.equal(inspectWebm(new Uint8Array(100)).ok, false);
});

test("creative.film outside a browser stores the program and says the WebM needs a device encoder", async () => {
  const r = await call("creative.film", { title: "Tides", scenes: [{ duration: 2, title: "Tides" }], export: ["webm", "json"] });
  assert.match(r.content, /✗ webm: films are encoded on the device/);
  assert.match(r.content, /✓ Tides\.json/);
});

test("public data connectors: no key, documented limits/terms, paced, cached, cited — with a recorded network", async () => {
  for (const p of connectorProfiles()) {
    assert.equal(p.auth, "none");
    assert.ok(p.limits && p.terms && p.attribution, `${p.id} documents limits, terms and attribution`);
  }
  clearConnectorCache();
  const seen: string[] = [];
  const geojson = JSON.stringify({ metadata: { title: "USGS M4.5+ Earthquakes, Past Week" }, features: [
    { properties: { mag: 5.1, place: "off the coast", time: Date.UTC(2026, 10, 12), url: "https://earthquake.usgs.gov/a", tsunami: 0 }, geometry: { coordinates: [140, 35, 10] } },
    { properties: { mag: 4.6, place: "ridge", time: Date.UTC(2026, 10, 13), url: "https://earthquake.usgs.gov/b", tsunami: 0 }, geometry: { coordinates: [-30, 10, 33] } },
  ] });
  const fetchImpl = async (u: string, init?: RequestInit) => {
    seen.push(u);
    assert.ok(!JSON.stringify(init?.headers ?? {}).match(/authorization|api[-_]?key|bearer/i), "no credential header is ever sent");
    return new Response(geojson, { status: 200 });
  };
  const a = await queryConnector("usgs.earthquakes", { magnitude: "4.5", period: "week" }, { fetchImpl });
  const b = await queryConnector("usgs.earthquakes", { magnitude: "4.5", period: "week" }, { fetchImpl });
  assert.ok(a.ok && b.ok);
  assert.equal(seen.length, 1, "the second call is served from cache");
  assert.equal(b.ok && b.cached, true);
  assert.match(a.ok ? a.citation.attribution : "", /U\.S\. Geological Survey/);
  const viz = rowsToViz(a as never, { kind: "column", label: "day", aggregate: "count" });
  assert.deepEqual((viz as { labels: string[] }).labels, ["2026-11-12", "2026-11-13"]);
  for (const u of seen) assert.ok(connectorHosts().includes(new URL(u).hostname));
});

test("connectors fail precisely: a daily 429 is not hammered, bad parameters never reach the network", async () => {
  clearConnectorCache();
  let calls = 0;
  const r = await queryConnector("openmeteo.forecast", { lat: 1, lon: 2 }, { fetchImpl: async () => { calls += 1; return new Response('{"reason":"Daily API request limit exceeded"}', { status: 429 }); } });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /429/);
  assert.equal(calls, 1, "a budget 429 without a short Retry-After is not retried");
  const bad = await queryConnector("github.releases", { repo: "not a repo" }, { fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.match(bad.ok ? "" : bad.reason, /owner\/name/);
});

test("no connector host is a paid or model-inference endpoint", () => {
  const forbidden = /openai|anthropic|groq|openrouter|cerebras|fireworks|mistral|gemini|googleapis|meshy|elevenlabs|replicate|stability|firecrawl/;
  for (const h of connectorHosts()) assert.ok(!forbidden.test(h), `${h} is a data host`);
  for (const p of Object.values(CAPABILITY_PROFILES)) assert.ok(p.credentials === "none" || p.credentials === "existing configured keys only");
});

test("the direct compiler turns ordinary requests into tool plans — no model", () => {
  assert.equal(compileDirect("Build me a 3D desert environment")!.steps[0].args.preset, "desert");
  assert.equal(compileDirect("make a short film about ocean tides")!.steps[0].tool, "creative.film");
  assert.equal(compileDirect("/diagram chat -> router -> tools, router -> data")!.steps[0].tool, "creative.diagram");
  assert.equal(compileDirect("make me a concept fashion collection called Nocturne")!.steps.length, 4);
  assert.equal(compileDirect("Research coral reef bleaching and show me what you find")!.steps[0].tool, "research.board");
  assert.equal(compileDirect("visualize this week's earthquakes")!.steps[0].args.connector, "usgs.earthquakes");
  assert.equal(compileDirect("/scene forest")!.explicit, true);
  assert.equal(compileDirect("Build me a 3D forest")!.explicit, false);
  assert.equal(compileDirect("how are you today?"), null);
});

test("with EVERY model provider unavailable, a creative request still executes through real tools", async () => {
  const resolver = new DirectResolver();
  let modelCalls = 0;
  const context = {
    request: { prompt: "make me a concept fashion collection called Nocturne", timestamp: 777, conversationId: "conv-offline" },
    started: Date.now(),
    aiProviders: { available: async () => [], names: () => ["groq", "openrouter", "cerebras"], generate: () => { modelCalls += 1; throw new Error("no"); } },
  } as never;
  assert.equal(await resolver.providersAvailable(context), false);
  const plan = resolver.plan(context)!;
  const { result, requests } = await noNetwork(() => resolver.execute(context, plan, "no-provider"));
  assert.equal(result.handled, true);
  const text = result.response!.text;
  assert.match(text, /No model provider is reachable/);
  assert.match(text, /✓ moodboard texture/);
  assert.match(text, /✓ editable sketches/);
  assert.match(text, /✓ concept map/);
  assert.match(text, /✓ 3D runway/);
  assert.match(text, /\.glb .*verified|✓ .*\.glb/);
  assert.equal((result.response!.metadata as { modelCalls: number }).modelCalls, 0);
  assert.equal(modelCalls, 0);
  assert.deepEqual(requests, [], "the whole collection was made without one network request");
  const mine = StudioStore.getInstance().list().filter((a) => a.conversationId === "conv-offline");
  assert.deepEqual(mine.map((a) => a.kind).sort(), ["drawing", "visual", "visual", "visual"]);
  const runway = mine.find((a) => a.kind === "visual" && (StudioStore.getInstance().latest(a).spec as VisualSpec).medium === "scene3d")!;
  assert.ok(visualFile(runway.id, 1, "glb")!.bytes.byteLength > 10_000);
});

test("an editable drawing exports as a .excalidraw file that re-opens with every element", async () => {
  const r = await call("studio.create", { kind: "drawing", title: "Croquis", scene: { elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 60 }, { type: "text", x: 10, y: 10, text: "look 1" }] } });
  const id = (r.data as { id: string }).id;
  const e = await call("creative.export", { artifact: id, format: "excalidraw" });
  assert.equal(e.ok, true, e.content);
  assert.match(e.content, /✓ Croquis\.excalidraw .*\n\s+✓ re-opens as an Excalidraw scene — 2 editable elements/);
  const file = JSON.parse(new TextDecoder().decode(visualFile(id, 1, "excalidraw")!.bytes));
  assert.equal(file.type, "excalidraw");
});
