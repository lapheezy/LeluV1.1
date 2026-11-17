/**
 * ==========================================================
 * LÉLU ASRE — RECONSTRUCTION PIPELINE (pure, engine-neutral)
 *
 *   views → hypotheses → comparison → selected geometry
 *         → (more views) Flipbook refinement with contradictions
 *         → evidence breakdown → mesh with per-vertex colour → GLB parts
 *
 * Every function here is deterministic and free of Node/DOM, so the
 * server job, the tests and a future browser worker run the same code.
 * Hypothesis comparison (`compareHypotheses`) is shared with the
 * TripoSR path, whose hypotheses come from the Python workers.
 * ==========================================================
 */

import { iou, SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import { mortonDecode } from "../nre/morton.ts";
import type { Vec3 } from "../nre/types.ts";
import { Flipbook } from "../temporal/Flipbook.ts";
import { surfaceNets, analyzeMesh, type Mesh } from "../volume/mesh.ts";
import { volumeStats, meanConfidence } from "../volume/volumetric.ts";
import { assessCoverage } from "../analysis/coverage.ts";
import { emptyBreakdown, evidenceClass, type CoverageSummary, type EvidenceBreakdown, type ObservationReport } from "../contracts.ts";
import type { GlbPart } from "../gltf/GlbWriter.ts";
import type { RgbaImage } from "../image/png.ts";
import {
  HYPOTHESES,
  hypothesisGrid,
  project,
  resurface,
  silhouetteOf,
  viewDirection,
  viewPages,
  type HypothesisId,
  type ReconstructionFrame,
  type Silhouette,
  type ViewEvidence,
  type ViewName,
} from "./silhouette.ts";

export interface HypothesisComparison {
  ids: string[];
  pairwiseIou: Record<string, number>;
  /** Mean IoU of each hypothesis with every other one. */
  agreement: Record<string, number>;
  /** Hypotheses ordered by agreement (the medoid first). */
  ranking: string[];
  selected: string;
  /** Cells claimed by at least two hypotheses. */
  consensusCells: number;
  /** Cells claimed by exactly one hypothesis, over the union. */
  disagreementFraction: number;
}

/** Compare competing hypotheses; select the one the others agree with most (the medoid). */
export function compareHypotheses(grids: Record<string, SparseVoxelGrid>): HypothesisComparison {
  const ids = Object.keys(grids);
  if (!ids.length) throw new Error("no hypotheses to compare");
  const pairwiseIou: Record<string, number> = {};
  const agreement: Record<string, number> = {};
  for (const a of ids) agreement[a] = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const v = iou(grids[ids[i]], grids[ids[j]]);
      pairwiseIou[`${ids[i]}|${ids[j]}`] = v;
      agreement[ids[i]] += v / (ids.length - 1);
      agreement[ids[j]] += v / (ids.length - 1);
    }
  const votes = new Map<number, number>();
  for (const id of ids) for (const code of grids[id].codes()) votes.set(code, (votes.get(code) ?? 0) + 1);
  let consensus = 0, single = 0;
  for (const c of votes.values()) {
    if (c >= 2) consensus++;
    else single++;
  }
  const ranking = [...ids].sort((a, b) => agreement[b] - agreement[a] || a.localeCompare(b));
  return { ids, pairwiseIou, agreement, ranking, selected: ranking[0], consensusCells: consensus, disagreementFraction: votes.size ? single / votes.size : 0 };
}

export function evidenceBreakdown(grid: SparseVoxelGrid): EvidenceBreakdown {
  const b = emptyBreakdown();
  for (const [, cell] of grid.entries()) b[evidenceClass(cell.provenance)]++;
  return b;
}

export function coverageSummary(grid: SparseVoxelGrid, front: Vec3, up: Vec3): CoverageSummary {
  const r = assessCoverage(grid, front, up);
  return {
    sides: r.sides.map((s) => ({ side: s.side, cells: s.cells, unsupported: s.unsupported, meanConfidence: s.meanConfidence })),
    overallUnsupported: r.overallUnsupported,
    requests: r.requests,
  };
}

