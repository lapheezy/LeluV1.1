/**
 * ==========================================================
 * LÉLU 3D FORGE — COAT WEIGHTS + INVENTORY AUDIT
 *
 * CATEGORY: unit. Blender is injected, so these tests check
 * the gate rather than the sculpting: a weighting run that is
 * rigid, unnormalised, partly unweighted or immobile must
 * never reach the wardrobe ledger — whatever the Blender
 * script says about itself.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildGlb } from "./support/glbFixture";
import { inspectGlb } from "../src/core/forge/GlbInspector";
import { checkCoatReport, weightGarment, type CoatWeightsReport } from "../plugins/coatRig";
import { ForgeStore, type ForgeJob } from "../plugins/forgeStore";
import { auditInventory, boneNamesFromGlb, type WardrobeInventory } from "../plugins/wardrobeInventory";
import { buildRecords } from "../plugins/forgeReferences";
import { solidPng } from "../plugins/forgeCrop";

function seedJob(store: ForgeStore, id: string, options: { rigged: boolean }): ForgeJob {
  const bytes = buildGlb({ textured: true, skinned: options.rigged });
  const report = inspectGlb(bytes);
  const dir = store.newVersionDir("hero", options.rigged ? "rig" : "meshes", `image-to-3d_${id}`);
  const file = path.join(dir, "model.glb");
  writeFileSync(file, bytes);
  const job: ForgeJob = {
    id,
    character: "hero",
    kind: "image-to-3d",
    purpose: id,
    request: {},
    requestKey: id,
    estimatedCredits: 30,
    status: "SUCCEEDED",
    meshyTaskId: `task-${id}`,
    progress: 100,
    consumedCredits: 30,
    error: null,
    identityLock: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    submittedAt: Date.now(),
    finishedAt: Date.now(),
    output: { dir: store.relative(dir), files: [{ role: "model", file: store.relative(file), bytes: bytes.byteLength, sha256: "seeded" }] },
    validation: report,
  };
  store.saveJob(job);
  return job;
}

function goodReport(overrides: Partial<CoatWeightsReport> = {}): CoatWeightsReport {
  return {
    ok: true,
    bones: ["Hips", "LeftUpLeg", "RightUpLeg", "Spine01"],
    weights: { unweighted: 0, minSum: 1, maxSum: 1, meanInfluences: 2.4, maxInfluences: 4 },
    deformation: [
      { name: "stand", sampledVertices: 100, maxDisplacement: 0, movedShare: 0, penetratingVertices: 0 },
      { name: "step", sampledVertices: 100, maxDisplacement: 0.11, movedShare: 0.44, penetratingVertices: 2 },
      { name: "turn", sampledVertices: 100, maxDisplacement: 0.06, movedShare: 0.31, penetratingVertices: 0 },
      { name: "sit", sampledVertices: 100, maxDisplacement: 0.2, movedShare: 0.72, penetratingVertices: 3 },
    ],
    problems: [],
    warnings: [],
    ...overrides,
  };
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-coat-"));
  const store = new ForgeStore(root);
  mkdirSync(root, { recursive: true });
  const body = seedJob(store, "fj_body_1", { rigged: true });
  const garment = seedJob(store, "fj_coat_1", { rigged: false });
  return { store, body, garment, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A fake Blender: writes exactly the report and GLB a real run would. */
function fakeBlender(report: CoatWeightsReport) {
  const calls: string[] = [];
  const execute = async (payload: string) => {
    calls.push(payload);
    const { outDir } = JSON.parse(payload) as { outDir: string };
    writeFileSync(path.join(outDir, "lelu.glb"), buildGlb({ textured: true, skinned: true }));
    writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report));
    return { code: 0, log: "fake blender" };
  };
  return { execute, calls };
}

