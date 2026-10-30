/**
 * ==========================================================
 * LÉLU 3D FORGE — THE PIPELINE
 *
 * CATEGORY: integration. The real store, the real service,
 * the real HTTP surface, real fetch over real sockets. The
 * one thing substituted is Meshy itself: a local HTTP server
 * that speaks the documented task protocol and records every
 * request, so the tests can assert what matters —
 *
 *   - no credit is spent without approval, and never twice
 *   - an ambiguous create is never silently retried
 *   - the key goes to the API host and nowhere else
 *   - outputs are versioned, inspected, and only promoted
 *     to a slot when the inspection proves they fit it
 *   - the identity lock cannot be bypassed
 *
 * The GLBs it serves are real glTF binaries (support/glbFixture.ts).
 * ==========================================================
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildGlb, tinyPng } from "./support/glbFixture";
import { KEY, startFakeMeshy, type FakeMeshy } from "./support/fakeMeshy";
import { inspectGlb } from "../src/core/forge/GlbInspector";
import { estimateCredits, validateRequest } from "../src/core/forge/MeshyCatalog";
import { buildRecords, measureImage } from "../plugins/forgeReferences";
import { ForgeStore } from "../plugins/forgeStore";
import { MeshyForge } from "../plugins/meshyForge";
import { createMeshyForgeApi } from "../plugins/meshyForgeApi";

/* -------------------------------- harness ------------------------------- */