export interface ViewInput {
  view: ViewName;
  image: RgbaImage;
  evidence: ViewEvidence;
}

export interface SilhouetteReconstruction {
  frame: ReconstructionFrame;
  silhouettes: Silhouette[];
  hypotheses: Record<HypothesisId, SparseVoxelGrid>;
  comparison: HypothesisComparison;
  /** Selected hypothesis refined by every further view. */
  book: Flipbook;
  observations: ObservationReport[];
}

/** One or more views → hypotheses from the first, refined by the rest. */
export function reconstructFromViews(views: ViewInput[], frame: ReconstructionFrame): SilhouetteReconstruction {
  if (!views.length) throw new Error("at least one view is needed");
  const seen = new Set<string>();
  for (const v of views) {
    if (seen.has(v.view)) throw new Error(`two images for the ${v.view} view`);
    seen.add(v.view);
  }
  const silhouettes = views.map((v) => silhouetteOf(v.image, v.view, frame.n));
  const first = views[0];
  const hypotheses = {} as Record<HypothesisId, SparseVoxelGrid>;
  for (const id of Object.keys(HYPOTHESES) as HypothesisId[]) hypotheses[id] = hypothesisGrid(silhouettes[0], id, frame, first.evidence);
  const comparison = compareHypotheses(hypotheses);
  const book = new Flipbook(hypotheses[comparison.selected as HypothesisId], `${first.view} view · ${comparison.selected} hypothesis`);
  const r: SilhouetteReconstruction = { frame, silhouettes, hypotheses, comparison, book, observations: [] };
  for (let i = 1; i < views.length; i++) r.observations.push(addView(r, views[i], silhouettes[i]));
  return r;
}

/** Refine an existing reconstruction with one more view (incremental: only touched blocks change). */
export function addView(r: SilhouetteReconstruction, input: ViewInput, sil?: Silhouette): ObservationReport {
  const s = sil ?? silhouetteOf(input.image, input.view, r.frame.n);
  if (!sil) {
    if (r.silhouettes.some((e) => e.view === input.view) && r.book.current.getObservations().some((o) => o.fingerprint === `silhouette:${input.view}:${input.evidence.imageSha256}`)) {
      // the same image again: a duplicate page changes nothing
    } else if (r.silhouettes.some((e) => e.view === input.view)) {
      throw new Error(`the ${input.view} view is already part of this reconstruction`);
    }
  }
  const before = r.book.current;
  const earlier = r.silhouettes.filter((e) => e.view !== s.view);
  const pages = viewPages(before, s, earlier, r.frame, input.evidence);
  const a = r.book.turn({ observation: pages.surface.observation, occupied: pages.surface.occupied, free: pages.surface.free, freeConfidence: 0.85 }, `${input.view} view · surface`);
  const b = pages.hull.occupied.length ? r.book.turn({ observation: pages.hull.observation, occupied: pages.hull.occupied }, `${input.view} view · visual hull`) : null;
  if (!r.silhouettes.includes(s)) r.silhouettes.push(s);
  // a silhouette's OBSERVED support follows the nearest surface under its pixels
  const moved = resurface(r.book.current, r.silhouettes, r.frame.n);
  if (moved.stripped || moved.attached)
    r.book.commit(moved.grid, `${input.view} view · re-surfacing`, [
      { kind: "note", text: `silhouette evidence re-attributed to the current nearest surface: ${moved.stripped} hidden cells lost it, ${moved.attached} visible cells gained it` },
    ]);
  const after = r.book.current;
  return {
    view: input.view,
    duplicate: a.duplicate,
    resurfaced: { stripped: moved.stripped, attached: moved.attached },
    newCells: a.newCells + (b?.newCells ?? 0),
    reinforcedCells: a.reinforcedCells + (b?.reinforcedCells ?? 0),
    conflicts: a.conflicts,
    carved: a.carved,
    contradictions: a.conflictsKept,
    preservedCells: a.preservedCells,
    unaffectedVerified: a.unaffectedVerified && (b?.unaffectedVerified ?? true),
    evidenceBefore: evidenceBreakdown(before),
    evidenceAfter: evidenceBreakdown(after),
    meanConfidenceBefore: meanConfidence(before),
    meanConfidenceAfter: meanConfidence(after),
    iouWithPrevious: iou(before, after),
  };
}