test("a measured binding is recorded as a clothing job, and re-running costs nothing new", async () => {
  const { store, body, garment, cleanup } = setup();
  try {
    const blender = fakeBlender(goodReport());
    const { job, report } = await weightGarment(store, () => undefined, garment.id, body.id, {}, { execute: blender.execute });

    assert.equal(job.kind, "blender");
    assert.equal(job.consumedCredits, 0);
    assert.match(job.output!.dir, /clothing/);
    assert.equal(job.request.bodyJobId, body.id);
    assert.ok(job.output!.files.some((file) => file.role === "model"), "the weighted garment is kept");
    assert.ok(job.output!.files.some((file) => file.role === "coatweights-report"));
    assert.ok((job.validation?.rig.skinnedVertices ?? 0) > 0, "the exported garment really carries skin weights");
    assert.equal(report.weights?.meanInfluences, 2.4);

    const again = await weightGarment(store, () => undefined, garment.id, body.id, {}, { execute: blender.execute });
    assert.equal(again.reused, true);
    assert.equal(again.job.id, job.id);
    assert.equal(blender.calls.length, 1, "the same pair and settings never run Blender twice");
  } finally {
    cleanup();
  }
});

test("a rigid, unweighted, unnormalised or immobile binding never reaches the ledger", async () => {
  const { store, body, garment, cleanup } = setup();
  try {
    const before = store.jobs("hero").length;
    const cases: Array<[string, CoatWeightsReport, RegExp]> = [
      ["unweighted vertices", goodReport({ weights: { unweighted: 12, minSum: 1, maxSum: 1, meanInfluences: 2.4, maxInfluences: 4 } }), /12 vertices are unweighted/],
      ["rigid", goodReport({ weights: { unweighted: 0, minSum: 1, maxSum: 1, meanInfluences: 1, maxInfluences: 4 } }), /rigid/],
      ["unnormalised", goodReport({ weights: { unweighted: 0, minSum: 0.72, maxSum: 1.31, meanInfluences: 2.4, maxInfluences: 4 } }), /not normalised/],
      ["too few bones", goodReport({ bones: ["Hips", "Spine01"] }), /only 2 bones/],
      ["immobile", goodReport({ deformation: [{ name: "stand", sampledVertices: 100, maxDisplacement: 0, movedShare: 0, penetratingVertices: 0 }] }), /posed tests|moved the garment/],
    ];
    for (const [label, report, pattern] of cases) {
      const blender = fakeBlender(report);
      await assert.rejects(
        () => weightGarment(store, () => undefined, garment.id, body.id, { maxInfluences: 4 + cases.indexOf([label, report, pattern] as never) }, { execute: blender.execute }),
        (error: unknown) => {
          assert.equal((error as { status: number }).status, 422, `${label} must be refused, not filed`);
          assert.match(String((error as Error).details), pattern);
          return true;
        },
      );
    }
    assert.equal(store.jobs("hero").length, before, "no rejected run is recorded as an asset");
  } finally {
    cleanup();
  }
});

test("the audit checks bones against her real rig, not against a list of ideals", () => {
  const bytes = buildGlb({ skinned: true });
  const bones = boneNamesFromGlb(bytes);
  assert.ok(bones.includes("Hips") && bones.includes("LeftUpLeg"), "bone names come out of the GLB's own skins");

  const references = buildRecords(
    [{ classification: { id: "photo", sourceName: "photo.png", category: "body", view: "front full-body", outfitVariant: "A", intendedUse: "authority", uses: ["geometry"] }, file: "photo.png", bytes: solidPng(640, 960, [90, 60, 40, 255]) }],
    [],
  );
  const inventory: WardrobeInventory = {
    version: 1,
    character: "hero",
    looks: [
      {
        id: "look_a",
        title: "A",
        authority: ["photo"],
        boards: [],
        assets: [
          { id: "coat", name: "coat", category: "look", slot: "look", references: ["photo"], generation: { kind: "image-to-3d" }, rig: true, isLook: true, inferred: ["rear panels"] },
          { id: "belt", name: "belt", category: "accessory", slot: "belt", bone: "Tail", references: ["photo"], generation: { kind: "image-to-3d" } },
          { id: "bag", name: "bag", category: "bag", slot: "bag", bone: "RightHand", references: ["board_bag"], generation: { kind: "image-to-3d" } },
        ],
      },
    ],
  };

  const { findings, problems } = auditInventory(inventory, references, bones);
  const messages = findings.map((finding) => `${finding.asset}: ${finding.message}`).join("\n");
  assert.match(messages, /belt: bone "Tail" is not in her rig/);
  assert.match(messages, /bag: reference "board_bag" is not ingested/);
  assert.equal(problems, 2);
});