function setup(fake: FakeMeshy, env: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-forge-"));
  const store = new ForgeStore(root);
  const vars: Record<string, string> = { MESHY_API_KEY: KEY, MESHY_API_URL: fake.base, ...env };
  const forge = new MeshyForge({ store, readEnv: (n) => vars[n], sleep: async () => {} });
  // One ingested reference and an identity lock, as Phase B/C leaves them.
  const bytes = tinyPng(16, 24);
  const [record] = buildRecords([
    {
      classification: { id: "front", sourceName: "front.png", category: "body", view: "front full-body", outfitVariant: "B", intendedUse: "base", uses: ["geometry", "texture"] },
      file: "",
      bytes,
    },
  ]);
  record.file = store.relative(store.storeReferenceFile("hero", "front", ".png", bytes));
  store.saveReferences("hero", [record]);
  store.lockIdentity("hero", { primary: "front", secondary: [], preserve: { face: "x" }, mayChange: [], rule: "locked" });
  return { root, store, forge, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const BASE_REQUEST = {
  character: "hero",
  kind: "image-to-3d",
  purpose: "base character",
  body: { image_url: "ref:front", ai_model: "meshy-7.1", should_texture: true, pose_mode: "a-pose", target_formats: ["glb", "fbx"] },
};

const creates = (fake: FakeMeshy) => fake.seen.filter((s) => s.method === "POST");

/* --------------------------------- tests -------------------------------- */

test("catalog: undocumented parameters and impossible combinations are refused before any call", () => {
  assert.deepEqual(validateRequest("image-to-3d", { image_url: "x" }), []);
  assert.match(validateRequest("image-to-3d", { image_url: "x", face_lock: true }).join(), /face_lock/);
  assert.match(validateRequest("multi-image-to-3d", { image_urls: ["a", "b", "c", "d", "e"] }).join(), /1–4/);
  assert.match(validateRequest("animation", { rig_task_id: "r", action_id: 1, action_ids: [2] }).join(), /exactly one/);
  assert.match(validateRequest("rigging", {}).join(), /input_task_id or model_url/);
  assert.equal(estimateCredits("image-to-3d", { ai_model: "meshy-7.1" }), 30);
  assert.equal(estimateCredits("image-to-3d", { ai_model: "meshy-7.1", geometry_resolution: "2k" }), 35);
  assert.equal(estimateCredits("multi-image-to-3d", { ai_model: "meshy-6-lite", should_texture: false }), 5);
  assert.equal(estimateCredits("animation", { action_ids: [1, 2, 3] }), 9);
  assert.equal(estimateCredits("rigging", {}), 5);
});

test("inspector: measures geometry, texture, skin weights, humanoid bones and clips from real GLB bytes", () => {
  const plain = inspectGlb(buildGlb({ textured: true }));
  assert.equal(plain.ok, true);
  assert.equal(plain.verdict.meshValid, true);
  assert.equal(plain.verdict.textured, true);
  assert.equal(plain.verdict.rigValid, false);
  assert.equal(plain.geometry.triangles, 1);
  assert.deepEqual(plain.geometry.bounds?.size.map((v) => Math.round(v * 10) / 10), [1, 1.7, 0]);

  const rigged = inspectGlb(buildGlb({ skinned: true, animated: true }));
  assert.equal(rigged.rig.joints, 16);
  assert.deepEqual(rigged.rig.humanoidBonesMissing, []);
  assert.equal(rigged.rig.weightValidity, 1);
  assert.equal(rigged.verdict.rigValid, true);
  assert.equal(rigged.verdict.animated, true);
  assert.equal(rigged.motion.clips[0].duration, 1.25);

  const broken = inspectGlb(buildGlb({ skinned: true, brokenWeights: true }));
  assert.equal(broken.verdict.rigValid, false);
  assert.match(broken.problems.join(), /normalized/);

  const partial = inspectGlb(buildGlb({ skinned: true, bones: ["Hips", "Spine", "Head", "LeftForeArm", "LeftUpperLeg", "Neck"] }));
  assert.equal(partial.verdict.rigValid, false, "a skeleton missing limbs is not a humanoid rig");
  assert.ok(partial.rig.humanoidBonesMissing.includes("leftUpperArm"), "a forearm is not an upper arm");
  assert.ok(partial.rig.humanoidBonesMissing.includes("leftLowerLeg"), "an upper leg is not a lower leg");

  assert.equal(inspectGlb(new Uint8Array(64)).ok, false);
});

test("references: exact and near duplicates are detected; metrics come from decoded pixels", () => {
  const a = tinyPng(64, 96, [10, 200, 30]);
  const b = tinyPng(64, 96, [12, 201, 31]);
  const records = buildRecords([
    { classification: { id: "a", sourceName: "a.png", category: "body", view: "front full-body", outfitVariant: "x", intendedUse: "", uses: ["geometry"] }, file: "", bytes: a },
    { classification: { id: "a2", sourceName: "a2.png", category: "body", view: "front full-body", outfitVariant: "x", intendedUse: "", uses: ["geometry"] }, file: "", bytes: a },
    { classification: { id: "b", sourceName: "b.png", category: "body", view: "side", outfitVariant: "x", intendedUse: "", uses: ["design"] }, file: "", bytes: b },
  ]);
  assert.equal(records[1].duplicateOf, "a");
  assert.equal(records[2].nearDuplicateOf, "a");
  assert.equal(records[2].reconstructionSuitability, "not-for-geometry");
  const m = measureImage(a);
  assert.equal(m.width, 64);
  assert.equal(m.height, 96);
  assert.match(m.dhash ?? "", /^[0-9a-f]{16}$/);
});

test("no credit is spent until approval, and the same request is never paid for twice", async () => {
  const fake = await startFakeMeshy();
  const { forge, cleanup } = setup(fake);
  try {
    const planned = await forge.request(BASE_REQUEST);
    assert.equal(planned.job.status, "awaiting_approval");
    assert.equal(planned.job.estimatedCredits, 30);
    assert.equal(creates(fake).length, 0, "planning must not call Meshy's create endpoint");

    const submitted = await forge.approve(planned.job.id);
    assert.equal(submitted.status, "PENDING");
    assert.equal(submitted.meshyTaskId, "task-1");
    const post = creates(fake)[0];
    assert.equal(post.auth, `Bearer ${KEY}`);
    const sent = JSON.parse(post.body) as Record<string, string>;
    assert.match(sent.image_url, /^data:image\/png;base64,/, "ref: handles resolve to the stored original");
    assert.equal(submitted.request.image_url, "ref:front", "the ledger keeps the handle, not the bytes");

    const again = await forge.request({ ...BASE_REQUEST, approve: true });
    assert.equal(again.reused, true);
    assert.equal(again.job.id, planned.job.id);
    assert.equal(creates(fake).length, 1, "a repeated request must not create a second task");
  } finally {
    cleanup();
    await fake.close();
  }
});

test("progress, versioned downloads, inspection, and slot promotion gated by what the inspection proved", async () => {
  const fake = await startFakeMeshy();
  const { forge, store, root, cleanup } = setup(fake);
  try {
    const { job } = await forge.request({ ...BASE_REQUEST, approve: true });
    const running = await forge.refresh(job.id);
    assert.equal(running.status, "IN_PROGRESS");
    assert.equal(running.progress, 40);
    assert.equal(running.output, null);

    const done = await forge.refresh(job.id);
    assert.equal(done.status, "SUCCEEDED");
    assert.equal(done.consumedCredits, 30);
    assert.match(done.output?.dir ?? "", /^characters\/hero\/meshes\/v001_image-to-3d_task-1$/);
    const roles = done.output?.files.map((f) => f.role).sort();
    assert.deepEqual(roles, ["model", "model-fbx", "preview", "preview", "provenance", "texture:base_color", "view:back", "view:front"]);
    const provenance = JSON.parse(readFileSync(path.join(root, done.output!.files.find((f) => f.role === "provenance")!.file), "utf8"));
    assert.equal(provenance.meshyTaskId, "task-1");
    assert.deepEqual(provenance.references.map((r: { id: string }) => r.id), ["front"]);
    assert.equal(provenance.references[0].sha256, store.references("hero")[0].metrics.sha256);
    assert.equal(provenance.identityLock, store.identity("hero")!.lockHash);
    const model = done.output!.files.find((f) => f.role === "model")!;
    assert.deepEqual(new Uint8Array(readFileSync(path.join(root, model.file))), fake.glb);
    assert.equal(done.validation?.verdict.meshValid, true);

    const downloads = fake.seen.filter((s) => s.url.startsWith("/assets/"));
    assert.ok(downloads.length >= 3);
    assert.ok(downloads.every((d) => d.auth === undefined), "the API key must never be sent to an asset host");

    // A finished job is read once; refreshing it again costs nothing upstream.
    const before = fake.seen.length;
    await forge.refresh(job.id);
    assert.equal(fake.seen.length, before);

    forge.approveSlot("hero", "base", job.id);
    assert.throws(() => forge.approveSlot("hero", "rig", job.id), /not fit for slot rig/);

    const rig = await forge.request({ character: "hero", kind: "rigging", body: { input_task_id: "task-1", height_meters: 1.75 }, approve: true });
    await forge.refresh(rig.job.id);
    const rigged = await forge.refresh(rig.job.id);
    assert.equal(rigged.validation?.verdict.rigValid, true);
    assert.match(rigged.output?.dir ?? "", /characters\/hero\/rig\/v001_rigging_task-2/);
    assert.ok(rigged.output?.files.some((f) => f.role === "animation" && f.file.endsWith("walking_glb.glb")));
    forge.approveSlot("hero", "rig", rig.job.id);

    const active = forge.activeCharacter("hero");
    assert.equal(active.model?.jobId, rig.job.id, "a validated rig is preferred over the bare mesh");
    assert.equal(store.manifest("hero").history.length, 2);
    assert.equal(store.usage("hero").consumedCredits, 35);
  } finally {
    cleanup();
    await fake.close();
  }
});

test("a refused create is retried; an ambiguous one is never resubmitted without a person", async () => {
  const fake = await startFakeMeshy();
  const { forge, cleanup } = setup(fake);
  try {
    fake.createFailures.push(429, 503);
    const { job } = await forge.request({ ...BASE_REQUEST, approve: true });
    assert.equal(job.status, "PENDING");
    assert.equal(creates(fake).length, 3, "two explicit refusals, then one created task");

    fake.dropNextCreate = true;
    const other = await forge.request({ ...BASE_REQUEST, body: { ...BASE_REQUEST.body, pose_mode: "t-pose" }, approve: true });
    assert.equal(other.job.status, "submit_uncertain");
    const attempts = creates(fake).length;
    await assert.rejects(forge.approve(other.job.id), /may already exist/);
    assert.equal(creates(fake).length, attempts, "no automatic resubmission after an ambiguous failure");
    const resubmitted = await forge.approve(other.job.id, { resubmitUncertain: true });
    assert.equal(resubmitted.status, "PENDING");
  } finally {
    cleanup();
    await fake.close();
  }
});

test("insufficient credits block submission; a tampered identity blocks generation", async () => {
  const fake = await startFakeMeshy();
  const { forge, store, root, cleanup } = setup(fake);
  try {
    fake.balance = 10;
    const { job } = await forge.request({ ...BASE_REQUEST, approve: true });
    assert.equal(job.status, "awaiting_approval");
    assert.match(job.error ?? "", /Insufficient Meshy credits: 10 available, 30 needed/);
    assert.equal(creates(fake).length, 0);

    const lock = store.identity("hero")!;
    writeFileSync(path.join(root, lock.references[0].file), Buffer.from(tinyPng(4, 4, [1, 2, 3])));
    await assert.rejects(forge.request({ ...BASE_REQUEST, body: { ...BASE_REQUEST.body, pose_mode: "" } }), /Identity lock is broken/);
    assert.throws(
      () => store.lockIdentity("hero", { primary: "front", secondary: [], preserve: { face: "changed" }, mayChange: [], rule: "" }),
      /needs explicit approval/,
    );
  } finally {
    cleanup();
    await fake.close();
  }
});

test("HTTP surface: no key leaks, writes refuse cross-origin, assets cannot escape the root", async () => {
  const fake = await startFakeMeshy();
  const root = mkdtempSync(path.join(tmpdir(), "lelu-forge-http-"));
  const api = createMeshyForgeApi((n) => ({ MESHY_API_KEY: KEY, MESHY_API_URL: fake.base })[n], { assetRoot: root, poll: false });
  const handlers: Array<(req: unknown, res: unknown, next: () => void) => void> = [];
  api.attach({ use: (_p, h) => handlers.push(h as never) });
  const server = createServer((req, res) => handlers[0](req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = (p: string) => `http://127.0.0.1:${port}/api/forge${p}`;
  try {
    const status = await (await fetch(url("/status"))).text();
    assert.ok(!status.includes(KEY), "status must not contain the key");
    assert.equal(JSON.parse(status).credential, "MESHY_API_KEY");

    const crossOrigin = await fetch(url("/jobs"), {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify(BASE_REQUEST),
    });
    assert.equal(crossOrigin.status, 403);

    const upload = await fetch(url("/characters/hero/references"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "front", dataUrl: `data:image/png;base64,${Buffer.from(tinyPng(8, 8)).toString("base64")}`, classification: { view: "front full-body" } }),
    });
    assert.equal(upload.status, 201);
    const planned = await fetch(url("/jobs"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(BASE_REQUEST) });
    const plannedBody = (await planned.json()) as { job: { status: string; id: string } };
    assert.equal(plannedBody.job.status, "awaiting_approval");
    assert.equal(creates(fake).length, 0);

    const bad = await fetch(url("/jobs"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...BASE_REQUEST, body: { image_url: "ref:front", unicorn: 1 } }) });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(await bad.json()), /unicorn/);

    const traversal = await fetch(url("/assets/..%2F..%2Fetc%2Fpasswd"));
    assert.equal(traversal.status, 404);
    assert.ok(existsSync(path.join(root, "characters", "hero", "references", "front.png")));
    const asset = await fetch(url("/assets/characters/hero/references/front.png"));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "image/png");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
    await fake.close();
  }
});

