/**
 * Mission 5 WP06 — LÉLU uses her spatial engine through her EXISTING agent
 * architecture: ToolRegistry declares, ToolDispatcher executes (with its
 * AutonomyGate and evidence), ToolSchemas routes and budgets. The tools
 * here hit the real /api/asre and /api/forge handlers in-process (relative
 * fetches are routed to a local server; any other URL fails the test).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { registerAsreTools, ASRE_TOOLS, explainJob } from "../src/core/asre/AsreTools";
import { selectToolSchemas, toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { createAsreApi } from "../plugins/asreApi";
import { createMeshyForgeApi } from "../plugins/meshyForgeApi";
import { pngBytes, type AsreRuntime } from "../plugins/asreJobs";
import { blenderRunner } from "../scripts/asre/runtime";

registerAsreTools();
const ctx = { request: { prompt: "", timestamp: 1, conversationId: "conv-asre" } } as never;
const call = (id: string, args: Record<string, unknown>) => dispatchToolCall({ id: `c-${id}-${Math.random()}`, name: toolNameForModel(id), arguments: args }, "task-asre", ctx);

let server: Server;
let base = "";
const roots: string[] = [];
const outside: string[] = [];
const realFetch = globalThis.fetch;
const offline: AsreRuntime = { available: async () => ({ triposr: false, blender: Boolean(blenderRunner()) }), runWorker: async () => ({ result: {} }), ingest: async () => ({}), triposrHypotheses: async () => ({}), render: async () => null };

before(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-agent-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  roots.push(root, forgeRoot);
  const forge = createMeshyForgeApi(() => undefined, { assetRoot: forgeRoot, poll: false });
  const asre = createAsreApi(() => undefined, { root, runtime: offline, forgeStore: forge.forge.store });
  const routes: Array<[string, (req: unknown, res: unknown, next: () => void) => void]> = [];
  const host = { use: (p: string, h: (req: unknown, res: unknown, next: () => void) => void) => routes.push([p, h]) };
  forge.attach(host as never);
  asre.attach(host as never);
  server = createServer((req, res) => {
    const r = routes.find(([p]) => (req.url ?? "").startsWith(p));
    if (!r) return void ((res.statusCode = 404), res.end());
    // connect strips the mount; both handlers accept either form
    r[1](req, res, () => ((res.statusCode = 404), res.end()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    if (url.startsWith(base)) return realFetch(url, init);
    outside.push(url);
    throw new Error(`network refused in test: ${url}`);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const vase = () =>
  Buffer.from(
    pngBytes(160, 200, (x, y) => {
      const t = (y - 20) / 160;
      return t >= 0 && t <= 1 && Math.abs(x - 80) <= 18 + 30 * Math.sin(Math.PI * t) ? [190, 70, 40, 255] : [255, 255, 255, 255];
    }),
  ).toString("base64");

test("the spatial tools are registered once, executable, offered, and small", () => {
  const reg = ToolRegistry.getInstance().all().filter((t) => t.id.startsWith("asre."));
  assert.equal(reg.length, ASRE_TOOLS.length, "no duplicate registrations");
  const offered = toolSchemasForModel().filter((s) => s.name.startsWith("asre_"));
  assert.equal(offered.length, 7);
  const bytes = offered.reduce((n, s) => n + JSON.stringify(s).length, 0);
  assert.ok(bytes < 9000, `all seven schemas together are ${bytes} bytes`);
});

test("routing: a spatial turn carries the spatial tools within the turn budget; an unrelated turn does not", () => {
  const all = toolSchemasForModel();
  for (const prompt of ["Turn this photo into 3D", "reconstruct the chair from these images", "change her hairstyle to a bob but keep everything else", "restore the original hairstyle"]) {
    const names = selectToolSchemas(all, prompt).map((s) => String(s.name));
    assert.ok(names.some((n) => n.startsWith("asre_")), `${prompt} → ${names.join(",")}`);
  }
  const names = selectToolSchemas(all, "what's the weather in Tokyo?").map((s) => String(s.name));
  assert.ok(!names.some((n) => n.startsWith("asre_")), names.join(","));
});

test("LÉLU reconstructs, inspects, explains uncertainty honestly and asks for the most useful view", async () => {
  const status = await call("asre.status", {});
  assert.equal(status.ok, true, status.content);
  const started = await call("asre.reconstruct", { images: [{ view: "front", imageBase64: vase() }], engine: "silhouette" });
  assert.equal(started.ok, true, started.content);
  assert.match(started.content, /nothing about the shape is known/);
  const jobId = (started.data as { job: { id: string } }).job.id;
  let summary = await call("asre.job", { jobId });
  for (let i = 0; i < 100 && !/succeeded|failed/.test(summary.content); i++) {
    await new Promise((r) => setTimeout(r, 50));
    summary = await call("asre.job", { jobId });
  }
  assert.match(summary.content, /succeeded/);
  assert.match(summary.content, /OBSERVED/);
  assert.match(summary.content, /GENERATED/);
  assert.match(summary.content, /most useful additional input is the (back|left|right|top|bottom) view/);
  assert.doesNotMatch(summary.content, /\bconfirmed\b/i);
  const hyps = await call("asre.job", { jobId, focus: "hypotheses" });
  assert.match(hyps.content, /3 competing hypotheses/);
  assert.match(hyps.content, /hypotheses, not measurements/);
  const unc = await call("asre.job", { jobId, focus: "uncertainty" });
  assert.match(unc.content, /back \d+% supported/);
  const geo = await call("asre.job", { jobId, focus: "geometry" });
  assert.match(geo.content, /scale is UNKNOWN/i);
  assert.match(geo.content, /passes the Forge inspection; in the Forge as fj_/);
  // an unknown job is reported as such, not invented
  const nope = await call("asre.job", { jobId: "does-not-exist" });
  assert.equal(nope.ok, false);
  assert.deepEqual(outside, []);
});

test("LÉLU edits only what she must, restores, compares and exports through the Forge", async (t) => {
  const created = await call("asre.character", { characterId: "lelu", create: true });
  assert.equal(created.ok, true, created.content);
  const preview = await call("asre.character", { characterId: "lelu", preview: true, patch: { hair: { style: "bob" } } });
  assert.match(preview.content, /rebuild hair \(own parameters\)/);
  assert.match(preview.content, /14 components kept/);
  const edited = await call("asre.character", { characterId: "lelu", patch: { hair: { style: "bob" } } });
  assert.match(edited.content, /rebuilt hair, recoloured nothing, reused 14/);
  const outfit = await call("asre.character", { characterId: "lelu", patch: { clothing: { top: "jacket" } } });
  assert.match(outfit.content, /rebuilt clothing\.top/);
  const restored = await call("asre.history", { characterId: "lelu", action: "restore", version: "v0001", groups: ["hair"] });
  assert.match(restored.content, /Restored hair from v0001 as new version v0004/);
  const cmp = await call("asre.history", { characterId: "lelu", action: "compare", a: "v0001", b: "v0004" });
  assert.match(cmp.content, /clothing\.top geometry/);
  assert.doesNotMatch(cmp.content, /hair geometry/);
  const undo = await call("asre.history", { characterId: "lelu", action: "undo" });
  assert.match(undo.content, /head of lelu is now v0003/);
  const list = await call("asre.history", { characterId: "lelu", action: "list" });
  assert.match(list.content, /▶v0003/);
  if (!blenderRunner()) return t.skip("no Blender here: export not exercised");
  const exp = await call("asre.export", { characterId: "lelu", version: "v0003", formats: ["glb", "stl"] });
  assert.equal(exp.ok, true, exp.content);
  assert.match(exp.content, /runtime\.glb/);
  assert.match(exp.content, /source\.stl/);
  assert.deepEqual(outside, [], "no paid or remote service was called");
});

test("explainJob never describes an unfinished job's geometry", () => {
  const text = explainJob({ id: "x", kind: "reconstruct", state: "running", engine: "silhouette", parentJobId: null, createdAt: 0, startedAt: 0, finishedAt: null, steps: [{ step: "decode", state: "done" }], error: null, progress: 0.1, input: { images: [] }, result: null, observation: null });
  assert.match(text, /Nothing about the geometry is known yet/);
});
