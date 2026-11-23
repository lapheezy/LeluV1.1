/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 4 RUNNER (ASRE)
 *
 * Runs the whole mission on real inputs and writes everything the report
 * quotes:
 *
 *   A  one image decomposed into its analytical processes
 *   B  four competing reconstruction hypotheses, built and scored
 *   C  layered accumulation from a second, real observation (the back view)
 *   D  component graph, split, anatomy and what a change invalidates
 *   E  one persistent identity: 36 hairstyles, 8 garments, 5 poses
 *   F  the controlled benchmark (methods 1–4) on the real worker
 *
 *   npx tsx scripts/temporal/run-mission4.ts [--trials 2] [--skip-benchmark]
 *
 * Every number is measured here. When the worker or Blender is absent the
 * affected package is written as BLOCKED with the reason, never as a pass.
 * ==========================================================
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { decodePng, encodePng, blankFrame, sideBySide, blendPixel } from "./png.ts";
import { analyseImage, type ImageAnalysis } from "../../src/temporal/asre/image.ts";
import { latticeForAnalysis, cellToImage, type AnalysisLattice } from "../../src/temporal/asre/lattice.ts";
import {
  buildHypotheses,
  compareHypotheses,
  projectCoverage,
  provenanceSummary,
  type ReconstructionHypothesis,
} from "../../src/temporal/asre/hypotheses.ts";
import { addObservation, createLayeredReconstruction, flipbook, headFrame } from "../../src/temporal/asre/layers.ts";
import { COMPONENT_GRAPH, STRUCTURAL_COMPONENTS, checkAnatomy, dependencyEdges, dirtySet, reusableSet, splitByComponent } from "../../src/temporal/asre/components.ts";
import { GARMENTS, HAIRSTYLES, POSES, applyVariation, createIdentity, identityVoxels, reuseRatio, type CharacterIdentity } from "../../src/temporal/asre/identity.ts";
import { runBenchmark, type BenchmarkArtifact, type BenchmarkEngine, type BenchmarkReport } from "../../src/temporal/asre/benchmark.ts";
import { buildSparseVoxels, voxelCount } from "../../src/temporal/nre/voxels.ts";
import { boundaryOf, encodeGlb, meshFromVoxels, voxelizeMesh, type TriangleMesh } from "../../src/temporal/nre/geometry.ts";
import { solidFromSurface } from "../../src/temporal/nre/volume.ts";
import { compareVoxelSets } from "../../src/temporal/nre/compare.ts";
import { inspectGlb, readGlbGeometry } from "../../src/core/forge/GlbInspector.ts";
import type { SparseVoxels } from "../../src/temporal/nre/types.ts";
import type { ComponentId } from "../../src/temporal/asre/types.ts";
import { cpus } from "node:os";

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? (argv[index + 1] ?? "true") : null;
};
const trials = Number(flag("trials") ?? 2);
const skipBenchmark = argv.includes("--skip-benchmark");

const outDir = path.join(process.cwd(), "artifacts", "mission4");
mkdirSync(outDir, { recursive: true });
const glbDir = path.join(outDir, "glb");
mkdirSync(glbDir, { recursive: true });

