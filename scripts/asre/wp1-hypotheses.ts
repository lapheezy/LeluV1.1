/**
 * WP1 — compare the competing hypotheses produced from ONE image and fuse
 * them without losing which evidence is which.
 *
 *   npx tsx scripts/asre/wp1-hypotheses.ts <triposr_dir> <wp1_dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SparseVoxelGrid, iou, type Observation, type Vec3 } from "../../src/core/asre/nre/index.ts";
import { uncertaintyReport } from "../../src/core/asre/volume/volumetric.ts";
import { vertexNormals } from "../../src/core/asre/volume/mesh.ts";
import { writeGlb, type GlbMaterial } from "../../src/core/asre/gltf/GlbWriter.ts";
import { inspectGlb } from "../../src/core/forge/GlbInspector.ts";
import { readNpy } from "./io.ts";
import { renderGlb } from "./runtime.ts";

const [trDir, wpDir] = process.argv.slice(2).map((p) => path.resolve(p));
const tr = JSON.parse(readFileSync(path.join(trDir, "result.json"), "utf8"));
const an = JSON.parse(readFileSync(path.join(wpDir, "analysis.json"), "utf8"));
const vs: number = tr.voxel_size;
const lo: Vec3 = tr.lattice_origin_cells;
const spec = { resolution: vs, origin: [lo[0] * vs, lo[1] * vs, lo[2] * vs] as Vec3, dims: tr.lattice_dims as Vec3, coordinateSystem: "z-up-right-handed" as const };

const obs = (id: string, provenance: Observation["provenance"], confidence: number, modality: Observation["modality"], source: string): Observation => ({
  id, capturedAt: Date.parse("2026-11-17T00:00:00Z"), source, modality, provenance, confidence, parameters: {}, fingerprint: `wp1:${id}`, lineage: [an.image],
});
const hyp: Record<string, { obs: Observation; file: string }> = {
  triposr: { obs: obs("h1-triposr", "SYNTHESIZED", 0.5, "generative-model", "triposr@107cefd"), file: path.join(trDir, "cells.npy") },
  "ellipse-hull": { obs: obs("h2-ellipse-hull", "INFERRED", 0.5, "silhouette", "silhouette × elliptical cross-section prior"), file: path.join(wpDir, "ellipse-hull_cells.npy") },
  "depth-lift": { obs: obs("h3-depth-lift", "INFERRED", 0.6, "depth-map", "Depth-Anything-V2-Small front surface + mirrored back"), file: path.join(wpDir, "depth-lift_cells.npy") },
};
const grids: Record<string, SparseVoxelGrid> = {};
const consensus = new SparseVoxelGrid(spec);
for (const [name, h] of Object.entries(hyp)) {
  const c = readNpy(h.file).data as Int32Array;
  const cells: Vec3[] = [];
  for (let i = 0; i < c.length; i += 3) cells.push([c[i], c[i + 1], c[i + 2]]);
  const g = new SparseVoxelGrid(spec);
  g.fuse(h.obs, cells);
  grids[name] = g;
  consensus.fuse(h.obs, cells);
}
// the one thing the single image directly OBSERVED: front-visible cells inside the silhouette
const front = readNpy(path.join(trDir, "cell_front_visible.npy")).data as Uint8Array;
const tc = readNpy(path.join(trDir, "cells.npy")).data as Int32Array;
const seen: Vec3[] = [];
for (let k = 0; k < front.length; k++) if (front[k]) seen.push([tc[3 * k], tc[3 * k + 1], tc[3 * k + 2]]);
consensus.fuse(obs("silhouette-front", "OBSERVED", 0.9, "silhouette", "input image, conditioning camera"), seen);

const names = Object.keys(grids);
const pairwise: Record<string, number> = {};
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairwise[`${names[i]}~${names[j]}`] = +iou(grids[names[i]], grids[names[j]]).toFixed(4);

// agreement: fraction of cells supported by ≥ 2 independent hypotheses
let agree2 = 0, agree3 = 0;
for (const [, cell] of consensus.entries()) {
  const hyps = cell.evidence.filter((e) => consensus.getObservations()[e.obs].id.startsWith("h")).length;
  if (hyps >= 2) agree2++;
  if (hyps === 3) agree3++;
}

const scored = (an.hypotheses as Array<Record<string, number | string>>).map((h) => {
  const circular = h.hypothesis === "depth-lift";
  const depthTerm = circular ? null : (h.depth_rank_correlation as number);
  // quality: silhouette fit and depth agreement with an INDEPENDENT estimate, plus prior.
  // A hypothesis without an independent depth check gets no depth credit.
  const quality = 0.45 * (h.silhouette_iou as number) + 0.4 * (depthTerm ?? 0) + 0.15 * (h.prior_confidence as number);
  return { ...h, depthCheckCircular: circular, quality: +quality.toFixed(4), qualityPerSecond: +(quality / Math.max(0.05, h.compute_seconds as number)).toFixed(3) };
});
scored.sort((a, b) => b.quality - a.quality);

// GLBs + renders of each hypothesis (canonical front: Rz(−90°))
const colors: Record<string, GlbMaterial["baseColor"]> = { triposr: [0.75, 0.55, 0.45, 1], "ellipse-hull": [0.45, 0.6, 0.8, 1], "depth-lift": [0.55, 0.75, 0.5, 1] };
const renders: Record<string, unknown> = {};
for (const name of names) {
  const vf = name === "triposr" ? [path.join(trDir, "mesh_vertices.npy"), path.join(trDir, "mesh_faces.npy")] : [path.join(wpDir, `${name}_vertices.npy`), path.join(wpDir, `${name}_faces.npy`)];
  const v = readNpy(vf[0]).data as Float32Array;
  const f = readNpy(vf[1]).data as Int32Array;
  const canon = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) canon.set([v[i + 1], -v[i], v[i + 2]], i);
  const mesh = { positions: canon, indices: new Uint32Array(f), normals: undefined as Float32Array | undefined };
  mesh.normals = vertexNormals(mesh);
  const glb = writeGlb([{ name: `hypothesis-${name}`, mesh, material: { name, baseColor: colors[name], roughness: 0.55 }, extras: { provenance: hyp[name].obs.provenance } }], { sourceAxes: "z-up-right-handed" });
  if (!inspectGlb(glb).verdict.meshValid) throw new Error(`${name}: GLB failed inspection`);
  const file = path.join(wpDir, `hypothesis_${name}.glb`);
  writeFileSync(file, glb);
  renders[name] = await renderGlb({ inputs: [file], output: path.join(wpDir, `hypothesis_${name}_three-quarter.png`), resolution: [384, 384], samples: 16, view: "three-quarter" });
  await renderGlb({ inputs: [file], output: path.join(wpDir, `hypothesis_${name}_side.png`), resolution: [384, 384], samples: 16, view: "side" });
}

const report = {
  image: an.image,
  analyses: Object.keys(an.analyses),
  concurrency: { wall_s: an.wall_s, sum_op_s: an.sum_op_s, gain: an.concurrency_gain },
  ranking: scored,
  selected: scored[0].hypothesis,
  pairwiseIou: pairwise,
  consensus: { cells: consensus.size, supportedBy2plus: agree2, supportedBy3: agree3, provenance: consensus.countByProvenance(), uncertainty: uncertaintyReport(consensus) },
  notes: [
    "depth-lift is built from the depth map it is scored against: its depth correlation is circular and excluded from its quality score",
    "triposr vs Depth-Anything depth agreement is between two independent models",
  ],
};
writeFileSync(path.join(wpDir, "hypotheses.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ranking: scored.map((s) => [s.hypothesis, s.quality, s.qualityPerSecond]), selected: report.selected, pairwise, consensus: report.consensus }, null, 1));
