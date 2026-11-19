/**
 * LÉLU M25 Complete — contract tests.
 *
 * Provenance and honesty, not looks: the source assets are byte-identical,
 * each look registered in the existing Forge wardrobe points at the bytes that
 * were built, every look carries LÉLU's own head (face shape keys) on the
 * 24-bone skeleton, Outfit A's bag is its own node, paid jobs record their
 * authorisation, and the mouth report shows the cavity was in front of the lips.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const A = path.join(ROOT, "leluverse/assets");
const C = path.join(A, "characters/lelu_character");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function glbJson(file: string): any {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

const EXPECTED_LOOKS = ["camo_repaired", "bronze_velocity", "rose_gold_sovereign", "home_laidback3"];

/** The file each look points at, read from her manifest — never hard-coded. */
function activeLooks(): Record<string, { dir: string; file: string; sha256: string; jobId: string; job: any }> {
  const manifest = json(path.join(C, "manifests/character.json"));
  const ledger = json(path.join(C, "generation_logs/jobs.json"));
  const jobs: any[] = Array.isArray(ledger) ? ledger : ledger.jobs ?? Object.values(ledger);
  const out: Record<string, any> = {};
  for (const look of EXPECTED_LOOKS) {
    const jobId = manifest.active[`look:${look}`];
    const job = jobs.find((j) => j.id === jobId);
    const f = job?.output?.files.find((x: any) => x.role === "model");
    out[look] = { jobId, job, file: f?.file, sha256: f?.sha256, dir: f ? path.basename(path.dirname(f.file)) : "" };
  }
  return out;
}

test("v0003, v0004 and v0005 are untouched", () => {
  assert.equal(sha(path.join(C, "rig/v005_faceshapes_mvwaqbim/lelu.glb")), "80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce");
  assert.equal(sha(path.join(ROOT, "artifacts/foundry/m24/assets/lelu-m24-hair-split.glb")), "6b9bccbe3591a3eecdf624e2965e83490182213f3c7f8dab0bd6e106f5594b18");
  assert.equal(sha(path.join(ROOT, "artifacts/foundry/m25/assets/lelu-m25-visual-fidelity.glb")), "1170e1ff52414be0786e2f280d1717023be26907b135b4e8ec83cfed4207e0ee");
});

test("each look is an approved look slot whose job points at the bytes on disk", () => {
  for (const [look, a] of Object.entries(activeLooks())) {
    assert.ok(a.jobId, `look:${look} approved`);
    assert.ok(a.job && a.job.status === "SUCCEEDED" && a.job.validation?.verdict?.meshValid && a.job.validation?.verdict?.rigValid, `${look} job valid`);
    assert.match(a.file, /^characters\/lelu_character\/meshes\/v\d{3}_look_/);
    assert.equal(sha(path.join(A, a.file)), a.sha256, `${look} bytes match the job record`);
    assert.ok(readFileSync(path.join(A, a.file)).length < 100 * 1024 * 1024);
  }
});

test("every look wears LÉLU's own head with her 12 face shapes on one 24-joint skeleton", () => {
  for (const { dir, file } of Object.values(activeLooks())) {
    const g = glbJson(path.join(A, file));
    assert.equal(g.skins.length, 1, `${dir}: one skeleton`);
    assert.equal(g.skins[0].joints.length, 24, `${dir}: 24 joints`);
    const names = g.nodes.map((n: any) => n.name);
    for (const part of ["lelu_scalp", "lelu_hair", "eye_patch_l", "eye_patch_r", "lelu_mouth"]) assert.ok(names.includes(part), `${dir}: ${part}`);
    const scalp = g.meshes.find((m: any) => g.nodes.some((n: any) => n.name === "lelu_scalp" && g.meshes[n.mesh] === m));
    assert.equal(scalp.primitives[0].targets.length, 12, `${dir}: face shape keys`);
  }
});

test("the coat and catsuit handbags are their own nodes", () => {
  const looks = activeLooks();
  assert.ok(glbJson(path.join(A, looks.bronze_velocity.file)).nodes.some((n: any) => n.name === "bronze_lotus_bag"));
  assert.ok(glbJson(path.join(A, looks.rose_gold_sovereign.file)).nodes.some((n: any) => n.name === "rose_gold_bag"));
});

test("paid Meshy jobs record their authorisation and the checksum of every file kept", () => {
  for (const dir of ["v011_multi-image-to-3d_bronze_velocity", "v013_multi-image-to-3d_rose_gold_sovereign", "v012_image-to-image_rose_gold_sovereign"]) {
    const p = json(path.join(C, "meshes", dir, "provenance.json"));
    const submitted = p.jobs.filter((j: any) => j.submittedAt && ["multi-image-to-3d", "image-to-image"].includes(j.kind));
    assert.ok(submitted.length > 0);
    for (const j of submitted) if (j.kind === "multi-image-to-3d") assert.match(j.authorisation, /user approved/);
    for (const j of p.jobs.filter((x: any) => x.files)) {
      for (const f of j.files) {
        const file = path.join(C, "meshes", dir, f.file);
        if (existsSync(file)) assert.equal(sha(file), f.sha256, `${dir}/${f.file}`);
      }
    }
  }
});

test("the mouth defect is recorded at its source and repaired", () => {
  const r = json(path.join(ROOT, "artifacts/foundry/m25c/mouth/mouth-seat.json"));
  assert.ok(r.objects.lelu_mouth.inFrontOfSkinBefore > 0, "cavity was in front of the lips");
  assert.ok(r.objects.lelu_mouth.moveMm.max < 10, "no runaway moves");
  assert.ok(r.objects.lelu_teeth.rigidShiftMm > 0);
});

test("the asset inventory names what is missing, not only what is present", () => {
  const doc = readFileSync(path.join(ROOT, "docs/missions/M25-COMPLETE-ASSET-INVENTORY.md"), "utf8");
  for (const s of ["v007_image-to-3d_01a195bf", "v009_multi-image-to-3d_01a195c6", "v006_rigging_01a195df", "missing, recoverable"]) assert.ok(doc.includes(s), s);
});
