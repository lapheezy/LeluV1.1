/**
 * LÉLU CHARACTER FOUNDRY — tests.
 *
 * These are contract tests, not screenshots: the licence matrix must refuse what
 * the mission forbids, the planner must refuse a GPU job on a GPU-less machine,
 * the comparison must report the hairline defect rather than the target it was
 * derived from, versions must be immutable, and the pipeline must not validate a
 * run that was never rendered.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { describeHardware, planExecution, summariseHardware } from "../src/core/asre/foundry/capabilities";
import { TECHNOLOGIES, auditLicences, chooseEngine, technologyBrief } from "../src/core/asre/foundry/technologies";
import { buildReferenceLibrary, describeLibrary, type ReferenceManifest } from "../src/core/asre/foundry/references";
import { planShots } from "../src/core/asre/foundry/shots";
import { compareLandmarks, compareRenderToReference, histogramDistance, colourHistogram, maskFromImage, silhouetteIou } from "../src/core/asre/foundry/compare";
import { addVersion, createProject, listVersions, modelPath, readVersion, recordRender, restoreVersion, verifyProject } from "../src/core/asre/foundry/project";
import { assessRun, runFoundryPipeline, FOUNDRY_STEPS } from "../src/core/asre/foundry/pipeline";
import { interpretFoundryIntent, shotsForIntent } from "../src/core/asre/foundry/intents";
import { FOUNDRY_TOOLS, FOUNDRY_EXECUTORS } from "../src/core/asre/foundry/FoundryTools";
import type { RgbaImage } from "../src/core/asre/image/png";
import { FOUNDRY_RENDER_SCRIPT } from "../src/core/asre/foundry/render";
import { inspectGlb } from "../src/core/asre/foundry/meshy";
import { authorityFor, locateSources } from "../src/core/asre/foundry/sources";
import { reconcile } from "../src/core/asre/foundry/reconcile";

const ROOT = process.cwd();
const metrics = JSON.parse(readFileSync(path.join(ROOT, "artifacts/lelu2/m23/youth/metrics-youth.json"), "utf8")) as Record<string, unknown>;
const hair = JSON.parse(readFileSync(path.join(ROOT, "artifacts/lelu2/m23/youth/baby-hair-youth.json"), "utf8")) as Record<string, unknown>;

function square(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

/* ---------------------------------- licences --------------------------------- */

test("the licence matrix refuses the engines the mission's rules forbid", () => {
  const audit = auditLicences();
  assert.equal(audit.violations.length, 0, `no adopted engine may be restricted, gated or copyleft: ${audit.violations.join("; ")}`);
  for (const record of TECHNOLOGIES) {
    if (record.decision === "reject") continue;
    assert.equal(record.commercial, "yes", `${record.id} is ${record.decision} but commercial=${record.commercial}`);
    assert.equal(record.account, false, `${record.id} is ${record.decision} but needs an account`);
  }
});

test("HumanNOVA is rejected for having no licence at all", () => {
  const humanova = TECHNOLOGIES.find((t) => t.id === "humannova");
  assert.ok(humanova);
  assert.equal(humanova.decision, "reject");
  assert.match(humanova.codeLicense, /none/i);
  assert.match(humanova.reasons.join(" "), /LICENSE file/i);
});

test("a GPU-only engine is never chosen on a machine without a GPU", () => {
  const human = chooseEngine("human-from-photos", false);
  assert.equal(human.chosen?.id, "pci-fr");
  const render = chooseEngine("render", false);
  assert.equal(render.chosen?.id, "blender-cycles");
  const prop = chooseEngine("prop-from-photo", false);
  assert.equal(prop.chosen?.id, "triposr", "TripoSR has a documented CPU worker and MIT weights");
});

test("the brief names adopted, optional and refused engines", () => {
  const brief = technologyBrief();
  assert.ok(brief.adopted.length >= 2);
  assert.ok(brief.rejected.some((r) => r.id === "idol"));
});

/* -------------------------------- capabilities ------------------------------- */

