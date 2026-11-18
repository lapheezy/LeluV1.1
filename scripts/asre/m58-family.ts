#!/usr/bin/env node
/**
 * LÉLU — MISSION 5.8 — PER-FAMILY ANATOMY BENCHMARK
 *
 *   npx tsx scripts/asre/m58-family.ts --family hands [--out artifacts/mission58/hands]
 *
 * One anatomical family at a time, measured on the real build:
 *   - GLB + per-component triangles/cells/vertices/samples/ms
 *   - surface error |SDF(vertex)| and normal-vs-gradient deviation
 *   - topology: watertight, consistently oriented, degenerate triangles, volume
 *   - articulation at real joint landmarks (handSkeleton), not from pixels
 *   - landmarks provably inside the surface (f < 0), so the skeleton drives it
 *   - component regeneration: only the family rebuilds, the face is byte-equal
 *   - determinism: two cold builds give identical component hashes
 *   - joint continuity: the hand root is embedded in the forearm (no gap)
 *   - occupancy: the shared-lattice IoU against the whole-object build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { DEFAULT_LATTICE, buildCharacter, buildWholeObject, codesIou, componentCodes, glbParts, occupancyCodes, plan, type Lattice } from "../../src/core/asre/character/build.ts";
import { COMPONENTS, COMPONENT_ORDER, contextFor, type ComponentId } from "../../src/core/asre/character/components.ts";
import { componentRecord } from "../../src/core/asre/character/identity.ts";
import { handLocal, handSkeleton } from "../../src/core/asre/character/anatomy.ts";
import type { Shape } from "../../src/core/asre/character/shape.ts";
import { analyzeMesh, vertexNormals, type Mesh } from "../../src/core/asre/volume/mesh.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const FAMILY = flag("family", "hands");
const OUT = path.resolve(flag("out", `artifacts/mission58/${FAMILY}`));
const L: Lattice = DEFAULT_LATTICE;
mkdirSync(OUT, { recursive: true });

const round = (n: number, d = 3) => +n.toFixed(d);
const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

function accuracy(shape: Shape | null, mesh: Mesh) {
  const n = mesh.positions.length / 3;
  if (!shape || !n) return { surfaceErrorMm: null, normalErrorDeg: null };
  const normals = mesh.normals ?? vertexNormals(mesh);
  const h = 1e-4;
  const err: number[] = [];
  const ang: number[] = [];
  for (let v = 0; v < n; v++) {
    const x = mesh.positions[3 * v], y = mesh.positions[3 * v + 1], z = mesh.positions[3 * v + 2];
    err.push(Math.abs(shape.f(x, y, z)) * 1000);
    if (!mesh.normals) continue;
    const gx = shape.f(x + h, y, z) - shape.f(x - h, y, z);
    const gy = shape.f(x, y + h, z) - shape.f(x, y - h, z);
    const gz = shape.f(x, y, z + h) - shape.f(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz) || 1;
    ang.push((Math.acos(Math.max(-1, Math.min(1, (normals[3 * v] * gx + normals[3 * v + 1] * gy + normals[3 * v + 2] * gz) / gl))) * 180) / Math.PI);
  }
  err.sort((a, b) => a - b);
  ang.sort((a, b) => a - b);
  return {
    surfaceErrorMm: { mean: round(err.reduce((a, b) => a + b, 0) / err.length), p95: round(q(err, 0.95)), max: round(err[err.length - 1]) },
    normalErrorDeg: ang.length ? { mean: round(ang.reduce((a, b) => a + b, 0) / ang.length, 2), p95: round(q(ang, 0.95), 2), max: round(ang[ang.length - 1], 2) } : null,
  };
}

/** Everything about one component already built (no rebuild — memory is bounded). */
function inspect(spec: CharacterSpec, c: ReturnType<typeof buildCharacter>["components"][number]) {
  const id = c.id;
  const p = plan(spec, L);
  const rep = analyzeMesh(c.local!.mesh);
  return {
    id,
    hMeshMm: round(c.hMesh * 1000, 2),
    cells: c.local!.cells.length / 3,
    vertices: rep.vertices,
    triangles: rep.triangles,
    samples: c.local!.samples,
    buildMs: round(c.ms, 1),
    watertight: rep.watertight,
    consistentlyOriented: rep.consistentlyOriented,
    degenerateTriangles: rep.degenerateTriangles,
    boundaryEdges: rep.boundaryEdges,
    nonManifoldEdges: rep.nonManifoldEdges,
    repairedByVertexSplit: c.local!.repairedEdges ?? 0,
    signedVolume: round(rep.signedVolume, 7),
    bounds: { min: rep.bounds.min.map((v) => round(v)), max: rep.bounds.max.map((v) => round(v)) },
    ...accuracy(COMPONENTS[id].build(contextFor(spec, p.sk)), c.local!.mesh),
  };
}

/* ------------------------------- the family ------------------------------- */

