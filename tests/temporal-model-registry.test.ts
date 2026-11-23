/**
 * TEMPORAL STUDIO — model registry invariants.
 *
 * These tests guard the licensing rules, not the model quality: a registry
 * that quietly admits a non-commercial checkpoint or an access-gated one is
 * worse than no registry at all.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_REGISTRY,
  capabilityById,
  excludedFromCommercialBuild,
  isCommercialEligible,
  isDistributable,
  needsNoAccount,
  selectForTask,
} from "../src/temporal/registry/modelCapability";

test("every entry carries primary sources and a verification date", () => {
  for (const entry of MODEL_REGISTRY) {
    assert.match(entry.repository, /^https:\/\//, `${entry.id} repository must be a URL`);
    assert.ok(entry.verifiedAgainst.length > 0, `${entry.id} has no sources`);
    for (const url of entry.verifiedAgainst) {
      assert.match(url, /^https:\/\//, `${entry.id} source is not a URL: ${url}`);
    }
    assert.match(entry.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} verification date`);
    assert.ok(entry.caveats.length > 0, `${entry.id} records no caveats`);
  }
});

test("ids are unique and resolvable", () => {
  const ids = MODEL_REGISTRY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.equal(capabilityById(id)?.id, id);
  }
  assert.equal(capabilityById("does-not-exist"), undefined);
});

test("non-commercial checkpoints are never commercial-eligible", () => {
  const giant = capabilityById("depth-anything-3-giant");
  assert.ok(giant, "the non-commercial DA3 family must be registered");
  assert.equal(giant.weightsLicence.commercial, "prohibited");
  assert.equal(isCommercialEligible(giant), false);
  assert.equal(isDistributable(giant), false);
});

test("code licence never implies a weights licence", () => {
  // MoGe's code is MIT but its weights are only tagged on the Hub; InstantMesh
  // states nothing for weights at all. Neither may pass as commercial-eligible.
  for (const id of ["moge", "instantmesh"]) {
    const entry = capabilityById(id);
    assert.ok(entry);
    assert.equal(entry.codeLicence.commercial, "permitted");
    assert.equal(entry.weightsLicence.statedForWeights, undefined);
    assert.equal(isCommercialEligible(entry), false, `${id} must not be eligible on a code licence alone`);
  }
});

test("verified MIT weights survive as eligible", () => {
  for (const id of ["triposr", "trellis2", "flux2-klein-4b", "sam2", "ovoxel"]) {
    const entry = capabilityById(id);
    assert.ok(entry, id);
    assert.equal(isCommercialEligible(entry), true, `${id} should be commercially eligible`);
    assert.equal(entry.costClass, "free", `${id} must be free`);
  }
});

test("GPL tooling is usable but not distributable inside the product", () => {
  const comfy = capabilityById("comfyui");
  assert.ok(comfy);
  assert.equal(comfy.codeLicence.commercial, "restricted");
  assert.equal(isDistributable(comfy), false);
});

test("access-gated SAM 3D checkpoints are excluded from a commercial build", () => {
  for (const id of ["sam3d-body", "sam3d-objects"]) {
    const entry = capabilityById(id);
    assert.ok(entry);
    assert.equal(entry.gating, "access-request");
    assert.equal(entry.redistribution, "not-allowed");
    assert.equal(isCommercialEligible(entry), false);
  }
});

test("a CPU-only machine still gets an image-to-3d worker", () => {
  const picks = selectForTask("image-to-3d", { availableVramGb: 0, cpuOnly: true, commercial: true });
  const ids = picks.map((entry) => entry.id);
  assert.ok(ids.includes("triposr"), `expected triposr on CPU, got ${ids.join(", ")}`);
  for (const impossible of ["trellis2", "instantmesh", "sam3d-objects"]) {
    assert.ok(!ids.includes(impossible), `${impossible} cannot run CPU-only`);
  }
});

test("hardware limits are respected when a GPU exists but is small", () => {
  const picks = selectForTask("image-to-3d", { availableVramGb: 8, commercial: true });
  const ids = picks.map((entry) => entry.id);
  assert.ok(!ids.includes("trellis2"), "TRELLIS.2 needs 24 GB");
  assert.ok(!ids.includes("sam3d-objects"), "SAM 3D Objects needs 32 GB");
  assert.ok(ids.includes("triposr"), "TripoSR needs 6 GB");
});

test("a 32 GB GPU admits the heavy workers in cost order", () => {
  const ids = selectForTask("image-to-3d", { availableVramGb: 32, commercial: true }).map((e) => e.id);
  assert.ok(ids.includes("triposr"));
  assert.ok(ids.includes("trellis2"));
});

test("commercial selection never leaks an ineligible entry", () => {
  const ineligible = new Set(excludedFromCommercialBuild().map((entry) => entry.id));
  for (const task of ["depth", "segmentation", "image-to-3d", "human-recon", "image-generation", "registration"] as const) {
    for (const entry of selectForTask(task, { availableVramGb: 80, commercial: true })) {
      assert.ok(!ineligible.has(entry.id), `${entry.id} leaked into a commercial selection for ${task}`);
    }
  }
});

test("free-first: nothing in the registry costs money or requires an account by default", () => {
  for (const entry of MODEL_REGISTRY) {
    assert.equal(entry.costClass, "free", `${entry.id} is not free`);
  }
  assert.equal(needsNoAccount(capabilityById("triposr")!), true);
  assert.equal(needsNoAccount(capabilityById("sam3d-objects")!), false);
});
