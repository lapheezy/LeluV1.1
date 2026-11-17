/**
 * Mission 5 WP02 — ASRE geometry enters the EXISTING 3D Forge:
 *
 *   image → reconstruction job → Forge job (kind "asre", inspected,
 *   provenance kept) → library → Cosmos placement → edit (new version,
 *   source untouched) → history → Blender export through the Forge's own
 *   gate → the exported GLB imported again and inspected.
 *
 * fetch is trapped for the whole file: nothing here may reach Meshy or any
 * other network service.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { AsreJobManager, pngBytes, type AsreRuntime } from "../plugins/asreJobs";
import { AsreForge, ASRE_COLLECTION, conventionsOf } from "../plugins/asreForge";
import { ForgeStore } from "../plugins/forgeStore";
import { MeshyForge } from "../plugins/meshyForge";
import { exportFormats, findBlender } from "../plugins/blenderStage";
import { createAsreApi } from "../plugins/asreApi";
import { editGlb, measureBounds } from "../src/core/asre/gltf/GlbEditor";
import { inspectGlb } from "../src/core/forge/GlbInspector";
import { blenderRunner } from "../scripts/asre/runtime";

const realFetch = globalThis.fetch;
let networkCalls: string[] = [];
before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!/^https?:\/\/127\.0\.0\.1[:/]/.test(url)) {
      networkCalls.push(url);
      throw new Error(`network call refused in test: ${url}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const offline: AsreRuntime = {
  available: async () => ({ triposr: false, blender: false }),
  runWorker: async () => {
    throw new Error("unused");
  },
  ingest: async () => ({}),
  triposrHypotheses: async () => ({}),
  render: async () => null,
};

/** A silhouette PNG: a vase-like shape (wider in the middle), red on white. */
function vase(w = 160, h = 200): Uint8Array {
  return pngBytes(w, h, (x, y) => {
    const t = (y - 20) / (h - 40);
    const half = t < 0 || t > 1 ? -1 : 18 + 30 * Math.sin(Math.PI * t);
    return Math.abs(x - w / 2) <= half ? [190, 70, 40, 255] : [255, 255, 255, 255];
  });
}

async function reconstructIntoForge(root: string, forgeRoot: string) {
  const forge = new AsreForge(new ForgeStore(forgeRoot));
  const m = new AsreJobManager({ root, runtime: offline, onSucceeded: (job) => forge.fileReconstruction(job, (rel) => new Uint8Array(readFileSync(path.join(root, rel)))).id });
  const job = await m.settle((await m.reconstruct([{ view: "front", bytes: vase() }], { resolution: 48 })).id);
  return { forge, m, job };
}