const FAMILY_NODES: Record<string, ComponentId[]> = { hands: ["hands", "arms"], feet: ["feet", "legs", "clothing.shoes"], head: ["head", "face", "hair", "neck"] };
const nodes = FAMILY_NODES[FAMILY] ?? [FAMILY as ComponentId];

const variants: Array<{ label: string; spec: CharacterSpec }> =
  FAMILY === "hands"
    ? [
        { label: "hands-base", spec: BASE_CHARACTER },
        { label: "hands-open", spec: withChanges(BASE_CHARACTER, { hands: { curl: 0, spread: 0, opposition: 0 } }) },
        { label: "hands-spread", spec: withChanges(BASE_CHARACTER, { hands: { curl: 0.1, spread: 1, opposition: 0.3 } }) },
        { label: "hands-fist", spec: withChanges(BASE_CHARACTER, { hands: { curl: 1.6, spread: 0.1, opposition: 0.9 } }) },
        { label: "hands-clenched", spec: withChanges(BASE_CHARACTER, { hands: { curl: 2, spread: 0, opposition: 1 } }) },
        { label: "hands-tall", spec: withChanges(BASE_CHARACTER, { body: { height: 1.84 } }) },
      ]
    : [{ label: `${FAMILY}-base`, spec: BASE_CHARACTER }];

const runs = [];
let baseFull: ReturnType<typeof buildCharacter> | null = null;
for (const v of variants) {
  const t0 = performance.now();
  // only the family is built: a benchmark of the hands must not allocate a
  // 600k-triangle character six times (that is what ran the heap out)
  const build = buildCharacter(v.spec, null, L, nodes);
  const ms = performance.now() - t0;
  const glb = writeGlb(glbParts(build, v.spec), { generator: "LÉLU ASRE character (M5.8)", extras: { label: v.label } });
  writeFileSync(path.join(OUT, `${v.label}.glb`), glb);
  const family = build.components.map((c) => inspect(v.spec, c));
  runs.push({ label: v.label, file: path.relative(process.cwd(), path.join(OUT, `${v.label}.glb`)), glbBytes: glb.length, buildMs: round(ms, 1), familyTriangles: family.reduce((a, c) => a + c.triangles, 0), family });
  console.log(`${v.label.padEnd(16)} ${String(Math.round(ms)).padStart(5)} ms  ${(glb.length / 1048576).toFixed(1)} MB  ${family.reduce((a, c) => a + c.triangles, 0)} family tris`);
  if (v.label === `${FAMILY}-base`) baseFull = build;
}
if (baseFull) {
  const full = buildCharacter(BASE_CHARACTER, null, L);
  const glb = writeGlb(glbParts(full, BASE_CHARACTER), { generator: "LÉLU ASRE character (M5.8)", extras: { label: "full-body" } });
  writeFileSync(path.join(OUT, "full-body.glb"), glb);
  console.log(`full-body        ${(glb.length / 1048576).toFixed(1)} MB  ${full.components.reduce((a, c) => a + c.local!.mesh.indices.length / 3, 0)} tris`);
}

/* ------------------------------- articulation ------------------------------- */

function landmarks(spec: CharacterSpec) {
  const s = handSkeleton(spec);
  return { tips: s.tips, thumbTip: s.thumbTip, knuckles: s.knuckles };
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const articulation: Record<string, unknown> = {};
if (FAMILY === "hands") {
  const open = landmarks(withChanges(BASE_CHARACTER, { hands: { curl: 0, spread: 0, opposition: 0 } }));
  const fist = landmarks(withChanges(BASE_CHARACTER, { hands: { curl: 2, spread: 0, opposition: 1 } }));
  const spread = landmarks(withChanges(BASE_CHARACTER, { hands: { curl: 0, spread: 1, opposition: 0 } }));
  const flex = landmarks(withChanges(BASE_CHARACTER, { hands: { curl: 1, spread: 0, opposition: 0 } }));
  // landmarks are in the hand's OWN frame, so test the canonical local hand
  const local = handLocal(BASE_CHARACTER);
  // every landmark must be INSIDE the surface (f < 0): the skeleton is what
  // the shape is built around, not a parallel story
  const inside = [...landmarks(BASE_CHARACTER).tips.map((t) => local.f(t[0], t[1], t[2])), local.f(...(landmarks(BASE_CHARACTER).thumbTip as [number, number, number]))];
  articulation.skeleton = {
    fingertipTravelOpenToFistMm: round(Math.max(...open.tips.map((t, i) => dist(t, fist.tips[i]))) * 1000, 1),
    fingertipTravelOpenToHalfFlexMm: round(Math.max(...open.tips.map((t, i) => dist(t, flex.tips[i]))) * 1000, 1),
    spreadWidthChangeMm: round((Math.max(...spread.tips.map((t) => t[0])) - Math.max(...open.tips.map((t) => t[0]))) * 1000, 1),
    thumbTipTravelMm: round(dist(open.thumbTip, fist.thumbTip) * 1000, 1),
    landmarkDigits: open.tips.length,
    landmarksInsideSurface: inside.every((v) => v < 0),
    landmarkSignedDistanceMm: inside.map((v) => round(v * 1000, 2)),
  };

  // joint continuity: the hand's wrist ring must be inside the forearm
  const arms = buildCharacter(BASE_CHARACTER, null, L, ["arms"]).components[0];
  const armShape = COMPONENTS.arms.build(contextFor(BASE_CHARACTER, plan(BASE_CHARACTER, L).sk))!;
  const sk = plan(BASE_CHARACTER, L).sk;
  const wristInside = [0, 1].map((side) => {
    const w = sk.wrist[side];
    let worst = -Infinity;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const r = 0.012;
      worst = Math.max(worst, armShape.f(w[0] + Math.cos(ang) * r, w[1] + Math.sin(ang) * r, w[2]));
    }
    return { side, worstSampleMm: round(worst * 1000, 2), inside: worst < 0 };
  });
  const handCells = new Set(componentCodes(buildCharacter(BASE_CHARACTER, null, L, ["hands"]).components[0], L));
  const armCells = new Set(componentCodes(arms, L));
  let shared = 0;
  for (const c of handCells) if (armCells.has(c)) shared++;
  articulation.joint = { wristSamples: wristInside, sharedOccupancyCellsWithForearm: shared, handCells: handCells.size, armCells: armCells.size };
}

