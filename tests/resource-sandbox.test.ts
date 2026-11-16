/**
 * Resource intelligence, server half and the capability it produced.
 * The sandbox tests run locally (no registry access): the escape probe and
 * a proof of concept that REUSES the installed three.js exporters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSandbox, ESCAPE_PROBE } from "../plugins/resourceApi";
import { exportPlacements } from "../src/core/world/WorldExport";
import type { CosmosPlacement } from "../src/core/forge/ForgeClient";

const prim = (id: string, shape: NonNullable<CosmosPlacement["primitive"]>["shape"], x = 0): CosmosPlacement => ({
  id, jobId: "", character: "", label: id, file: "", position: [x, 0, 0], rotationY: 0, height: 1, createdAt: 0,
  primitive: { shape, color: "#ffffff", metalness: 0, roughness: 1, emissive: null, opacity: 1 },
});

test("world export: a box is 12 STL facets; forge meshes and worn items are skipped with a reason", () => {
  const forge = { ...prim("asset", "box"), primitive: null, file: "assets/statue.glb" };
  const worn = { ...prim("ring", "torus"), worn: true };
  const stl = exportPlacements([prim("cube", "box"), forge, worn], "stl");
  assert.equal(stl.faces, 12);
  assert.ok(stl.text.startsWith("solid"));
  assert.deepEqual(stl.skipped.map((s) => s.id), ["asset", "ring"]);
  assert.match(stl.skipped[0].reason, /statue\.glb/);
  const obj = exportPlacements([prim("cube", "box"), prim("ball", "sphere", 3)], "obj");
  assert.equal((obj.text.match(/^o /gm) ?? []).length, 2);
  assert.ok(obj.faces > 12);
  assert.equal(exportPlacements([prim("cube", "box")], "stl", ["nothing"]).exported.length, 0);
});

test("sandbox: downloaded code cannot read the project, spawn processes, see secrets or reach the network", async () => {
  process.env.LELU_TEST_SECRET_KEY = "should-not-leak";
  const result = await runSandbox({ code: ESCAPE_PROBE });
  assert.equal(result.ok, true, result.stderr);
  const seen = JSON.parse(result.stdout.trim()) as Record<string, string | number>;
  assert.match(String(seen.readProject), /^denied/);
  assert.match(String(seen.readSystem), /^denied/);
  assert.match(String(seen.spawn), /^denied/);
  assert.match(String(seen.network), /^denied/);
  assert.equal(seen.secrets, 0);
  delete process.env.LELU_TEST_SECRET_KEY;
});

test("sandbox: an installed module is reused, not reinstalled", async () => {
  const code = `
    import * as THREE from "three";
    import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
    const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))); s.updateMatrixWorld(true);
    const n = (new STLExporter().parse(s).match(/facet normal/g) || []).length;
    console.log(n); if (n !== 12) process.exit(1);`;
  const result = await runSandbox({ reuse: "three/examples/jsm/exporters/STLExporter.js", code });
  assert.equal(result.ok, true, result.stderr);
  assert.equal(result.stdout.trim(), "12");
  assert.equal(result.package, undefined, "nothing was installed");
});

test("sandbox: a failing proof of concept is reported as failed, and bad input is refused", async () => {
  const failed = await runSandbox({ code: "process.exit(3)" });
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 3);
  assert.ok((await runSandbox({ code: "" })).refused);
  assert.ok((await runSandbox({ reuse: "definitely-not-installed-pkg", code: "1" })).refused);
});

test("resource tools and the agent are registered in the existing layers", async () => {
  const { default: defs } = await import("../src/core/acquisition/CommandCenterToolDefinitions");
  const { default: execs } = await import("../src/core/acquisition/CommandCenterExecutors");
  for (const id of ["resources.gaps", "resources.discover", "resources.evaluate", "resources.sandbox", "resources.register", "resources.audit"]) {
    assert.ok(defs.some((d) => d.id === id), `definition ${id}`);
    assert.ok(execs.some((e) => e.id === id), `executor ${id}`);
  }
  const { WORLD_TOOLS, WORLD_EXECUTORS } = await import("../src/core/world/WorldTools");
  assert.ok(WORLD_TOOLS.some((t) => t.id === "world.export") && WORLD_EXECUTORS.some((e) => e.id === "world.export"));
  const { AGENT_TEMPLATES } = await import("../src/core/agents/AgentTemplates");
  const { ownershipOf } = await import("../src/core/agents/ExecutiveOwnership");
  const agent = AGENT_TEMPLATES.find((t) => t.id === "resource-intelligence");
  assert.ok(agent);
  assert.equal(ownershipOf({ name: agent.name, templateId: agent.id }).executive, "forge");
});

test("resource intelligence makes no model call", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["plugins/resourceApi.ts", "src/core/acquisition/ResourceIntelligence.ts", "src/core/acquisition/ResourceTools.ts"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\/api\/model|ai\.chat|generate\(|AIProviderRegistry/, file);
  }
});

test("curated proofs for reusable installed modules pass in the sandbox (no model writes this code)", async () => {
  const { GAP_SIGNATURES } = await import("../src/core/acquisition/ResourceIntelligence");
  for (const id of ["world-export-gltf", "3d-export-stl"]) {
    const sig = GAP_SIGNATURES.find((s) => s.id === id)!;
    const result = await runSandbox({ reuse: sig.reuse[0], code: sig.proof! });
    assert.equal(result.ok, true, `${id}: ${result.stderr}`);
    assert.match(result.stdout, id === "world-export-gltf" ? /"ok":true/ : /"stlFacets":12/);
  }
});