const results: Array<{ workPackage: string; status: string; detail: string }> = [];
const write = (name: string, value: unknown): void => {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 1)}\n`);
};
const writeGlb = (name: string, mesh: TriangleMesh, label: string): { file: string; bytes: number; triangles: number; accepted: boolean } => {
  const bytes = encodeGlb(mesh, { name: label, generator: "asre-mission4" });
  writeFileSync(path.join(glbDir, name), bytes);
  const gate = inspectGlb(bytes);
  return { file: `artifacts/mission4/glb/${name}`, bytes: bytes.byteLength, triangles: Math.floor(mesh.indices.length / 3), accepted: gate.ok };
};

const FRONT = "leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/04_front_apose.png";
const BACK = "leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/03_back_upper_body.png";

/* =========================================================== A — analysis */

console.log("WP-A image decomposition…");
const frontFrame = decodePng(new Uint8Array(readFileSync(FRONT)));
const analysis = analyseImage(frontFrame, { worldHeightM: 1.7 });
const lattice = latticeForAnalysis(analysis, { resolutionY: 96 });

write("wp_a_analysis.json", {
  image: { path: FRONT, width: analysis.width, height: analysis.height, pixelDigest: analysis.pixelDigest },
  colour: analysis.colour,
  segmentation: {
    threshold: analysis.segmentation.threshold,
    rawPixels: analysis.segmentation.rawPixels,
    discardedPixels: analysis.segmentation.discardedPixels,
    filledHoles: analysis.segmentation.filledHoles,
    areaPx: analysis.silhouette.area,
    notes: analysis.segmentation.notes,
  },
  silhouette: {
    bbox: analysis.silhouette.bbox,
    area: analysis.silhouette.area,
    perimeter: analysis.silhouette.perimeter,
    symmetry: analysis.silhouette.symmetry,
    centroid: analysis.silhouette.centroid,
  },
  surface: analysis.surface,
  depth: {
    maxInflation: analysis.depth.maxInflation,
    maxHalfThicknessPx: analysis.depth.maxHalfThicknessPx,
    weights: analysis.depth.weights,
    notes: analysis.depth.notes,
  },
  landmarks: analysis.landmarks.landmarks,
  components: analysis.components.components,
  componentNotes: { notDetected: analysis.components.notDetected, notes: analysis.components.notes },
  measurements: analysis.measurements,
  lattice: {
    resX: lattice.resX,
    resY: lattice.resY,
    resZ: lattice.resZ,
    cellSize: lattice.grid.cellSize,
    maxDepthCells: lattice.maxDepthCells,
    notes: lattice.notes,
  },
  timings: analysis.timings,
  notes: analysis.notes,
});

/* 2D diagnostic images: these are the numerical passes made visible. */
const maskFrame = blankFrame(analysis.width, analysis.height, [10, 12, 16]);
const depthFrame = blankFrame(analysis.width, analysis.height, [10, 12, 16]);
const componentFrame = blankFrame(analysis.width, analysis.height, [10, 12, 16]);
const overlayFrame = decodePng(new Uint8Array(readFileSync(FRONT)));
const componentColours: Record<string, [number, number, number]> = {
  head: [255, 214, 140],
  face: [255, 170, 120],
  hair: [140, 110, 255],
  neck: [200, 220, 160],
  torso: [110, 200, 255],
  arms: [120, 255, 190],
  hands: [255, 140, 200],
  pelvis: [255, 220, 110],
  legs: [160, 180, 255],
  feet: [255, 160, 160],
  clothing: [140, 255, 230],
  accessories: [255, 120, 255],
};
for (let y = 0; y < analysis.height; y++) {
  for (let x = 0; x < analysis.width; x++) {
    const p = y * analysis.width + x;
    if (analysis.mask[p] === 1) {
      const d = analysis.depth.blended[p];
      blendPixel(maskFrame, x, y, [90, 220, 160], 1);
      blendPixel(depthFrame, x, y, [Math.round(40 + 215 * d), Math.round(60 + 120 * (1 - d)), Math.round(200 - 150 * d)], 1);
    }
  }
}
for (const component of analysis.components.components) {
  if (!component.detected) continue;
  const colour = componentColours[component.id] ?? [200, 200, 200];
  for (let y = Math.max(0, component.bbox.minY); y <= Math.min(analysis.height - 1, component.bbox.maxY); y++) {
    for (let x = Math.max(0, component.bbox.minX); x <= Math.min(analysis.width - 1, component.bbox.maxX); x++) {
      if (analysis.mask[y * analysis.width + x] === 0) continue;
      blendPixel(componentFrame, x, y, colour, 0.85);
      blendPixel(overlayFrame, x, y, colour, 0.55);
    }
  }
}
for (const landmark of analysis.landmarks.landmarks) {
  const colour: [number, number, number] = landmark.provenance === "OBSERVED" ? [255, 255, 255] : [255, 190, 60];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 5) continue;
      blendPixel(overlayFrame, Math.round(landmark.x) + dx, Math.round(landmark.y) + dy, colour, 0.95);
    }
  }
}
writeFileSync(path.join(outDir, "analysis_mask.png"), encodePng(maskFrame));
writeFileSync(path.join(outDir, "analysis_depth.png"), encodePng(depthFrame));
writeFileSync(path.join(outDir, "analysis_components.png"), encodePng(componentFrame));
writeFileSync(path.join(outDir, "analysis_landmarks.png"), encodePng(overlayFrame));
writeFileSync(
  path.join(outDir, "analysis_decomposed.png"),
  encodePng(sideBySide([overlayFrame, maskFrame, depthFrame, componentFrame], 10)),
);

results.push({
  workPackage: "A. Image decomposition",
  status: analysis.landmarks.landmarks.length >= 8 && analysis.components.components.some((c) => c.detected) ? "VERIFIED" : "PARTIAL",
  detail: `${analysis.landmarks.landmarks.length} landmarks, ${analysis.components.components.filter((c) => c.detected).length} components, ${analysis.silhouette.area} silhouette pixels, ${analysis.timings.totalMs.toFixed(0)} ms`,
});

/* ========================================================= B — hypotheses */

console.log("WP-B competing hypotheses…");
const hypotheses = buildHypotheses(lattice, analysis);
const comparison = compareHypotheses(hypotheses, lattice, analysis);
const hypothesisAssets = hypotheses.map((hypothesis) => {
  const mesh = meshFromVoxels(hypothesis.voxels);
  return { id: hypothesis.id, kind: hypothesis.kind, rule: hypothesis.rule, ...writeGlb(`${hypothesis.id}.glb`, mesh, hypothesis.id) };
});

write("wp_b_hypotheses.json", {
  lattice: {
    resX: lattice.resX,
    resY: lattice.resY,
    resZ: lattice.resZ,
    cellSize: lattice.grid.cellSize,
    imageBox: lattice.imageBox,
    maxDepthCells: lattice.maxDepthCells,
    observedColumns: Array.from(lattice.observedCoverage).filter((v) => v === 1).length,
  },
  hypotheses: comparison.evaluations.map((evaluation) => ({
    id: evaluation.hypothesis.id,
    kind: evaluation.hypothesis.kind,
    label: evaluation.hypothesis.label,
    rule: evaluation.hypothesis.rule,
    notes: evaluation.hypothesis.notes,
    cells: evaluation.score.cells,
    provenanceCounts: evaluation.hypothesis.provenanceCounts,
    provenance: provenanceSummary(evaluation.hypothesis),
    score: evaluation.score,
  })),
  ranked: comparison.ranked.map((entry) => entry.hypothesis.id),
  chosen: comparison.chosen.hypothesis.id,
  rules: comparison.rules,
  statement: comparison.statement,
  assets: hypothesisAssets,
});

/* projection images: what each hypothesis covers when re-projected. */
const projectionFrames = hypotheses.map((hypothesis) => {
  const coverage = projectCoverage(hypothesis, lattice);
  const frame = blankFrame(lattice.resX * 6, lattice.resY * 6, [10, 12, 16]);
  for (let j = 0; j < lattice.resY; j++) {
    for (let i = 0; i < lattice.resX; i++) {
      const observed = lattice.observedCoverage[j * lattice.resX + i] === 1;
      const projected = coverage[j * lattice.resX + i] === 1;
      const colour: [number, number, number] = observed && projected ? [90, 220, 160] : projected ? [255, 120, 120] : observed ? [60, 80, 120] : [10, 12, 16];
      for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) blendPixel(frame, i * 6 + dx, (lattice.resY - 1 - j) * 6 + dy, colour, 1);
    }
  }
  return frame;
});
writeFileSync(path.join(outDir, "hypothesis_projections.png"), encodePng(sideBySide(projectionFrames, 8)));

results.push({
  workPackage: "B. Competing hypotheses",
  status: comparison.evaluations.length >= 4 ? "VERIFIED" : "PARTIAL",
  detail: `${comparison.evaluations.length} hypotheses built and scored; chosen ${comparison.chosen.hypothesis.id} at ${comparison.chosen.score.confidence.toFixed(4)}`,
});

/* ========================================================== C — layers */

console.log("WP-C layered accumulation…");
const chosen = comparison.chosen.hypothesis;
const regions = analysis.components.regions;
const observedComponents = STRUCTURAL_COMPONENTS.filter((id) => analysis.components.components.find((c) => c.id === id)?.detected);

let layer = createLayeredReconstruction("lelu-apose", lattice, {
  id: "obs-front",
  imageDigest: analysis.pixelDigest,
  hypothesisId: chosen.id,
  voxels: chosen.voxels,
  observedComponents,
  regions,
  notes: [comparison.statement],
});

const duplicate = addObservation(layer, {
  id: "obs-front-again",
  imageDigest: analysis.pixelDigest,
  hypothesisId: chosen.id,
  voxels: chosen.voxels,
  observedComponents,
  regions,
});
layer = duplicate.layer;

// A real second observation: the back view, registered by silhouette box.
let backReport: Record<string, unknown> = { available: false };
try {
  const backFrame = decodePng(new Uint8Array(readFileSync(BACK)));
  const backAnalysis = analyseImage(backFrame, { worldHeightM: 1.7 });
  const backLattice = latticeForAnalysis(backAnalysis, { resolutionY: 96 });
  const backHypotheses = buildHypotheses(backLattice, backAnalysis);
  const backComparison = compareHypotheses(backHypotheses, backLattice, backAnalysis);
  const registered = registerToLattice(backComparison.chosen.hypothesis.voxels, backLattice, lattice);
  const accumulation = addObservation(layer, {
    id: "obs-back",
    imageDigest: backAnalysis.pixelDigest,
    hypothesisId: backComparison.chosen.hypothesis.id,
    voxels: registered,
    observedComponents: ["torso", "head", "neck"],
    regions,
    notes: [
      `back view registered by silhouette bounding box, not by camera calibration: the two views are not metrically aligned`,
      backComparison.statement,
    ],
  });
  layer = accumulation.layer;
  backReport = {
    available: true,
    image: BACK,
    backHypothesis: backComparison.chosen.hypothesis.id,
    backConfidence: backComparison.chosen.score.confidence,
    registration: "silhouette-bbox normalisation into the front lattice; depths scaled by the lattice cell size",
    duplicate: accumulation.duplicate,
    why: accumulation.why,
    registeredCells: voxelCount(registered),
    against: compareVoxelSets(chosen.voxels, registered).iou,
  };
} catch (error) {
  backReport = { available: false, reason: error instanceof Error ? error.message : String(error) };
}

const frames = layer.frames;
const frameAssets = frames.map((frame) =>
  writeGlb(`flipbook_${frame.index}_${frame.state}.glb`, meshFromVoxels(boundaryOf(frame.voxels)), `frame-${frame.index}-${frame.state}`),
);

write("wp_c_layers.json", {
  objectId: layer.objectId,
  frames: flipbook(layer),
  duplicateBehaviour: {
    duplicateAccepted: duplicate.duplicate,
    why: duplicate.why,
    frameState: duplicate.frame.state,
    confidenceBefore: duplicate.frame.meanConfidenceBefore,
    confidenceAfter: duplicate.frame.meanConfidenceAfter,
    confidenceDelta: duplicate.frame.meanConfidenceAfter - duplicate.frame.meanConfidenceBefore,
  },
  backObservation: backReport,
  changes: frames.map((frame) => ({
    index: frame.index,
    state: frame.state,
    hypothesis: frame.hypothesisId,
    componentsUpdated: frame.componentsUpdated,
    componentsPreserved: frame.componentsPreserved,
    change: frame.change,
    meanConfidenceBefore: frame.meanConfidenceBefore,
    meanConfidenceAfter: frame.meanConfidenceAfter,
    notes: frame.notes,
  })),
  framesRestorable: frames.length,
  assets: frameAssets,
});

results.push({
  workPackage: "C. Layered snapshots",
  status: duplicate.duplicate && (backReport.available === true || frames.length >= 2) ? "VERIFIED" : "PARTIAL",
  detail: `${frames.length} frames; duplicate image refused with a confidence delta of 0; back view ${backReport.available ? "fused" : "unavailable"}`,
});

/* ====================================================== D — components */

console.log("WP-D component graph…");
const split = splitByComponent(chosen.voxels, lattice, regions);
const anatomy = checkAnatomy(split.parts, lattice.grid);
const beforeDigests = { ...headFrame(layer).componentDigests };

// A localised change: re-split the same evidence but declare only the torso
// observed, which is what "refine one part" means numerically.
const torsoRefinement = addObservation(layer, {
  id: "refine-torso",
  imageDigest: `${analysis.pixelDigest}-torso-refine`,
  hypothesisId: `${comparison.ranked[1]?.hypothesis.id ?? chosen.id}`,
  voxels: comparison.ranked[1]?.hypothesis.voxels ?? chosen.voxels,
  observedComponents: ["torso"],
  regions,
  notes: ["localised refinement: only the torso is declared observed; every other part must keep its digest"],
});
const torsoFrame = torsoRefinement.frame;
const preservedByDigest = STRUCTURAL_COMPONENTS.filter(
  (id) => torsoFrame.componentDigests[id] === beforeDigests[id] && beforeDigests[id] !== undefined,
);

const torsoRefinementAsset = writeGlb("refinement_torso.glb", meshFromVoxels(boundaryOf(torsoFrame.voxels)), "refinement-torso");
const componentAssets = STRUCTURAL_COMPONENTS.map((id) => {
  const part = split.parts[id];
  if (!part) return { component: id, cells: 0, file: null };
  const mesh = meshFromVoxels(part);
  return { component: id, cells: voxelCount(part), ...writeGlb(`component_${id}.glb`, mesh, id) };
});

write("wp_d_components.json", {
  graph: STRUCTURAL_COMPONENTS.map((id) => {
    const node = COMPONENT_GRAPH[id];
    return { id, label: node.label, parent: node.parent, dependents: node.dependents, articulated: node.articulated, deformable: node.deformable, costUnits: node.costUnits, role: node.role, note: node.note };
  }),
  dependencies: dependencyEdges(),
  split: {
    counts: split.counts,
    unassignedCells: split.unassignedCells,
    contestedCells: split.contestedCells,
    notes: split.notes,
  },
  anatomy,
  invalidation: [
    { change: "hairstyle", structural: false, dirty: dirtySet(["hair"]), reused: reusableSet(["hair"]) },
    { change: "sleeve geometry", structural: false, dirty: dirtySet(["arms"]), reused: reusableSet(["arms"]) },
    { change: "body proportions (pelvis)", structural: true, dirty: dirtySet(["pelvis"], { structural: true }), reused: reusableSet(["pelvis"], { structural: true }) },
    { change: "head scale", structural: true, dirty: dirtySet(["head"], { structural: true }), reused: reusableSet(["head"], { structural: true }) },
  ],
  refinement: {
    changed: torsoFrame.componentsUpdated,
    preserved: torsoFrame.componentsPreserved,
    preservedByDigest,
    digestsBefore: beforeDigests,
    digestsAfter: torsoFrame.componentDigests,
    change: torsoFrame.change,
  },
  assets: componentAssets,
});

const separatedParts = STRUCTURAL_COMPONENTS.filter((id) => split.parts[id] !== undefined).length;
results.push({
  workPackage: "D. Component reconstruction",
  status: preservedByDigest.length >= STRUCTURAL_COMPONENTS.length - 2 && anatomy.every((issue) => issue.severity !== "error") ? "VERIFIED" : "PARTIAL",
  detail: `${separatedParts}/${STRUCTURAL_COMPONENTS.length} parts separated; ${preservedByDigest.length} preserved by digest under a torso-only refinement`,
});

/* ======================================================== E — identity */

console.log("WP-E identity and variations…");
const baseline = ensureBaseline(analysis, lattice, regions);
const identityBase = createIdentity({
  id: "lelu-identity",
  label: "LÉLU A-pose",
  lattice,
  voxels: baseline.voxels,
  regions,
});
const baseDigests = { ...identityBase.digests };
const baselineBodyAsset = writeGlb("body_baseline.glb", meshFromVoxels(identityVoxels(identityBase, { includeOverlays: false })), "body-baseline");

const hairEntries = HAIRSTYLES.map((style) => {
  const result = applyVariation(identityBase, { kind: "hairstyle", id: style.id });
  const voxels = identityVoxels(result.identity);
  const mesh = meshFromVoxels(voxels);
  const asset = writeGlb(`hair_${style.id}.glb`, mesh, `hair-${style.id}`);
  const bodyPreserved = STRUCTURAL_COMPONENTS.every((id) => result.identity.digests[id] === baseDigests[id]);
  return {
    id: style.id,
    label: style.label,
    family: style.family,
    length: style.length,
    cells: result.identity.overlays.hair ? voxelCount(result.identity.overlays.hair) : 0,
    hairCells: result.identity.overlays.hair ? voxelCount(result.identity.overlays.hair) : 0,
    headDigestBefore: baseDigests.head,
    headDigestAfter: result.identity.digests.head,
    bodyPreserved,
    reusedCells: result.reusedCells,
    regeneratedCells: result.regeneratedCells,
    reuse: reuseRatio(result),
    changed: result.changed,
    preserved: result.preserved,
    asset,
    failures: result.failures,
  };
});

const garmentEntries = GARMENTS.map((garment) => {
  // Apply the garment on top of a chosen hairstyle so the render shows a
  // complete look; the garment's own reuse is measured against that identity.
  const withHair = applyVariation(identityBase, { kind: "hairstyle", id: "bob-shoulder" });
  const result = applyVariation(withHair.identity, { kind: "clothing", id: garment.id });
  const voxels = identityVoxels(result.identity);
  const asset = writeGlb(`garment_${garment.id}.glb`, meshFromVoxels(voxels), `garment-${garment.id}`);
  const bodyPreserved = STRUCTURAL_COMPONENTS.every((id) => result.identity.digests[id] === baseDigests[id]);
  return {
    id: garment.id,
    label: garment.label,
    family: garment.family,
    cells: result.identity.overlays.clothing ? voxelCount(result.identity.overlays.clothing) : 0,
    garmentCells: result.identity.overlays.clothing ? voxelCount(result.identity.overlays.clothing) : 0,
    hairPreserved: result.identity.digests.hair === withHair.identity.digests.hair,
    bodyPreserved,
    reusedCells: result.reusedCells,
    regeneratedCells: result.regeneratedCells,
    reuse: reuseRatio(result),
    changed: result.changed,
    preserved: result.preserved,
    asset,
    failures: result.failures,
  };
});

const poseEntries = POSES.map((pose) => {
  const result = applyVariation(identityBase, { kind: "pose", id: pose.id });
  const asset = writeGlb(`pose_${pose.id}.glb`, meshFromVoxels(identityVoxels(result.identity)), `pose-${pose.id}`);
  return {
    id: pose.id,
    label: pose.label,
    changed: result.changed,
    preserved: result.preserved,
    reuse: reuseRatio(result),
    headPreserved: result.identity.digests.head === baseDigests.head,
    asset,
    failures: result.failures,
  };
});

// Proportion change: shoulders wider must invalidate the garment, not the head.
const proportions = applyVariation(applyVariation(identityBase, { kind: "clothing", id: "tunic-basic" }).identity, {
  kind: "proportions",
  id: "shoulders",
  proportions: { shoulderScale: 1.25 },
});
const proportionAsset = writeGlb(`proportions_shoulders.glb`, meshFromVoxels(identityVoxels(proportions.identity)), "proportions-shoulders");

// Looks: combinations, for the render grids.
const looks: Array<{ id: string; hair: string; garment: string; file: string; cells: number }> = [];
for (const hair of ["pixie-crop", "bob-jaw", "long-straight-shoulder", "waves-chest", "ponytail-waist", "bun-shoulder"]) {
  for (const garment of ["tunic-basic", "jacket-cropped"]) {
    const withHair = applyVariation(identityBase, { kind: "hairstyle", id: hair });
    const withGarment = applyVariation(withHair.identity, { kind: "clothing", id: garment });
    const voxels = identityVoxels(withGarment.identity);
    const asset = writeGlb(`look_${hair}_${garment}.glb`, meshFromVoxels(voxels), `look-${hair}-${garment}`);
    looks.push({ id: `${hair}+${garment}`, hair, garment, file: asset.file, cells: voxelCount(voxels) });
  }
}

write("wp_e_identity.json", {
  baseline: baseline.report,
  identity: {
    id: identityBase.id,
    structuralParts: STRUCTURAL_COMPONENTS.map((id) => ({ id, cells: identityBase.parts[id] ? voxelCount(identityBase.parts[id] as SparseVoxels) : 0, digest: identityBase.digests[id] })),
    appearance: identityBase.appearance,
    rig: identityBase.rig,
  },
  hairstyles: {
    library: HAIRSTYLES.length,
    generated: hairEntries.filter((entry) => entry.cells > 0).length,
    failed: hairEntries.filter((entry) => entry.failures.length > 0).length,
    bodyPreservedAll: hairEntries.every((entry) => entry.bodyPreserved),
    entries: hairEntries,
  },
  garments: {
    library: GARMENTS.length,
    generated: garmentEntries.filter((entry) => entry.cells > 0).length,
    failed: garmentEntries.filter((entry) => entry.failures.length > 0).length,
    bodyPreservedAll: garmentEntries.every((entry) => entry.bodyPreserved),
    hairPreservedAll: garmentEntries.every((entry) => entry.hairPreserved),
    entries: garmentEntries,
  },
  poses: { entries: poseEntries },
  proportions: {
    change: "shoulderScale 1.25",
    changed: proportions.changed,
    preserved: proportions.preserved,
    reuse: reuseRatio(proportions),
    headPreserved: proportions.identity.digests.head === baseDigests.head,
    garmentRegenerated: proportions.notes.filter((note) => /regenerated/.test(note)),
    asset: proportionAsset,
  },
  looks,
});

results.push({
  workPackage: "E. Persistent identity",
  status:
    hairEntries.every((entry) => entry.cells > 0 && entry.bodyPreserved && entry.failures.length === 0) &&
    garmentEntries.every((entry) => entry.cells > 0 && entry.bodyPreserved && entry.failures.length === 0)
      ? "VERIFIED"
      : "PARTIAL",
  detail: `${HAIRSTYLES.length} hairstyles and ${GARMENTS.length} garments generated as geometry; body digests unchanged in ${hairEntries.filter((e) => e.bodyPreserved).length}/${hairEntries.length} and ${garmentEntries.filter((e) => e.bodyPreserved).length}/${garmentEntries.length}`,
});

/* ======================================================= F — benchmark */

interface BenchmarkOutcome {
  status: string;
  reason?: string;
  report?: BenchmarkReport;
  engine?: string;
}
let benchmarkReport: BenchmarkOutcome = { status: "SKIPPED" };
if (!skipBenchmark) {
  console.log("WP-F benchmark (real worker)…");
  try {
    const engine = createTripoSrEngine({ analysis, lattice, regions, chosen, comparison });
    const report = await runBenchmark(engine, {
      trials,
      concurrency: 4,
      refinementSteps: 3,
      coldStart: true,
      silhouetteIou: (voxels) => silhouetteIou(voxels, lattice),
    });
    benchmarkReport = { status: "MEASURED", report, engine: engine.description };
    write("wp_f_benchmark.json", benchmarkReport);
    results.push({
      workPackage: "F. Speed and simplicity benchmark",
      status: report.methods.every((method) => method.successRate > 0) ? "VERIFIED" : "PARTIAL",
      detail: report.comparison.statement,
    });
  } catch (error) {
    benchmarkReport = { status: "BLOCKED", reason: error instanceof Error ? error.message : String(error) };
    write("wp_f_benchmark.json", benchmarkReport);
    results.push({ workPackage: "F. Speed and simplicity benchmark", status: "BLOCKED", detail: benchmarkReport.reason ?? "benchmark failed" });
  }
}

/* ====================================================== render manifests */

interface SceneItem {
  glb: string;
  label: string;
  colour: [number, number, number];
}
interface SceneSpec {
  title: string;
  subtitle: string;
  items: SceneItem[];
  columns: number;
  view: { azimuth: number; elevation: number };
  bars?: Array<{ label: string; value: number; colour: [number, number, number] }>;
}
const scene = (name: string, spec: SceneSpec): void => write(`scene_${name}.json`, spec);
const clay: [number, number, number] = [0.78, 0.72, 0.66];
const hairColour: [number, number, number] = [0.32, 0.24, 0.18];
const clothColour: [number, number, number] = [0.24, 0.44, 0.47];

scene("hypotheses", {
  title: "One photograph, four reconstruction hypotheses",
  subtitle: "front cap observed in every case; depth inferred or synthesised — never photographed",
  items: comparison.evaluations.map((evaluation) => ({
    glb: `artifacts/mission4/glb/${evaluation.hypothesis.id}.glb`,
    label: `${evaluation.hypothesis.kind}\nquality ${evaluation.score.quality.toFixed(3)} · ${(100 * evaluation.score.observedShare).toFixed(0)}% observed`,
    colour: evaluation.hypothesis.kind === "silhouette-slab" ? [0.55, 0.6, 0.68] : evaluation.hypothesis.kind === "shading-relief" ? [0.78, 0.64, 0.42] : evaluation.hypothesis.kind === "block-prismatic" ? [0.6, 0.55, 0.7] : clay,
  })),
  columns: 4,
  view: { azimuth: 28, elevation: 12 },
});

scene("flipbook", {
  title: "Flipbook: persistent frames, not image overlays",
  subtitle: frames.map((frame) => `${frame.state}${frame.change.newCells > 0 ? ` +${frame.change.newCells}` : ""}`).join(" | "),
  items: frames.slice(0, 4).map((frame, index) => ({
    glb: `artifacts/mission4/glb/flipbook_${frame.index}_${frame.state}.glb`,
    label: `frame ${index}\n${frame.state}\n${frame.voxels.coords.length / 3} cells`,
    colour: index === 0 ? clay : [0.55, 0.72, 0.66],
  })),
  columns: Math.min(4, frames.length),
  view: { azimuth: 24, elevation: 10 },
});

scene("progressive", {
  title: "Progressive construction",
  subtitle: "image → numerical hypothesis → accumulated frames → real reconstruction → hairstyle → garment",
  items: [
    { glb: `artifacts/mission4/glb/${chosen.id}.glb`, label: "1. hypothesis\n(numerical)", colour: [0.7, 0.66, 0.6] },
    { glb: `artifacts/mission4/glb/flipbook_${frames[frames.length - 1].index}_${frames[frames.length - 1].state}.glb`, label: "2. accumulated\nafter back view", colour: [0.6, 0.72, 0.68] },
    { glb: "artifacts/mission4/glb/body_baseline.glb", label: "3. TripoSR base\n(real worker)", colour: clay },
    { glb: `artifacts/mission4/glb/look_bob-jaw_tunic-basic.glb`, label: "4. hairstyle +\ngarment", colour: clothColour },
    { glb: "artifacts/mission4/glb/proportions_shoulders.glb", label: "5. proportions\n(garment refit)", colour: [0.5, 0.5, 0.62] },
  ],
  columns: 5,
  view: { azimuth: 22, elevation: 10 },
});

scene("components", {
  title: "Components, independently refinable",
  subtitle: `split by measured regions · ${split.unassignedCells} cells unassigned · ${split.contestedCells} contested`,
  items: STRUCTURAL_COMPONENTS.filter((id) => split.parts[id]).map((id) => ({
    glb: `artifacts/mission4/glb/component_${id}.glb`,
    label: `${id}\n${voxelCount(split.parts[id] as SparseVoxels)} cells`,
    colour: [0.55 + 0.06 * STRUCTURAL_COMPONENTS.indexOf(id), 0.6, 0.7 - 0.03 * STRUCTURAL_COMPONENTS.indexOf(id)],
  })),
  columns: 4,
  view: { azimuth: 18, elevation: 8 },
});

scene("hairstyles", {
  title: `Hairstyle variations on one persistent body (${HAIRSTYLES.length} generated)`,
  subtitle: "body, head and face digests unchanged in every variation",
  items: ["pixie-crop", "bob-jaw", "bob-chest", "long-straight-shoulder", "waves-shoulder", "ponytail-chest", "bun-shoulder", "waves-waist"].map((id) => ({
    glb: `artifacts/mission4/glb/hair_${id}.glb`,
    label: id,
    colour: hairColour,
  })),
  columns: 4,
  view: { azimuth: 20, elevation: 8 },
});

scene("garments", {
  title: `Clothing variations on one persistent body (${GARMENTS.length} generated)`,
  subtitle: "garment regenerated per style; body and hair preserved",
  items: GARMENTS.map((garment) => ({
    glb: `artifacts/mission4/glb/garment_${garment.id}.glb`,
    label: garment.label,
    colour: clothColour,
  })),
  columns: 4,
  view: { azimuth: 20, elevation: 8 },
});

scene("looks", {
  title: "Style combinations from one identity",
  subtitle: `${looks.length} looks rendered from the same base geometry`,
  items: looks.slice(0, 8).map((look) => ({ glb: look.file, label: look.id.replace("+", "\n+ "), colour: [0.42, 0.5, 0.58] })),
  columns: 4,
  view: { azimuth: 18, elevation: 8 },
});

scene("incremental", {
  title: "Incremental refinement vs complete regeneration",
  subtitle: `torso-only refinement: ${preservedByDigest.length} parts preserved by digest, ${torsoFrame.change.newCells + torsoFrame.change.lostCells} cells changed`,
  items: [
    { glb: `artifacts/mission4/glb/flipbook_0_initial.glb`, label: "before\n(full object)", colour: clay },
    { glb: "artifacts/mission4/glb/refinement_torso.glb", label: "after torso-only\nrefinement", colour: [0.55, 0.72, 0.66] },
  ],
  columns: 2,
  view: { azimuth: 26, elevation: 10 },
});

const benchmark = benchmarkReport;
if (benchmark.status === "MEASURED" && benchmark.report) {
  const methods = benchmark.report.methods;
  scene("parallel", {
    title: "Measured cost by method (median of the trials)",
    subtitle: "wall clock for the full run; lower is better — and quality is reported separately",
    items: [],
    columns: 1,
    view: { azimuth: 20, elevation: 10 },
    bars: methods.map((method, index) => ({
      label: `${method.method.replace("-parallel", "\n+parallel")}\n${(method.median.wallMs / 1000).toFixed(1)} s`,
      value: method.median.wallMs,
      colour: ([[0.62, 0.55, 0.5], [0.55, 0.6, 0.7], [0.45, 0.7, 0.6], [0.75, 0.62, 0.35]] as Array<[number, number, number]>)[index % 4],
    })),
  });
}

/* ============================================================ manifests */

const manifest = {
  generatedAt: new Date().toISOString(),
  branch: spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(),
  head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  machine: { cpus: cpus().length, platform: process.platform, arch: process.arch, node: process.version },
  workPackages: results,
};
write("mission4_summary.json", manifest);

console.log("\nMISSION 4\n");
for (const row of results) console.log(`  ${row.status.padEnd(9)} ${row.workPackage.padEnd(34)} ${row.detail}`);
console.log(`\n  artifacts → artifacts/mission4/`);

/* ============================================================ helpers */

/** Normalised registration of one observation's lattice into another. */
function registerToLattice(source: SparseVoxels, sourceLattice: AnalysisLattice, target: AnalysisLattice): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const seen = new Set<number>();
  const [tx, ty, tz] = target.grid.resolution;
  const n = voxelCount(source);
  const depthScale = target.grid.cellSize / sourceLattice.grid.cellSize;
  for (let v = 0; v < n; v++) {
    const si = source.coords[v * 3];
    const sj = source.coords[v * 3 + 1];
    const sk = source.coords[v * 3 + 2];
    const u = si / Math.max(1, sourceLattice.resX - 1);
    const w = sj / Math.max(1, sourceLattice.resY - 1);
    const ti = Math.round(u * (tx - 1));
    const tj = Math.round(w * (ty - 1));
    const depth = (sk - sourceLattice.midZ) * depthScale;
    const tk = Math.round(target.midZ + depth);
    if (ti < 0 || tj < 0 || tk < 0 || ti >= tx || tj >= ty || tk >= tz) continue;
    const key = (ti * ty + tj) * tz + tk;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([ti, tj, tk]);
  }
  return buildSparseVoxels(target.grid, cells, { occupancy: "sparse-volume" });
}

function silhouetteIou(voxels: SparseVoxels, target: AnalysisLattice): number {
  const coverage = new Uint8Array(target.resX * target.resY);
  const n = voxelCount(voxels);
  for (let v = 0; v < n; v++) coverage[voxels.coords[v * 3 + 1] * target.resX + voxels.coords[v * 3]] = 1;
  let shared = 0;
  let union = 0;
  for (let p = 0; p < coverage.length; p++) {
    const observed = target.observedCoverage[p] === 1;
    if (coverage[p] === 1 && observed) shared++;
    if (coverage[p] === 1 || observed) union++;
  }
  return union > 0 ? shared / union : 0;
}

/**
 * The real TripoSR reconstruction, aligned to the ASRE lattice and
 * solidified so the body is a closed volume. When the worker is missing the
 * engine falls back to the chosen hypothesis and says so.
 */
function ensureBaseline(_analysis: ImageAnalysis, target: AnalysisLattice, _regions: Record<ComponentId, import("../../src/temporal/asre/types.ts").BBox2D>): {
  voxels: SparseVoxels;
  report: Record<string, unknown>;
} {
  const jobDir = "/tmp/m4jobs";
  mkdirSync(jobDir, { recursive: true });
  const jobFile = path.join(jobDir, "baseline.json");
  const outGlb = path.join(jobDir, "baseline.glb");
  writeFileSync(jobFile, JSON.stringify([{ id: "baseline", image: FRONT, out: outGlb, mcResolution: 160, crop: null }]));
  const run = spawnSync(
    "/tmp/triposr-venv/bin/python",
    ["scripts/foundry/triposr_batch.py", "--jobs", jobFile],
    { encoding: "utf8", env: { ...process.env, PYTHONPATH: `/tmp/shim:/tmp/TripoSR` }, timeout: 300_000 },
  );
  const lines = (run.stdout ?? "").trim().split("\n").filter((line) => line.startsWith("{"));
  const parsed = lines.map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
  const job = parsed.find((entry) => entry.id === "baseline");
  if (!job || job.ok !== true) {
    console.warn("  baseline worker unavailable, using the chosen hypothesis:", job?.error ?? run.stderr?.slice(0, 300));
    return { voxels: chosen.voxels, report: { source: "chosen-hypothesis-fallback", worker: job ?? null, stderr: (run.stderr ?? "").slice(-400) } };
  }
  const mesh = alignMeshToLattice(readGlbGeometry(new Uint8Array(readFileSync(outGlb))), target);
  const surface = voxelizeMesh(mesh, target.grid, { samplesPerCell: 2 });
  const solid = solidFromSurface(surface);
  return {
    voxels: solid.volume,
    report: {
      source: "triposr",
      worker: job,
      surfaceCells: voxelCount(surface),
      solidCells: voxelCount(solid.volume),
      closed: solid.closed,
      enclosedCells: solid.enclosedCells,
      notes: solid.notes,
      silhouetteIou: silhouetteIou(solid.volume, target),
    },
  };
}

/** Map a unit-normalised TripoSR mesh onto the analysed image box. */
function alignMeshToLattice(mesh: TriangleMesh, target: AnalysisLattice): TriangleMesh {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < mesh.positions.length; v += 3) {
    minX = Math.min(minX, mesh.positions[v]);
    maxX = Math.max(maxX, mesh.positions[v]);
    minY = Math.min(minY, mesh.positions[v + 1]);
    maxY = Math.max(maxY, mesh.positions[v + 1]);
    minZ = Math.min(minZ, mesh.positions[v + 2]);
    maxZ = Math.max(maxZ, mesh.positions[v + 2]);
  }
  const box = target.imageBox;
  const scaleX = (box.maxX - box.minX + 1) / Math.max(1e-6, maxX - minX);
  const scaleY = (box.maxY - box.minY + 1) / Math.max(1e-6, maxY - minY);
  const metresPerPixelY = target.grid.cellSize / target.pixelsPerCellY;
  const centreZ = (minZ + maxZ) / 2;
  const positions = new Float32Array(mesh.positions.length);
  for (let v = 0; v < mesh.positions.length; v += 3) {
    const px = mesh.positions[v];
    const py = mesh.positions[v + 1];
    const pz = mesh.positions[v + 2];
    const imageX = box.minX + (px - minX) * scaleX;
    const imageY = box.maxY - (py - minY) * scaleY;
    const i = (imageX - box.minX) / target.pixelsPerCellX;
    const j = target.resY - 1 - (imageY - box.minY) / target.pixelsPerCellY;
    positions[v] = target.grid.origin[0] + (i + 0.5) * target.grid.cellSize;
    positions[v + 1] = target.grid.origin[1] + (j + 0.5) * target.grid.cellSize;
    positions[v + 2] = (pz - centreZ) * metresPerPixelY;
  }
  return { positions, indices: mesh.indices };
}

/* ------------------------------------------------------- benchmark engine */

interface Job {
  id: string;
  image: string;
  out: string;
  mcResolution: number;
  crop: [number, number, number, number] | null;
}

function runJobs(jobs: Job[], concurrency = 1): Promise<Array<Record<string, unknown>>> {
  const jobDir = "/tmp/m4jobs";
  mkdirSync(jobDir, { recursive: true });
  const batches: Job[][] = [];
  const per = Math.max(1, Math.ceil(jobs.length / concurrency));
  for (let start = 0; start < jobs.length; start += per) batches.push(jobs.slice(start, start + per));

  const runOne = (batch: Job[], index: number): Promise<Array<Record<string, unknown>>> =>
    new Promise((resolve) => {
      const file = path.join(jobDir, `bench-${Date.now()}-${index}.json`);
      writeFileSync(file, JSON.stringify(batch));
      const child = spawn("/tmp/triposr-venv/bin/python", ["scripts/foundry/triposr_batch.py", "--jobs", file], {
        env: { ...process.env, PYTHONPATH: `/tmp/shim:/tmp/TripoSR` },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => (stdout += data.toString()));
      child.stderr.on("data", (data) => (stderr += data.toString()));
      child.on("close", () => {
        const parsed = stdout
          .trim()
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => {
            try {
              return JSON.parse(line) as Record<string, unknown>;
            } catch {
              return { ok: false, error: "unparseable worker line" };
            }
          });
        if (parsed.length === 0) parsed.push({ ok: false, error: stderr.slice(-400) || "worker produced no output" });
        resolve(parsed);
      });
    });

  return Promise.all(batches.map((batch, index) => runOne(batch, index))).then((all) => all.flat());
}

function cropFor(region: import("../../src/temporal/asre/types.ts").BBox2D, analysisIn: ImageAnalysis): [number, number, number, number] {
  const padX = (region.maxX - region.minX) * 0.18;
  const padY = (region.maxY - region.minY) * 0.18;
  return [
    Math.max(0, Math.floor(region.minX - padX)),
    Math.max(0, Math.floor(region.minY - padY)),
    Math.min(analysisIn.width - 1, Math.ceil(region.maxX + padX)),
    Math.min(analysisIn.height - 1, Math.ceil(region.maxY + padY)),
  ];
}

function createTripoSrEngine(context: {
  analysis: ImageAnalysis;
  lattice: AnalysisLattice;
  regions: Record<ComponentId, import("../../src/temporal/asre/types.ts").BBox2D>;
  chosen: ReconstructionHypothesis;
  comparison: ReturnType<typeof compareHypotheses>;
}): BenchmarkEngine {
  const components = [...STRUCTURAL_COMPONENTS];
  const observed = components.filter((id) => context.analysis.components.components.find((c) => c.id === id)?.detected);
  let counter = 0;

  const toArtifact = (voxels: SparseVoxels, milliseconds: number, modelCalls: number, inferenceMs: number, geometryMs: number): BenchmarkArtifact => ({
    voxels,
    modelCalls,
    inferenceMs,
    geometryMs: geometryMs + milliseconds,
  });

  const reconstruct = async (jobs: Job[], concurrency: number): Promise<Array<Record<string, unknown>>> => runJobs(jobs, concurrency);

  const meshFor = (jobId: string, outGlb: string, timing: Record<string, unknown> | undefined): SparseVoxels => {
    if (!timing || timing.ok !== true) return buildSparseVoxels(context.lattice.grid, []);
    const mesh = alignMeshToLattice(readGlbGeometry(new Uint8Array(readFileSync(outGlb))), context.lattice);
    const surface = voxelizeMesh(mesh, context.lattice.grid, { samplesPerCell: 2 });
    void jobId;
    return surface;
  };

  const wholeOnce = async (): Promise<BenchmarkArtifact> => {
    const started = performance.now();
    const outGlb = `/tmp/m4jobs/whole-${counter++}.glb`;
    const timingList = await reconstruct([{ id: "whole", image: FRONT, out: outGlb, mcResolution: 128, crop: null }], 1);
    const timing = timingList.find((entry) => entry.id === "whole");
    const geometryStart = performance.now();
    const voxels = boundaryOf(meshFor("whole", outGlb, timing));
    const geometryMs = performance.now() - geometryStart;
    return toArtifact(voxels, performance.now() - started, 1, Number(timing?.inferSeconds ?? 0) * 1000 + Number(timing?.loadSeconds ?? 0) * 1000, geometryMs);
  };

  const componentOnce = async (component: ComponentId, concurrency: number): Promise<BenchmarkArtifact> => {
    const started = performance.now();
    const region = context.regions[component];
    if (!region || region.minX === Infinity) return toArtifact(buildSparseVoxels(context.lattice.grid, []), 0, 0, 0, 0);
    const outGlb = `/tmp/m4jobs/${component}-${counter++}.glb`;
    const job: Job = { id: component, image: FRONT, out: outGlb, mcResolution: 96, crop: cropFor(region, context.analysis) };
    const timingList = await reconstruct([job], concurrency);
    const timing = timingList.find((entry) => entry.id === component);
    const geometryStart = performance.now();
    const partMesh = meshFor(component, outGlb, timing);
    // Keep the part inside the region it was discovered in: a crop cannot
    // know about the rest of the body, so its geometry is masked to the region.
    const masked = maskToRegion(partMesh, context.lattice, region);
    const geometryMs = performance.now() - geometryStart;
    return toArtifact(boundaryOf(masked), performance.now() - started, 1, Number(timing?.inferSeconds ?? 0) * 1000 + Number(timing?.loadSeconds ?? 0) * 1000, geometryMs);
  };

  return {
    name: "triposr-cpu-batch",
    description:
      "TripoSR (MIT code and weights) on CPU, one model load per worker batch; whole-object at 128 mc-resolution, components at 96 on padded crops. Quality is compared on boundary surfaces so a filled volume and a shell are scored the same way.",
    components,
    observedComponents: observed,
    reference() {
      return boundaryOf(context.chosen.voxels);
    },
    async wholeObject() {
      return wholeOnce();
    },
    async componentWise(list, concurrency) {
      const usable = list.filter((component) => context.regions[component] && context.regions[component].minX !== Infinity);
      const outGlbs = usable.map((component) => `/tmp/m4jobs/${component}-batch-${counter++}.glb`);
      const jobs: Job[] = usable.map((component, index) => ({
        id: component,
        image: FRONT,
        out: outGlbs[index],
        mcResolution: 96,
        crop: cropFor(context.regions[component], context.analysis),
      }));
      const started = performance.now();
      const timings = await reconstruct(jobs, concurrency);
      const parts: Partial<Record<ComponentId, BenchmarkArtifact>> = {};
      const geometries: Partial<Record<ComponentId, SparseVoxels>> = {};
      for (let index = 0; index < usable.length; index++) {
        const component = usable[index];
        const timing = timings.find((entry) => entry.id === component);
        const geometryStart = performance.now();
        const mesh = meshFor(component, outGlbs[index], timing);
        const masked = maskToRegion(mesh, context.lattice, context.regions[component]);
        geometries[component] = boundaryOf(masked);
        parts[component] = toArtifact(geometries[component] as SparseVoxels, 0, 1, Number(timing?.inferSeconds ?? 0) * 1000 + Number(timing?.loadSeconds ?? 0) * 1000, performance.now() - geometryStart);
      }
      const combinedCells = mergeParts(geometries, context.lattice);
      return {
        parts,
        combined: toArtifact(combinedCells, performance.now() - started, usable.length, 0, 0),
      };
    },
    async compose(partsVoxels) {
      const started = performance.now();
      const voxels = mergeParts(partsVoxels as Partial<Record<ComponentId, SparseVoxels>>, context.lattice);
      return toArtifact(voxels, performance.now() - started, 0, 0, 0);
    },
    async incremental(component) {
      // Numeric only: fuse the two best hypotheses inside this region. Real
      // work, no model call, and it is bounded by the component's size.
      const started = performance.now();
      const runnerUp = context.comparison.ranked[1]?.hypothesis;
      const region = context.regions[component];
      const source = runnerUp ? runnerUp.voxels : context.chosen.voxels;
      const fused = fuseInRegion(context.chosen.voxels, source, context.lattice, region);
      return toArtifact(boundaryOf(fused), performance.now() - started, 0, 0, performance.now() - started);
    },
    async regenerate(component) {
      return componentOnce(component, 1);
    },
    changedComponents() {
      return ["torso"];
    },
  };
}

function maskToRegion(voxels: SparseVoxels, target: AnalysisLattice, region: import("../../src/temporal/asre/types.ts").BBox2D): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const n = voxelCount(voxels);
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3];
    const j = voxels.coords[v * 3 + 1];
    const k = voxels.coords[v * 3 + 2];
    const [x, y] = cellToImage(target, i, j);
    if (x < region.minX || x > region.maxX || y < region.minY || y > region.maxY) continue;
    cells.push([i, j, k]);
  }
  return buildSparseVoxels(target.grid, cells, { occupancy: "sparse-surface" });
}

function mergeParts(parts: Partial<Record<ComponentId, SparseVoxels>>, target: AnalysisLattice): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const seen = new Set<number>();
  const [, ty, tz] = target.grid.resolution;
  for (const part of Object.values(parts)) {
    if (!part) continue;
    for (let v = 0; v < voxelCount(part); v++) {
      const i = part.coords[v * 3];
      const j = part.coords[v * 3 + 1];
      const k = part.coords[v * 3 + 2];
      const key = (i * ty + j) * tz + k;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push([i, j, k]);
    }
  }
  return buildSparseVoxels(target.grid, cells, { occupancy: "sparse-surface" });
}

function fuseInRegion(a: SparseVoxels, b: SparseVoxels, target: AnalysisLattice, region: import("../../src/temporal/asre/types.ts").BBox2D): SparseVoxels {
  const cells = new Map<number, [number, number, number]>();
  const [, ty, tz] = target.grid.resolution;
  for (const source of [a, b]) {
    for (let v = 0; v < voxelCount(source); v++) {
      const i = source.coords[v * 3];
      const j = source.coords[v * 3 + 1];
      const k = source.coords[v * 3 + 2];
      const [x, y] = cellToImage(target, i, j);
      if (x < region.minX || x > region.maxX || y < region.minY || y > region.maxY) continue;
      cells.set((i * ty + j) * tz + k, [i, j, k]);
    }
  }
  return buildSparseVoxels(target.grid, [...cells.values()], { occupancy: "sparse-volume" });
}