/* ------------------------------------ mesh ------------------------------------ */

const srgbToLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/**
 * Occupancy → smoothed scalar field → surface nets → metres, standing on
 * y = 0. Each vertex takes its colour from the view that faces it most
 * directly and sees it inside its silhouette; otherwise a neutral grey.
 */
export function meshGrid(grid: SparseVoxelGrid, frame: ReconstructionFrame, silhouettes: Silhouette[] = []): { mesh: Mesh; colorSources: Record<string, number> } {
  const n = frame.n;
  const P = n + 4; // two cells of padding each side
  const occ = new Float32Array(P * P * P);
  const idx = (x: number, y: number, z: number) => (x * P + y) * P + z;
  for (const [code] of grid.entries()) {
    const [x, y, z] = mortonDecode(code);
    occ[idx(x + 2, y + 2, z + 2)] = 1;
  }
  // separable 3-tap blur: rounds the voxel staircase without moving the surface
  const blur = (src: Float32Array, axis: 0 | 1 | 2) => {
    const out = new Float32Array(src.length);
    const step = axis === 0 ? P * P : axis === 1 ? P : 1;
    for (let x = 1; x < P - 1; x++)
      for (let y = 1; y < P - 1; y++)
        for (let z = 1; z < P - 1; z++) {
          const i = idx(x, y, z);
          out[i] = 0.25 * src[i - step] + 0.5 * src[i] + 0.25 * src[i + step];
        }
    return out;
  };
  const field = blur(blur(blur(occ, 0), 1), 2);
  for (let i = 0; i < field.length; i++) field[i] = 0.5 - field[i];
  const h = frame.heightMeters / n;
  // cell centre (x + 0.5) h in grid-local metres, then centred on x = z = 0
  const mesh = surfaceNets({ values: field, dims: [P, P, P], origin: [(-2 + 0.5 - n / 2) * h, (-2 + 0.5) * h, (-2 + 0.5 - n / 2) * h], spacing: h });
  const colors = new Float32Array((mesh.positions.length / 3) * 4);
  const colorSources: Record<string, number> = { neutral: 0 };
  const normals = mesh.normals!;
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const cx = Math.min(n - 1, Math.max(0, Math.floor(mesh.positions[3 * v] / h + n / 2)));
    const cy = Math.min(n - 1, Math.max(0, Math.floor(mesh.positions[3 * v + 1] / h)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor(mesh.positions[3 * v + 2] / h + n / 2)));
    let best: Silhouette | null = null, bestDot = 0.2;
    for (const s of silhouettes) {
      const d = viewDirection(s.view);
      const dot = normals[3 * v] * d[0] + normals[3 * v + 1] * d[1] + normals[3 * v + 2] * d[2];
      const p = project(s.view, n, cx, cy, cz);
      if (dot > bestDot && s.mask[p.v * n + p.u]) [best, bestDot] = [s, dot];
    }
    let rgb: [number, number, number] = [0.55, 0.55, 0.58];
    if (best) {
      const p = project(best.view, n, cx, cy, cz);
      const k = 3 * (p.v * n + p.u);
      rgb = [best.color[k], best.color[k + 1], best.color[k + 2]];
      colorSources[best.view] = (colorSources[best.view] ?? 0) + 1;
    } else colorSources.neutral++;
    colors.set([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]), 1], 4 * v);
  }
  mesh.colors = colors;
  return { mesh, colorSources };
}

export function gridFacts(grid: SparseVoxelGrid) {
  const st = volumeStats(grid);
  return { cells: grid.size, boundary: st.boundary, interior: st.interior, meanConfidence: meanConfidence(grid) };
}

export function meshFacts(mesh: Mesh) {
  const r = analyzeMesh(mesh);
  return r;
}

export function reconstructionPart(name: string, mesh: Mesh, extras: Record<string, unknown>): GlbPart {
  return { name, mesh, material: { name: `${name}-vertex-colour`, baseColor: [1, 1, 1, 1], roughness: 0.6 }, extras };
}