const cpuOnly = describeHardware({ platform: "linux", arch: "x64", cpuCount: 8, cpuModel: "test", totalRamGb: 15, freeDiskGb: 20, gpu: null, blender: null, python: "3.12" });

test("a GPU task on a CPU-only machine is refused, with an alternative", () => {
  const plan = planExecution({ id: "idol", need: "gpu", vramGb: 24 }, cpuOnly);
  assert.equal(plan.backend, "refuse");
  assert.ok(plan.reasons.some((r) => /needs a GPU/.test(r)));
  assert.match(plan.alternative ?? "", /PCI-FR|Cycles/);
});

test("a CPU render gets a bounded plan, never an unlimited one", () => {
  const plan = planExecution({ id: "render", need: "cpu", ramGb: 2, minutes: 2 }, cpuOnly);
  assert.equal(plan.backend, "cpu");
  assert.ok(plan.threads >= 1 && plan.threads <= 8);
  assert.ok(plan.timeoutMs >= 60_000 && plan.timeoutMs <= 45 * 60_000);
  assert.ok(plan.samples === null || plan.samples > 0);
  assert.match(summariseHardware(cpuOnly), /no GPU/);
});

test("insufficient VRAM is refused rather than attempted", () => {
  const gpu = describeHardware({ ...cpuOnly, gpu: { vendor: "nvidia", name: "RTX 3090", vramGb: 24, backend: "cuda" } });
  const plan = planExecution({ id: "pshuman", need: "gpu", vramGb: 40 }, gpu);
  assert.equal(plan.backend, "refuse");
  assert.match(plan.reasons.join(" "), /40 GB VRAM/);
});

/* -------------------------------- references -------------------------------- */

test("the reference library accounts for all 39 files and the five sheets", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "artifacts/lelu2/m231/reference-measurements.json"), "utf8")) as ReferenceManifest;
  const library = buildReferenceLibrary(manifest);
  assert.equal(library.records.length, 39);
  assert.equal(library.photographs, 39);
  assert.equal(library.specSheets.length, 5);
  assert.equal(library.byKind.expression, 3);
  assert.equal(library.byKind["anatomy-overlay"], 11);
  assert.match(describeLibrary(library), /specification sheets/);
});

test("every benchmark shot is declared, unique and points at a real reference", () => {
  const shots = planShots(metrics as never);
  // Camera regression: the landmarks arrive in metres. Treating them as mm put
  // every close-up camera on the floor and rendered an empty frame.
  const eye = shots.find((s) => s.id === "eyes")!;
  assert.ok(eye.camera, "the eyes shot must have an explicit camera");
  assert.ok(eye.camera!.center[2] > 1.4 && eye.camera!.center[2] < 1.75, `eye camera height ${eye.camera!.center[2]} is not on the head`);
  const hairline = shots.find((s) => s.id === "hairline")!;
  assert.ok(hairline.camera!.center[2] > eye.camera!.center[2], "the hairline shot must sit above the eye line");
  assert.equal(shots.length, 13);
  assert.deepEqual(
    shots.map((s) => s.index),
    Array.from({ length: 13 }, (_, i) => i + 1),
  );
  assert.equal(new Set(shots.map((s) => s.id)).size, 13);
  const referenceRoot = path.join(ROOT, "reference-39");
  if (existsSync(referenceRoot)) {
    for (const shot of shots) {
      assert.ok(shot.reference, `${shot.id} has no reference`);
      assert.ok(existsSync(path.join(referenceRoot, shot.reference!)), `${shot.id}: missing ${shot.reference}`);
    }
  }
});

/* -------------------------------- comparison -------------------------------- */

test("a comparison reports the achieved hairline, not the target it was derived from", () => {
  const landmarks = compareLandmarks(metrics);
  const hairline = landmarks.find((l) => l.feature.startsWith("hairline"));
  assert.ok(hairline);
  assert.equal(hairline.status, "outside", "the scalp hairline is ~40 mm below the photographic one");
  assert.ok((hairline.delta ?? 0) < -30, `delta should be about −40 mm, got ${hairline.delta}`);
  const jaw = landmarks.find((l) => l.feature === "jaw width");
  assert.equal(jaw?.status, "within");
  assert.ok(landmarks.some((l) => l.feature === "nose width" && l.status === "not-measured"));
});