/* ------------------------- regeneration and identity ------------------------- */

const cache = new (await import("../../src/core/asre/character/build.ts")).ComponentCache();
const v1 = buildCharacter(BASE_CHARACTER, cache, L);
const edited = buildCharacter(withChanges(BASE_CHARACTER, { hands: { curl: 1.4 } }), cache, L);
const regeneration = {
  regenerated: edited.regenerated,
  recolored: edited.recolored,
  reused: edited.reused.length,
  facePreserved: componentRecord(edited.components.find((c) => c.id === "face")!).geometrySha === componentRecord(v1.components.find((c) => c.id === "face")!).geometrySha,
  headPreserved: componentRecord(edited.components.find((c) => c.id === "head")!).geometrySha === componentRecord(v1.components.find((c) => c.id === "head")!).geometrySha,
  hairPreserved: componentRecord(edited.components.find((c) => c.id === "hair")!).geometrySha === componentRecord(v1.components.find((c) => c.id === "hair")!).geometrySha,
};

const detA = buildCharacter(BASE_CHARACTER, null, L);
const detB = buildCharacter(BASE_CHARACTER, null, L);
const determinism = {
  identicalComponents: COMPONENT_ORDER.filter((id) => {
    const a = detA.components.find((c) => c.id === id)!, b = detB.components.find((c) => c.id === id)!;
    return componentRecord(a).geometrySha === componentRecord(b).geometrySha && componentRecord(a).materialSha === componentRecord(b).materialSha;
  }).length,
  components: COMPONENT_ORDER.length,
};

const whole = buildWholeObject(BASE_CHARACTER, L);
const iou = codesIou(occupancyCodes(detA, L), whole.codes);

const report = {
  mission: "Mission 5.8 — WP02 anatomical vocabulary",
  family: FAMILY,
  generatedAt: new Date().toISOString(),
  node: process.version,
  lattice: { cellsMm: L.resolution * 1000, detail: L.detail },
  note: "surfaceErrorMm is |SDF(vertex)|; normalErrorDeg compares mesh normals with the analytic SDF gradient; articulation is measured at handSkeleton joint positions.",
  runs,
  articulation,
  regeneration,
  determinism,
  occupancy: { iouWithWholeObject: iou, cells: whole.codes.size, wholeObjectMs: round(whole.ms, 1) },
  verdict: {
    /** No boundary edges anywhere: every component is closed. */
    closedEverywhere: runs.every((r) => r.family.every((c) => c.boundaryEdges === 0)),
    /** Strict manifold test (closed AND no edge shared by >2 triangles). */
    manifoldEverywhere: runs.every((r) => r.family.every((c) => c.watertight)),
    nonManifoldEdgesPerVariant: runs.map((r) => ({ label: r.label, edges: r.family.reduce((a, c) => a + c.nonManifoldEdges, 0), total: Math.round(r.family.reduce((a, c) => a + c.triangles, 0) * 1.5) })),
    oriented: runs.every((r) => r.family.every((c) => c.consistentlyOriented)),
    noDegenerate: runs.every((r) => r.family.every((c) => c.degenerateTriangles === 0)),
    iouIsOne: iou === 1,
    deterministic: determinism.identicalComponents === determinism.components,
    onlyFamilyRebuilt: regeneration.regenerated.length === 1 && regeneration.regenerated[0] === FAMILY,
  },
};
writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ articulation: report.articulation, regeneration, determinism, occupancy: report.occupancy, verdict: report.verdict }, null, 1));