test("without a key the Forge says exactly what is missing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-forge-nokey-"));
  try {
    const forge = new MeshyForge({ store: new ForgeStore(root), readEnv: () => undefined });
    assert.equal(forge.configured(), false);
    const bytes = tinyPng(8, 8);
    const [record] = buildRecords([{ classification: { id: "front", sourceName: "f.png", category: "body", view: "front full-body", outfitVariant: "x", intendedUse: "", uses: ["geometry"] }, file: "", bytes }]);
    record.file = forge.store.relative(forge.store.storeReferenceFile("hero", "front", ".png", bytes));
    forge.store.saveReferences("hero", [record]);
    const { job } = await forge.request(BASE_REQUEST);
    assert.equal(job.status, "awaiting_approval", "planning works without a key");
    await assert.rejects(forge.approve(job.id), /MESHY_API_KEY is not set on the server/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finished assets are placed in the Cosmos, persist, and can be removed without deleting the asset", async () => {
  const fake = await startFakeMeshy();
  const { forge, store, root, cleanup } = setup(fake);
  try {
    const { job } = await forge.request({ ...BASE_REQUEST, approve: true });
    assert.throws(() => forge.place({ jobId: job.id }), /Only a finished, downloaded job/);
    await forge.refresh(job.id);
    await forge.refresh(job.id);

    const placed = forge.place({ jobId: job.id, label: "LÉLU v1", position: [1, -2.55, 2], height: 2.56 });
    assert.deepEqual(placed.position, [1, -2.55, 2]);
    assert.equal(placed.file, job.id && store.job(job.id)!.output!.files.find((f) => f.role === "model")!.file);
    const auto = forge.place({ jobId: job.id, position: "nonsense" });
    assert.equal(auto.position[1], -2.55, "default placements stand on LÉLU's floor");

    // A new store over the same root is a restart: the placements are still there.
    assert.equal(new ForgeStore(root).placements().length, 2);
    assert.equal(forge.library().length, 1);

    forge.unplace(placed.id);
    assert.deepEqual(store.placements().map((p) => p.id), [auto.id]);
    assert.ok(existsSync(path.join(root, placed.file)), "removing a placement never deletes the asset");
    assert.throws(() => forge.unplace("pl_missing"), /No placement/);
  } finally {
    cleanup();
    await fake.close();
  }
});

test("multi-image-to-3d requests are checked against the documented limits", () => {
  const good = { image_urls: ["ref:a", "ref:b", "ref:c"], ai_model: "meshy-7.1", geometry_resolution: "standard", enable_pbr: true, texture_resolution: "2k", pose_mode: "a-pose", should_remesh: true, target_polycount: 60000, save_pre_remeshed_model: true, image_enhancement: false, target_formats: ["glb", "fbx"], multi_view_thumbnails: true };
  assert.deepEqual(validateRequest("multi-image-to-3d", good), []);
  assert.equal(estimateCredits("multi-image-to-3d", good), 30);
  assert.equal(estimateCredits("multi-image-to-3d", { ...good, geometry_resolution: "2k" }), 35, "2K Ultra geometry is a separate +5");
  assert.match(validateRequest("multi-image-to-3d", { ...good, geometry_resolution: "4k" }).join(), /not "4k"/);
  assert.match(validateRequest("multi-image-to-3d", { ...good, image_urls: ["1", "2", "3", "4", "5"] }).join(), /1–4 image_urls/);
  assert.match(validateRequest("multi-image-to-3d", { ...good, should_texture: false }).join(), /enable_pbr needs should_texture/);
});