test("a finished reconstruction is filed in the Forge ledger as kind asre, inspected, with provenance and zero spend", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-f-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  try {
    const { forge, job } = await reconstructIntoForge(root, forgeRoot);
    assert.equal(job.state, "succeeded", job.error ?? "");
    const forgeId = job.result!.forgeJobId!;
    assert.ok(forgeId, "the job records its Forge job");
    const fj = forge.store.job(forgeId)!;
    assert.equal(fj.kind, "asre");
    assert.equal(fj.character, ASRE_COLLECTION);
    assert.equal(fj.status, "SUCCEEDED");
    assert.equal(fj.consumedCredits, 0);
    assert.equal(fj.estimatedCredits, 0);
    assert.equal(fj.meshyTaskId, null);
    assert.equal(fj.validation!.verdict.meshValid, true);
    const prov = (fj.request as { provenance: Record<string, unknown> }).provenance;
    assert.deepEqual(prov.evidence, job.result!.evidence, "evidence classes survive into the Forge");
    assert.match(String(prov.evidenceText), /GENERATED/);
    const roles = fj.output!.files.map((f) => f.role).sort();
    assert.deepEqual(roles, ["asre-metadata", "model", "nre-grid"]);
    for (const f of fj.output!.files) assert.ok(existsSync(forge.store.absolute(f.file)));
    // the GLB carries its provenance in the scene extras, and the colours (COLOR_0) survive
    const glb = new Uint8Array(readFileSync(forge.store.absolute(fj.output!.files.find((f) => f.role === "model")!.file)));
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))));
    assert.equal(json.scenes[0].extras.asre.job, job.id);
    assert.ok(json.meshes[0].primitives[0].attributes.COLOR_0 !== undefined, "vertex colours preserved");
    // coordinate conventions measured: +Y up, standing on the floor, centred
    const conv = conventionsOf(glb);
    assert.equal(conv.standsOnFloor, true, conv.warnings.join("; "));
    assert.equal(conv.centred, true, conv.warnings.join("; "));
    // the existing Forge sees it: library + Cosmos placement
    const meshy = new MeshyForge({ store: forge.store, readEnv: () => undefined });
    const lib = meshy.library().find((a) => a.jobId === forgeId);
    assert.ok(lib && lib.meshValid && lib.kind === "asre");
    const placement = meshy.place({ jobId: forgeId, label: "ASRE vase" });
    assert.equal(placement.file, lib!.model);
    // filing the same thing again returns the same job (idempotent)
    assert.equal(forge.fileReconstruction(job, (rel) => new Uint8Array(readFileSync(path.join(root, rel)))).id, forgeId);
    assert.deepEqual(networkCalls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test("edits make new versions; the source bytes never change; history and a broken import are on the record", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-f-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  try {
    const { forge, job } = await reconstructIntoForge(root, forgeRoot);
    const v1 = forge.store.job(job.result!.forgeJobId!)!;
    const v1file = forge.store.absolute(v1.output!.files.find((f) => f.role === "model")!.file);
    const v1bytes = readFileSync(v1file);
    const v2 = forge.edit(v1.id, { scale: 2, rotateY: Math.PI / 2, tint: [0.5, 1, 1], ground: true, center: true });
    assert.equal(v2.status, "SUCCEEDED");
    assert.equal((v2.request as { parentJobId: string }).parentJobId, v1.id);
    assert.deepEqual(readFileSync(v1file), v1bytes, "v1 untouched");
    const b1 = measureBounds(new Uint8Array(v1bytes))!, b2 = measureBounds(new Uint8Array(readFileSync(forge.store.absolute(v2.output!.files[0].file))))!;
    const h1 = b1.max[1] - b1.min[1], h2 = b2.max[1] - b2.min[1];
    assert.ok(Math.abs(h2 / h1 - 2) < 1e-3, `height doubled: ${h1} → ${h2}`);
    // rotated 90° about Y: x extent becomes the old z extent (×2)
    assert.ok(Math.abs((b2.max[0] - b2.min[0]) - 2 * (b1.max[2] - b1.min[2])) < 1e-3);
    assert.ok(Math.abs(b2.min[1]) < 1e-6, "grounded");
    assert.equal(v2.validation!.verdict.meshValid, true);
    assert.equal(v2.validation!.geometry.triangles, v1.validation!.geometry.triangles, "an edit never changes topology");
    const v3 = forge.edit(v2.id, { translate: [0, 0.5, 0] });
    assert.deepEqual(forge.history(v3.id).map((j) => j.id), [v1.id, v2.id, v3.id]);
    // a failing edit is refused, and nothing is filed
    const before = forge.assets().length;
    assert.throws(() => forge.edit(v3.id, { scale: 0 }), /non-zero/);
    assert.equal(forge.assets().length, before);
    // a broken GLB is filed as rejected with the inspector's reason, and cannot be placed or exported
    const broken = forge.importGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]), "broken.glb");
    assert.equal(broken.status, "rejected");
    assert.ok(broken.error);
    const meshy = new MeshyForge({ store: forge.store, readEnv: () => undefined });
    assert.throws(() => meshy.place({ jobId: broken.id }), /finished/);
    await assert.rejects(() => exportFormats(forge.store, () => undefined, broken.id, {}, { runner: null }), /passed inspection/);
    assert.deepEqual(networkCalls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test("round trip through the Forge's own Blender export gate: export → re-import → inspected valid", async (t) => {
  const runner = blenderRunner();
  if (!runner) return t.skip("Blender is not installed here (services/asre-reconstruct/setup.sh)");
  const root = mkdtempSync(path.join(tmpdir(), "asre-f-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  try {
    const { forge, job } = await reconstructIntoForge(root, forgeRoot);
    const edited = forge.edit(job.result!.forgeJobId!, { tint: [1, 0.6, 0.6] });
    const { job: exported } = await exportFormats(forge.store, () => undefined, edited.id, { formats: ["glb", "obj", "stl"], render: null, targetTris: 0 }, { runner: findBlender(() => undefined) ?? runner, timeoutMs: 300_000 });
    assert.equal(exported.kind, "blender");
    assert.equal(exported.status, "SUCCEEDED");
    assert.equal((exported.request as { parentJobId: string }).parentJobId, edited.id);
    const runtime = exported.output!.files.find((f) => f.role === "model-runtime" || f.file.endsWith("runtime.glb"));
    assert.ok(runtime, `export produced a runtime GLB: ${exported.output!.files.map((f) => f.file).join(", ")}`);
    const bytes = new Uint8Array(readFileSync(forge.store.absolute(runtime!.file)));
    assert.equal(inspectGlb(bytes).verdict.meshValid, true);
    for (const ext of [".obj", ".stl"]) assert.ok(exported.output!.files.some((f) => f.file.endsWith(ext)), `${ext} exported`);
    const back = forge.importGlb(bytes, "runtime.glb");
    assert.equal(back.status, "SUCCEEDED");
    // and it can be edited again
    assert.equal(forge.edit(back.id, { scale: 0.5 }).status, "SUCCEEDED");
    assert.deepEqual(networkCalls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test("HTTP: reconstruct → Forge intake → list/history/edit/import routes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-f-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  const api = createAsreApi(() => undefined, { root, runtime: offline, forgeStore: new ForgeStore(forgeRoot) });
  const handlers: Array<(req: unknown, res: unknown, next: () => void) => void> = [];
  api.attach({ use: (_p, h) => handlers.push(h as never) });
  const server = createServer((req, res) => handlers[0](req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = (p: string) => `http://127.0.0.1:${(server.address() as { port: number }).port}/api/asre${p}`;
  const post = async (p: string, body: unknown) => {
    const r = await fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.headers.get("content-type") !== "application/json") throw new Error(`POST ${p} → ${r.status} without JSON`);
    return r;
  };
  try {
    const started = await (await post("/reconstruct", { images: [{ view: "front", imageBase64: Buffer.from(vase()).toString("base64") }], engine: "silhouette", resolution: 40 })).json();
    assert.equal(started.ok, true, started.error);
    let job = started.job;
    while (!["succeeded", "failed", "cancelled"].includes(job.state)) {
      await new Promise((r) => setTimeout(r, 20));
      job = (await (await fetch(url(`/jobs/${job.id}`))).json()).job;
    }
    assert.equal(job.state, "succeeded", job.error);
    assert.equal((await (await fetch(url("/jobs"))).json()).jobs[0].id, job.id);
    const assets = (await (await fetch(url("/forge"))).json()).assets;
    assert.equal(assets[0].id, job.result.forgeJobId);
    const edited = await (await post(`/forge/${job.result.forgeJobId}/edit`, { edit: { scale: 1.5 } })).json();
    assert.equal(edited.ok, true, edited.error);
    const hist = (await (await fetch(url(`/forge/${edited.job.id}/history`))).json()).history;
    assert.equal(hist.length, 2);
    const glb = editGlb(new Uint8Array(readFileSync(path.join(forgeRoot, edited.job.output.files[0].file))), {});
    const imported = await (await post("/forge/import", { name: "same.glb", glbBase64: Buffer.from(glb).toString("base64") })).json();
    assert.equal(imported.ok, true);
    assert.equal((await post("/forge/import", { name: "bad.glb", glbBase64: "AAAA" })).status, 422);
    assert.equal((await post("/forge/nope/edit", { edit: {} })).status, 404);
    assert.equal((await post(`/jobs/${job.id}/cancel`, {})).status, 409);
    assert.deepEqual(networkCalls, []);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