test("silhouette IoU is 1 for a mask against itself and low for a displaced one", () => {
  const a = square(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? [200, 150, 140] : [10, 10, 10]));
  const b = square(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? [20, 20, 20] : [10, 10, 10]));
  const ma = maskFromImage(a);
  const mb = maskFromImage(b);
  assert.equal(silhouetteIou(ma, ma).iou, 1);
  // Translation-invariant on purpose: each mask is normalised to its own box,
  // so a shifted copy scores 1. That caveat is the contract, not a bug.
  const moved = maskFromImage(square(64, 64, (x, y) => (x > 4 && x < 36 && y > 16 && y < 48 ? [200, 150, 140] : [10, 10, 10])));
  assert.equal(silhouetteIou(moved, ma).iou, 1);
  // A genuinely different SHAPE is what the normalised metric can see. A solid
  // rectangle cannot show it: its own content box is a full frame either way.
  // The metric is affine-invariant (each mask is stretched to its own box), so
  // it can see a HOLE or a missing half but not a scale change. That is the
  // documented caveat; the test asserts the hole is visible.
  const disc = (half: boolean) =>
    maskFromImage(square(64, 64, (x, y) => ((((x - 32) ** 2 + (y - 32) ** 2 <= 400) && (!half || x <= 32)) ? [200, 150, 140] : [10, 10, 10])));
  assert.equal(silhouetteIou(disc(false), disc(false)).iou, 1);
  const iou = silhouetteIou(disc(true), disc(false)).iou;
  assert.ok(iou > 0.3 && iou < 0.85, `a half disc should overlap its disc partially, got ${iou}`);
});

test("colour distance is zero for identical histograms and positive otherwise", () => {
  const red = square(32, 32, () => [200, 30, 30]);
  const blue = square(32, 32, () => [30, 30, 200]);
  assert.equal(histogramDistance(colourHistogram(red), colourHistogram(red)), 0);
  assert.ok(histogramDistance(colourHistogram(red), colourHistogram(blue)) > 0.5);
});

test("a render comparison carries the hair agreement and the caveats", () => {
  const render = square(96, 96, (x, y) => (x > 20 && x < 76 && y > 12 && y < 84 ? [190, 140, 120] : [8, 8, 10]));
  const reference = square(96, 96, (x, y) => (x > 24 && x < 72 && y > 12 && y < 84 ? [180, 140, 120] : [8, 8, 10]));
  const report = compareRenderToReference({ render, reference, metrics, hair });
  assert.ok(report.silhouette.usable);
  assert.ok(report.notes.length > 0);
  assert.ok(report.hair.length >= 5);
  assert.ok(report.landmarks.some((l) => l.status === "outside"));
});

/* ---------------------------------- projects --------------------------------- */

test("versions are immutable, restorable and hash-verified", () => {
  const root = mkdtempSync(path.join(tmpdir(), "foundry-store-"));
  const glb = path.join(root, "model.glb");
  writeFileSync(glb, "glTF-first");
  createProject(root, { id: "test-character", name: "Test" });
  const v1 = addVersion(root, "test-character", { sourceGlb: glb, label: "one", operation: "import", triangles: 12 });
  assert.equal(v1.id, "v0001");

  writeFileSync(glb, "glTF-second");
  const v2 = addVersion(root, "test-character", { sourceGlb: glb, label: "two", operation: "edit" });
  assert.equal(v2.id, "v0002");
  assert.notEqual(v2.model.sha256, v1.model.sha256);

  const restored = restoreVersion(root, "test-character", "v0001");
  assert.equal(restored.id, "v0003");
  assert.equal(restored.model.sha256, v1.model.sha256, "restore must reproduce the earlier bytes");
  assert.equal(listVersions(root, "test-character").length, 3);

  const png = path.join(root, "shot.png");
  writeFileSync(png, "png-bytes");
  const render = recordRender(root, "test-character", v2.id, { shot: "portrait-front", png, seconds: 1.5 });
  assert.equal(render.shot, "portrait-front");
  assert.equal(readVersion(root, "test-character", v2.id).renders.length, 1);

  assert.equal(verifyProject(root, "test-character").ok, true);
  writeFileSync(modelPath(root, "test-character", v1.id).file, "tampered");
  const broken = verifyProject(root, "test-character");
  assert.equal(broken.ok, false);
  assert.equal(broken.versions.find((v) => v.id === v1.id)?.ok, false);
});

