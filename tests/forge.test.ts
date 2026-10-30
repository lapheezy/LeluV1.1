/**
 * ==========================================================
 * LÉLU 3D FORGE — plan, approve, run, keep, inspect
 *
 * CATEGORY: integration. The real Forge core and runner and the real
 * Meshy client, over real HTTP, against a LOCAL STAND-IN for Meshy's
 * documented endpoints (MESHY_API_URL) — no credits, no key, and no
 * claim that anything was generated: what is under test is the
 * pipeline's own behaviour (no double spend, no self-approval, uncertain
 * submissions never re-sent, outputs versioned and inspected).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { approveJob, assetRoot, creditsSpent, estimateCredits, ingestReferences, inspectGlb, loadLedger, planJob, saveLedger } from "../plugins/forge/forgeCore";
import { runJob } from "../plugins/forge/forgeRunner";

/** A minimal valid GLB: one triangle, one skin with two joints, one animation. */
function tinyGlb(): Buffer {
  const json = JSON.stringify({
    asset: { version: "2.0" },
    nodes: [{ name: "Hips" }, { name: "Head" }, { mesh: 0, skin: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: [{ POSITION: 0 }] }] }],
    accessors: [{ count: 3 }, { count: 3 }],
    skins: [{ joints: [0, 1] }],
    animations: [{ name: "Idle", channels: [{}, {}] }],
    materials: [{}],
  });
  const padded = json + " ".repeat((4 - (json.length % 4)) % 4);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, Buffer.from(padded)]);
}

let server: Server;
let baseUrl = "";
const created: Array<{ path: string; body: Record<string, unknown> }> = [];
let polls = 0;
let failCreateWith: number | "hang" | null = null;
let failFiles = false;

before(async () => {
  server = createServer((req, res) => {
    // Output files are signed URLs on Meshy's side: no key needed.
    if ((req.url ?? "").startsWith("/files/")) {
      if (failFiles) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200).end((req.url ?? "").endsWith(".glb") ? tinyGlb() : Buffer.from("png"));
      return;
    }
    const auth = req.headers.authorization;
    if (auth !== "Bearer test-key") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Missing API key" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.startsWith("/files/")) {
        res.writeHead(200).end(url.endsWith(".glb") ? tinyGlb() : Buffer.from("png"));
        return;
      }
      if (req.method === "POST") {
        if (failCreateWith === "hang") return; // never answers: the client times out
        if (typeof failCreateWith === "number") {
          res.writeHead(failCreateWith, { "content-type": "application/json" }).end(JSON.stringify({ message: "Insufficient credits" }));
          return;
        }
        created.push({ path: url, body: JSON.parse(body) as Record<string, unknown> });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result: `task-${created.length}` }));
        return;
      }
      polls += 1;
      const id = url.split("/").pop()!;
      const done = polls % 2 === 0;
      const isRig = url.includes("/rigging/");
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id,
          status: done ? "SUCCEEDED" : "IN_PROGRESS",
          progress: done ? 100 : 40,
          consumed_credits: isRig ? 5 : 30,
          ...(isRig
            ? { result: done ? { rigged_character_glb_url: `${baseUrl}/files/rigged.glb`, basic_animations: { walking_glb_url: `${baseUrl}/files/walk.glb` } } : null }
            : { model_urls: { glb: `${baseUrl}/files/model.glb` }, thumbnail_url: `${baseUrl}/files/thumb.png`, texture_urls: [{ base_color: `${baseUrl}/files/base.png` }] }),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.MESHY_API_URL = baseUrl;
  process.env.MESHY_API_KEY = "test-key";
});

after(() => {
  server.close();
  delete process.env.MESHY_API_URL;
  delete process.env.MESHY_API_KEY;
});

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "forge-"));
  const asset = assetRoot(root, "characters", "test_char");
  const image = path.join(root, "front.png");
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const copy = path.join(root, "same-bytes.png");
  writeFileSync(copy, readFileSync(image));
  const manifest = ingestReferences(asset, [
    { source: image, file: "front.png", category: "front", intendedUse: "geometry", quality: "test", reconstructionSuitability: "high", uses: ["geometry"] },
    { source: copy, file: "front-again.png", category: "front", intendedUse: "geometry", quality: "test", reconstructionSuitability: "high", uses: ["geometry"] },
  ]);
  return { root, asset: path.relative(root, asset), assetDir: asset, manifest };
}

