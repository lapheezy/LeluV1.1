/**
 * LÉLU M25 — contract tests for the visual-fidelity derivative.
 *
 * These check the promises the mission makes about provenance and honesty, not
 * the look: the source assets are byte-identical to their records, v0005 names
 * v0004 as its parent, every metric carries PASS / FAIL / NOT MEASURABLE, the
 * technical and perceptual sections are scored separately, the fifteen views
 * exist as separate files for both versions, and no skinning or shape key was
 * lost. They skip (not pass) when the large binaries are not checked out.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const M25 = path.join(ROOT, "artifacts/foundry/m25");
const STORE = path.join(ROOT, "artifacts/foundry/store/projects/lelu/versions");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

const V3 = path.join(ROOT, "leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb");
const V4 = path.join(ROOT, "artifacts/foundry/m24/assets/lelu-m24-hair-split.glb");
const V5 = path.join(M25, "assets/lelu-m25-visual-fidelity.glb");
const VIEWS = [
  "01-front-face", "02-three-quarter-face", "03-left-profile", "04-right-profile", "05-full-body-front", "06-full-body-rear",
  "07-hairline", "08-crown", "09-ringlet-close-up", "10-skin-close-up", "11-eye-close-up", "12-lip-close-up",
  "13-shoulder-chest", "14-clothing-close-up", "15-jewelry-close-up",
];

test("v0003 and v0004 are byte-identical to their registered checksums", { skip: !existsSync(V3) || !existsSync(V4) }, () => {
  assert.equal(sha(V3), json(path.join(STORE, "v0003/record.json")).model.sha256);
  assert.equal(sha(V4), json(path.join(STORE, "v0004/record.json")).model.sha256);
});

test("v0005 is registered as a child of v0004 with the bytes that were built", { skip: !existsSync(V5) }, () => {
  const record = json(path.join(STORE, "v0005/record.json"));
  assert.equal(record.parentId, "v0004");
  assert.equal(record.spec.parentSha256, json(path.join(STORE, "v0004/record.json")).model.sha256);
  assert.equal(record.model.sha256, sha(V5));
  const build = json(path.join(M25, "hair/build-report.json"));
  assert.equal(build.outputSha256, record.model.sha256);
  assert.equal(build.inputSha256, record.spec.parentSha256);
  assert.ok(record.model.bytes < 100 * 1024 * 1024, "the GLB must stay under GitHub's 100 MiB file limit");
});

test("validation scores technical and perceptual metrics separately with the three allowed verdicts", () => {
  const v = json(path.join(M25, "verification/validation.json"));
  for (const section of ["technical", "perceptual"]) {
    assert.ok(Array.isArray(v[section]) && v[section].length > 0, `${section} section present`);
    for (const m of v[section]) assert.ok(["PASS", "FAIL", "NOT MEASURABLE"].includes(m.verdict), `${m.metric}: ${m.verdict}`);
    const counted = v.summary[section].PASS + v.summary[section].FAIL + v.summary[section]["NOT MEASURABLE"];
    assert.equal(counted, v[section].length);
  }
  const resemblance = v.perceptual.find((m: { metric: string }) => /resemblance/.test(m.metric));
  assert.equal(resemblance?.verdict, "NOT MEASURABLE", "identity is not decided by a number");
});

test("all fifteen acceptance views exist as separate images for both versions at ≥ 64 samples", () => {
  for (const version of ["v0004", "v0005"]) {
    for (const view of VIEWS) {
      const png = path.join(M25, "acceptance", version, `${view}.png`);
      assert.ok(existsSync(png), `${version}/${view}.png`);
      const report = json(`${png}.json`);
      assert.ok(report.samples >= 64, `${version}/${view} rendered at ${report.samples} samples`);
      assert.ok(report.greyCard?.linearValue > 0, `${version}/${view} exposure is grey-card calibrated`);
    }
  }
  // identical camera and lighting between versions, view by view
  for (const view of VIEWS) {
    const a = json(path.join(M25, "acceptance/v0004", `${view}.png.json`));
    const b = json(path.join(M25, "acceptance/v0005", `${view}.png.json`));
    assert.deepEqual(a.camera, b.camera, `${view} camera`);
    assert.equal(a.lighting, b.lighting);
    assert.deepEqual(a.resolution, b.resolution);
  }
});

test("rig regression: no unweighted vertex, at most four influences, shape keys and deltas preserved", () => {
  const rig = json(path.join(M25, "rig/rig-regression.json"));
  assert.ok(rig.bones.identical);
  for (const [name, o] of Object.entries<Record<string, any>>(rig.objects)) {
    assert.equal(o.v0005.unweighted, 0, `${name} unweighted`);
    assert.ok(o.v0005.maxInfluences <= 4, `${name} influences`);
    if (o.v0004) {
      assert.ok(o.shapeKeysIdentical, `${name} shape-key names`);
      for (const [key, d] of Object.entries<Record<string, number>>(o.shapeKeyDeltas ?? {})) assert.ok(d.deltaErrorMaxMm < 0.05, `${name}.${key} delta error ${d.deltaErrorMaxMm} mm`);
    }
  }
  assert.ok(Array.isArray(rig.walkClip) && rig.walkClip.length > 0, "a walk clip was actually played");
  for (const f of rig.walkClip) assert.ok(f.bonesMoved > 0, `frame ${f.frame} moved bones`);
});

test("every required M25 deliverable exists", () => {
  for (const rel of [
    "M25-VISUAL-FIDELITY-RECONSTRUCTION.md", "visual-defect-audit.json", "visual-defect-map.json", "root-cause-report.md",
    "topology/topology-audit.json", "topology/normal-validation.json", "topology/repair-report.json",
    "hair/hair-reconstruction.json", "hair/curl-validation.json", "materials/skin-material-audit.json", "materials/texture-audit.json",
    "anatomy/facial-landmarks.json", "rig/rig-regression.json", "verification/validation.json", "verification/checksums.json",
  ]) assert.ok(existsSync(path.join(M25, rel)), rel);
});