/* ---------------------------------- pipeline --------------------------------- */

test("the pipeline will not validate a run that was never rendered or compared", async () => {
  const partial = await runFoundryPipeline({ subject: "lelu", projectId: "lelu", inputs: {} }, {
    receive: () => ({ evidence: "received" }),
    build: () => ({ evidence: "built" }),
  });
  const assessment = assessRun(partial);
  assert.equal(assessment.validated, false);
  assert.ok(assessment.reasons.some((r) => /no render/.test(r)));
  assert.ok(assessment.reasons.some((r) => /no comparison/.test(r)));
});

test("a full run validates, and a correction without a re-render does not", async () => {
  const adapters = {
    receive: () => ({ evidence: "received 1 reference" }),
    analyse: () => ({ evidence: "classified" }),
    measure: () => ({ evidence: "extracted" }),
    build: () => ({ evidence: "built" }),
    render: () => ({ evidence: "rendered 1 shot" }),
    compare: () => ({ evidence: "compared", data: { verdict: "close" } }),
    diagnose: () => ({ evidence: "2 discrepancies" }),
    preserve: () => ({ evidence: "v0001 kept" }),
  };
  const run = await runFoundryPipeline({ subject: "lelu", projectId: "lelu", inputs: {} }, adapters);
  assert.equal(assessRun(run).validated, true, assessRun(run).reasons.join("; "));
  assert.equal(run.verdict, "close");

  const unseen = await runFoundryPipeline({ subject: "lelu", projectId: "lelu", inputs: {} }, { ...adapters, correct: () => ({ evidence: "nose widened" }) });
  const assessment = assessRun(unseen);
  assert.equal(assessment.correctionsUnseen, true);
  assert.equal(assessment.validated, false);
  assert.ok(assessment.reasons.some((r) => /never re-rendered/.test(r)));
  assert.equal(FOUNDRY_STEPS.length, 12);
});

/* ---------------------------------- intents --------------------------------- */

test("chat sentences map to the right Foundry operation and shots", () => {
  assert.equal(interpretFoundryIntent("render her profile").operation, "render");
  assert.deepEqual(interpretFoundryIntent("render her profile").shots, ["profile"]);
  assert.equal(interpretFoundryIntent("why did the reconstruction fail?").operation, "explain");
  assert.equal(interpretFoundryIntent("change the hairstyle to longer ringlets").operation, "hair");
  assert.equal(interpretFoundryIntent("compare v0001 and v0002").operation, "compare");
  assert.equal(interpretFoundryIntent("compare v0001 and v0002").version, "v0001");
  assert.equal(interpretFoundryIntent("restore v0001").operation, "restore");
  assert.equal(interpretFoundryIntent("what GPU does this machine have?").operation, "status");
  assert.equal(interpretFoundryIntent("add a gold chain headpiece").operation, "jewelry");
  assert.equal(interpretFoundryIntent("tell me a joke").operation, "unknown");
  assert.deepEqual(shotsForIntent(interpretFoundryIntent("render her eyes")), ["eyes"]);
});

/* ----------------------------------- tools ---------------------------------- */

test("the Foundry tools and their executors share ids, and the render script is on disk", () => {
  assert.deepEqual(
    FOUNDRY_TOOLS.map((t) => t.id),
    FOUNDRY_EXECUTORS.map((e) => e.id),
  );
  assert.equal(FOUNDRY_TOOLS.length, 5);
  assert.ok(existsSync(FOUNDRY_RENDER_SCRIPT), `missing render script at ${FOUNDRY_RENDER_SCRIPT}`);
  for (const tool of FOUNDRY_TOOLS) assert.ok(tool.executionRoute, `${tool.id} has no execution route`);
});