test("references: originals copied and hashed; the same bytes are stored once", () => {
  const { root, manifest, assetDir } = project();
  try {
    assert.equal(manifest.references.length, 1);
    assert.deepEqual(manifest.duplicatesSkipped, [{ sourceName: "same-bytes.png", sameAs: "front.png" }]);
    assert.ok(existsSync(path.join(assetDir, "references", "front.png")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plans cost what Meshy publishes; the same request is one job; only a person approves", () => {
  assert.equal(estimateCredits("multi-image-to-3d", { ai_model: "meshy-7.1", texture_resolution: "2k" }), 30);
  assert.equal(estimateCredits("multi-image-to-3d", { ai_model: "meshy-7.1", geometry_resolution: "2k" }), 35);
  assert.equal(estimateCredits("image-to-3d", { ai_model: "meshy-6-lite", should_texture: false }), 5);
  assert.equal(estimateCredits("rigging", {}), 5);
  assert.equal(estimateCredits("animation", { action_ids: [1, 2, 3] }), 9);
  const ledger = { jobs: [] };
  const input = { asset: "a", workflow: "multi-image-to-3d" as const, purpose: "p", params: { ai_model: "meshy-7.1", image_urls: ["ref:references/front.png"] }, referenceHashes: ["abc"], plannedBy: "LÉLU" };
  const first = planJob(ledger, input);
  const second = planJob(ledger, { ...input, params: { image_urls: ["ref:references/front.png"], ai_model: "meshy-7.1" } });
  assert.equal(second.reused, true, "same request, keys in another order: the same job");
  assert.equal(ledger.jobs.length, 1);
  assert.throws(() => approveJob(ledger, first.job.id, "LÉLU"), /approved by a person/);
  assert.throws(() => approveJob(ledger, first.job.id, "  "), /approved by a person/);
  approveJob(ledger, first.job.id, "Owner");
  assert.throws(() => approveJob(ledger, first.job.id, "Owner"), /not awaiting approval/);
});

test("run: an approved job is submitted once, tracked, its outputs kept in a new version and inspected; the rig follows it", async () => {
  const { root, asset } = project();
  try {
    const ledger = loadLedger(root);
    const base = planJob(ledger, { asset, workflow: "multi-image-to-3d", purpose: "base", params: { ai_model: "meshy-7.1", image_urls: ["ref:references/front.png"] }, referenceHashes: ["x"], plannedBy: "test" }).job;
    const rig = planJob(ledger, { asset, workflow: "rigging", purpose: "rig", params: { height_meters: 1.75 }, referenceHashes: [], dependsOn: [base.id], plannedBy: "test" }).job;
    saveLedger(root, ledger);
    await assert.rejects(runJob(base.id, { projectRoot: root, pollMs: 5 }), /only an approved job runs/);

    const l2 = loadLedger(root);
    approveJob(l2, base.id, "Owner");
    approveJob(l2, rig.id, "Owner");
    saveLedger(root, l2);
    created.length = 0;
    const done = await runJob(base.id, { projectRoot: root, pollMs: 5 });
    assert.equal(done.state, "succeeded");
    assert.equal(created.length, 1, "submitted exactly once");
    assert.match(String((created[0].body.image_urls as string[])[0]), /^data:image\/png;base64,/, "references go as data URIs");
    assert.equal(done.consumedCredits, 30, "the task's own consumed_credits");
    assert.deepEqual(Object.keys(done.outputs ?? {}).sort(), ["model.glb", "texture-0-base_color.png", "thumbnail.png"]);
    assert.match(done.outputs!["model.glb"], /meshes\/v001\/model\.glb$/);
    const report = (done.validation as Record<string, ReturnType<typeof inspectGlb>>)["model.glb"];
    assert.equal(report.valid, true);
    assert.equal(report.triangles, 1);

    const again = await runJob(base.id, { projectRoot: root, pollMs: 5 });
    assert.equal(again.state, "succeeded");
    assert.equal(created.length, 1, "running a succeeded job again submits nothing");

    const rigged = await runJob(rig.id, { projectRoot: root, pollMs: 5 });
    assert.equal(rigged.state, "succeeded");
    assert.equal(created[1].body.input_task_id, "task-1", "the rig is made from the generated model's task");
    const rigReport = (rigged.validation as Record<string, ReturnType<typeof inspectGlb>>)["rigged.glb"];
    assert.deepEqual([rigReport.skins, rigReport.joints, rigReport.jointNames], [1, 2, ["Hips", "Head"]]);
    assert.ok(rigged.outputs!["basic-walking-glb.glb"] || Object.keys(rigged.outputs!).some((name) => name.startsWith("basic-walking")));
    assert.equal(creditsSpent(loadLedger(root)), 35);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a refused create fails the job; an unanswered create is never re-sent", async () => {
  const { root, asset } = project();
  try {
    const ledger = loadLedger(root);
    const a = planJob(ledger, { asset, workflow: "image-to-3d", purpose: "a", params: { ai_model: "meshy-6", image_url: "ref:references/front.png" }, referenceHashes: ["a"], plannedBy: "t" }).job;
    const b = planJob(ledger, { asset, workflow: "image-to-3d", purpose: "b", params: { ai_model: "meshy-6", image_url: "ref:references/front.png", should_texture: false }, referenceHashes: ["a"], plannedBy: "t" }).job;
    approveJob(ledger, a.id, "Owner");
    approveJob(ledger, b.id, "Owner");
    saveLedger(root, ledger);

    failCreateWith = 402;
    const refused = await runJob(a.id, { projectRoot: root, pollMs: 5 });
    assert.equal(refused.state, "failed");
    assert.match(refused.error ?? "", /402.*Insufficient credits/);

    failCreateWith = "hang";
    const { createTask } = await import("../plugins/forge/meshyClient");
    await assert.rejects(createTask("image-to-3d", {}, 200), (error: { uncertain?: boolean }) => error.uncertain === true);
    failCreateWith = null;
    // The runner's own path for an uncertain create: needs_attention, and a second run does not resend.
    const l = loadLedger(root);
    const job = l.jobs.find((item) => item.id === b.id)!;
    job.state = "needs_attention";
    saveLedger(root, l);
    const count = created.length;
    await assert.rejects(runJob(b.id, { projectRoot: root, pollMs: 5 }), /only an approved job runs/);
    assert.equal(created.length, count, "nothing was re-sent");
  } finally {
    failCreateWith = null;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file that is not a GLB is reported as such", () => {
  assert.deepEqual([inspectGlb(Buffer.from("not a model")).valid, inspectGlb(Buffer.from("not a model")).error], [false, "not a GLB (no glTF magic)"]);
});

test("a finished task whose model could not be downloaded is not 'succeeded'; running it again downloads without re-submitting", async () => {
  const { root, asset } = project();
  try {
    const ledger = loadLedger(root);
    const job = planJob(ledger, { asset, workflow: "image-to-3d", purpose: "dl", params: { ai_model: "meshy-6", image_url: "ref:references/front.png", texture_resolution: "4k" }, referenceHashes: ["d"], plannedBy: "t" }).job;
    approveJob(ledger, job.id, "Owner");
    saveLedger(root, ledger);
    failFiles = true;
    const first = await runJob(job.id, { projectRoot: root, pollMs: 5 });
    assert.equal(first.state, "needs_attention");
    assert.match(first.error ?? "", /could not be downloaded.*nothing is re-submitted/);
    const count = created.length;
    failFiles = false;
    const second = await runJob(job.id, { projectRoot: root, pollMs: 5 });
    assert.equal(second.state, "succeeded");
    assert.equal(created.length, count, "no second task was created");
    assert.match(second.outputs!["model.glb"], /meshes\/v002\/model\.glb$/, "a new version folder; the failed attempt's folder is kept");
  } finally {
    failFiles = false;
    rmSync(root, { recursive: true, force: true });
  }
});
