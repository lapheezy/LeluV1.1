/**
 * The WP1 hypothesis set of a TripoSR job as NRE grids, callable from the
 * server job (the CLI `wp1-hypotheses.ts` keeps its own report format):
 *
 *   triposr       SYNTHESIZED  TripoSR occupancy (generative model)
 *   ellipse-hull  INFERRED     silhouette × elliptical cross-section prior
 *   depth-lift    INFERRED     Depth-Anything-V2-Small front surface + mirrored back
 *
 * Every grid also carries the one thing the image directly OBSERVED: the
 * front-visible TripoSR cells inside the input silhouette.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SparseVoxelGrid, type Observation, type Vec3 } from "../../src/core/asre/nre/index.ts";
import { readNpy } from "./io.ts";

export function triposrHypotheses(trDir: string, wpDir: string): Record<string, SparseVoxelGrid> {
  const tr = JSON.parse(readFileSync(path.join(trDir, "result.json"), "utf8"));
  const vs: number = tr.voxel_size;
  const lo: Vec3 = tr.lattice_origin_cells;
  const spec = { resolution: vs, origin: [lo[0] * vs, lo[1] * vs, lo[2] * vs] as Vec3, dims: tr.lattice_dims as Vec3, coordinateSystem: "z-up-right-handed" as const };
  const obs = (id: string, provenance: Observation["provenance"], confidence: number, modality: Observation["modality"], source: string): Observation => ({
    id, capturedAt: 0, source, modality, provenance, confidence, parameters: {}, fingerprint: `wp1:${id}:${tr.image}`, lineage: [String(tr.image)],
  });
  const files: Record<string, { obs: Observation; file: string }> = {
    triposr: { obs: obs("h1-triposr", "SYNTHESIZED", 0.5, "generative-model", "triposr@107cefd"), file: path.join(trDir, "cells.npy") },
    "ellipse-hull": { obs: obs("h2-ellipse-hull", "INFERRED", 0.5, "silhouette", "silhouette × elliptical cross-section prior"), file: path.join(wpDir, "ellipse-hull_cells.npy") },
    "depth-lift": { obs: obs("h3-depth-lift", "INFERRED", 0.6, "depth-map", "Depth-Anything-V2-Small front surface + mirrored back"), file: path.join(wpDir, "depth-lift_cells.npy") },
  };
  const front = readNpy(path.join(trDir, "cell_front_visible.npy")).data as Uint8Array;
  const tc = readNpy(path.join(trDir, "cells.npy")).data as Int32Array;
  const seen: Vec3[] = [];
  for (let k = 0; k < front.length; k++) if (front[k]) seen.push([tc[3 * k], tc[3 * k + 1], tc[3 * k + 2]]);
  const silhouette = obs("silhouette-front", "OBSERVED", 0.9, "silhouette", "input image, conditioning camera");
  const grids: Record<string, SparseVoxelGrid> = {};
  for (const [name, h] of Object.entries(files)) {
    if (!existsSync(h.file)) continue;
    const c = readNpy(h.file).data as Int32Array;
    const cells: Vec3[] = [];
    for (let i = 0; i < c.length; i += 3) cells.push([c[i], c[i + 1], c[i + 2]]);
    const g = new SparseVoxelGrid(spec);
    g.fuse(h.obs, cells);
    // the observed front surface supports a hypothesis only where it claims those cells
    g.fuse(silhouette, seen.filter(([x, y, z]) => g.has(x, y, z)));
    grids[name] = g;
  }
  return grids;
}