// ---------------------------------------------------------------- Meshy sources

function syntheticGlb(): string {
  const json = {
    asset: { version: "2.0", generator: "synthetic-test" },
    nodes: [{ name: "head" }],
    meshes: [{ name: "head", primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, targets: [{}] }], weights: [0], extras: { targetNames: ["jawOpen"] } }],
    materials: [{ name: "skin" }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 2, 0.5] },
      { componentType: 5126, count: 6, type: "VEC2" },
      { componentType: 5123, count: 3, type: "SCALAR" },
    ],
  };
  const jsonChunk = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (n: number) => Buffer.alloc((4 - (n % 4)) % 4, 0x20);
  const jsonBytes = Buffer.concat([jsonChunk, pad(jsonChunk.length)]);
  // A real 1x1 PNG signature so the size reader has something honest to parse.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
  const pngBytes = Buffer.concat([png, Buffer.alloc((4 - (png.length % 4)) % 4, 0)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + pngBytes.length, 8);
  const chunk = (data: Buffer, type: string) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, data]);
  };
  const file = path.join(tmpdir(), `foundry-synthetic-${process.pid}.glb`);
  writeFileSync(file, Buffer.concat([header, chunk(jsonBytes, "JSON"), chunk(pngBytes, "BIN\0")]));
  return file;
}

test("the GLB inspector reads geometry, morphology and texture size from the binary", () => {
  const file = syntheticGlb();
  const inspection = inspectGlb(file);
  assert.equal(inspection.gltfVersion, "2.0");
  assert.equal(inspection.counts.vertices, 3);
  assert.equal(inspection.counts.triangles, 1);
  assert.equal(inspection.counts.morphTargets, 1);
  assert.equal(inspection.counts.materials, 1);
  assert.deepEqual(inspection.uvSets, ["TEXCOORD_0"]);
  assert.equal(inspection.heightM, 2);
  assert.equal(inspection.textures[0]!.width, 1);
  assert.equal(inspection.textures[0]!.height, 1);
  assert.match(inspection.sha256, /^[0-9a-f]{64}$/);
  assert.equal(inspection.morphTargets[0]!.names[0], "jawOpen");
  unlinkSync(file);
});

test("the three sources are ordered per component, not per source", () => {
  const set = locateSources({ root: ROOT, workspace: path.resolve(ROOT, "..") });
  assert.deepEqual(set.precedence, ["photographs", "meshy", "cc0"]);
  assert.equal(set.sources.length, 3);
  assert.equal(authorityFor("hairline"), "photographs");
  assert.equal(authorityFor("rig"), "meshy");
  assert.equal(authorityFor("anatomy.scaffold"), "cc0");
  const meshy = set.sources.find((s) => s.id === "meshy")!;
  assert.ok(meshy.usable, meshy.blockedReason ?? "meshy must be found");
  assert.match(meshy.sha256 ?? "", /^[0-9a-f]{64}$/);
  // The CC0 model may never author a face or hair component.
  const cc0 = set.sources.find((s) => s.id === "cc0")!;
  for (const component of ["face.shape", "hairline", "jewelry"]) assert.ok(cc0.mustNotAuthor.includes(component));
});

test("reconciliation preserves the owned character and marks every verdict unapplied", () => {
  const file = syntheticGlb();
  const inspection = inspectGlb(file);
  const result = reconcile({ inspection, metrics: null, hair: null, meshyRenders: "m", foundryRenders: "f" });
  unlinkSync(file);
  assert.equal(result.verdicts.length, 10);
  assert.ok(result.verdicts.every((v) => v.applied === false), "no verdict may claim a change that was not made");
  assert.equal(result.verdicts.find((v) => v.component === "face.shape")!.decision, "preserve");
  assert.equal(result.verdicts.find((v) => v.component === "anatomy.scaffold")!.decision, "supplement");
  assert.equal(result.counts.preserve + result.counts.deform + result.counts.rebuild + result.counts.supplement, 10);
});
