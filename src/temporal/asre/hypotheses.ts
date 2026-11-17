/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — COMPETING RECONSTRUCTION HYPOTHESES
 *
 * One photograph does not determine one solid. It determines a silhou-
 * ette, a shading field and a set of landmarks — and then it stops. What
 * happens in depth is a *choice*, and different defensible choices give
 * different bodies:
 *
 *   silhouette-slab    the largest volume consistent with the silhouette
 *                      (a one-view visual hull): every column extends as
 *                      deep as its own row is wide
 *   inflated-symmetric circular cross-sections: half-depth equals the
 *                      inscribed radius read from the distance transform
 *   shading-relief     front surface from the shading bulge, flat back
 *   block-prismatic    constant thickness per anatomical region, like a
 *                      cut-out with a back face
 *
 * Every one of them is built, measured and compared — none is assumed to
 * be the right one. Only the *visible* front cap is labelled OBSERVED;
 * everything behind it is labelled for what it is. A back surface is
 * never reported as photographed, whoever wins.
 * ==========================================================
 */

import type { AttributeChannel, SparseVoxels } from "../nre/types.ts";
import { DEFAULT_CONFIDENCE_CHANNEL, buildSparseVoxels, voxelCount } from "../nre/voxels.ts";
import { measureVolume } from "../nre/volume.ts";
import type { ImageAnalysis } from "./image.ts";
import { cellToImage, pixelsToCells, rowForCellJ, type AnalysisLattice } from "./lattice.ts";
import type { Provenance } from "./types.ts";
import { PROVENANCE_CODE, PROVENANCE_ORDER } from "./types.ts";

export const PROVENANCE_CHANNEL: AttributeChannel = {
  name: "provenance",
  kind: "f32",
  components: 1,
  quantisation: null,
  componentsMeaning: ["observed=0, inferred=1, synthesized=2, interpolated=3"],
};

export type HypothesisKind = "silhouette-slab" | "inflated-symmetric" | "shading-relief" | "block-prismatic" | "combined";

export interface DepthColumn {
  /** Cells toward the viewer from the mid-plane. */
  front: number;
  /** Cells away from the viewer from the mid-plane. */
  back: number;
  provenance: Provenance;
  confidence: number;
  why: string;
}

export interface ReconstructionHypothesis {
  id: string;
  kind: HypothesisKind;
  label: string;
  /** Provenance of the bulk of the volume: never OBSERVED for unseen depth. */
  provenance: Provenance;
  voxels: SparseVoxels;
  /** Per-voxel provenance code, aligned with voxels.coords. */
  cellProvenance: Uint8Array;
  /** Cells by provenance, for the report. */
  provenanceCounts: Record<Provenance, number>;
  /** Per-(i,j) front/back depth in cells, plus the column's own confidence. */
  depth: { front: Float32Array; back: Float32Array; covered: Uint8Array; confidence: Float32Array };
  /** The rule, stated in words, so the hypothesis can be argued with. */
  rule: string;
  notes: string[];
  buildMs: number;
}

const MAX_CELLS = 1e9;

function clampCell(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

interface BuildInput {
  id: string;
  kind: HypothesisKind;
  label: string;
  rule: string;
  notes?: string[];
  column: (i: number, j: number, x: number, y: number) => DepthColumn;
}

function buildHypothesis(lattice: AnalysisLattice, input: BuildInput): ReconstructionHypothesis {
  const started = performance.now();
  const { resX, resY, resZ, midZ } = lattice;
  const cells: Array<[number, number, number]> = [];
  const confidences: number[] = [];
  const provenances: number[] = [];
  const front = new Float32Array(resX * resY);
  const back = new Float32Array(resX * resY);
  const covered = new Uint8Array(resX * resY);
  const columnConfidence = new Float32Array(resX * resY);
  const counts: Record<Provenance, number> = { OBSERVED: 0, INFERRED: 0, SYNTHESIZED: 0, INTERPOLATED: 0 };

  const halfZ = Math.max(0, Math.floor((resZ - 1) / 2));

  for (let j = 0; j < resY; j++) {
    for (let i = 0; i < resX; i++) {
      if (lattice.coverage[j * resX + i] <= 0.5) continue;
      const [x, y] = cellToImage(lattice, i, j);
      const column = input.column(i, j, x, y);
      const frontCells = clampCell(column.front, 0, halfZ);
      const backCells = clampCell(column.back, 0, halfZ);
      front[j * resX + i] = frontCells;
      back[j * resX + i] = backCells;
      covered[j * resX + i] = 1;
      columnConfidence[j * resX + i] = column.confidence;
      if (cells.length > MAX_CELLS) throw new Error("Hypothesis exceeded the lattice cell budget; the depth rule is diverging.");

      for (let k = midZ - backCells; k <= midZ + frontCells; k++) {
        if (k < 0 || k >= resZ) continue;
        cells.push([i, j, k]);
        // The visible front cap is the only surface the image supports. The
        // back cap is always manufactured, and says so.
        const isFrontCap = k === midZ + frontCells;
        const isBackCap = k === midZ - backCells;
        const cellProvenance: Provenance = isFrontCap ? "OBSERVED" : isBackCap ? "SYNTHESIZED" : "INFERRED";
        provenances.push(PROVENANCE_CODE[cellProvenance]);
        counts[cellProvenance]++;
        const depthPenalty = isFrontCap ? 1 : isBackCap ? 0.35 : 0.6;
        confidences.push(Math.max(0, Math.min(1, column.confidence * depthPenalty)));
      }
    }
  }

  const voxels = buildSparseVoxels(lattice.grid, cells, {
    occupancy: "sparse-volume",
    channels: [DEFAULT_CONFIDENCE_CHANNEL, PROVENANCE_CHANNEL],
    attributes: { confidence: confidences, provenance: provenances.map(Number) },
  });

  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    provenance: "SYNTHESIZED",
    voxels,
    cellProvenance: Uint8Array.from(provenances),
    provenanceCounts: counts,
    depth: { front, back, covered, confidence: columnConfidence },
    rule: input.rule,
    notes: input.notes ?? [],
    buildMs: performance.now() - started,
  };
}

/* ------------------------------------------------------------------ rules */

interface RowHalfWidth {
  /** Half-width in cells, per lattice row (indexed by lattice j). */
  halfWidthCells: Float32Array;
  maxHalfWidthCells: number;
}

function rowHalfWidths(lattice: AnalysisLattice, analysis: ImageAnalysis): RowHalfWidth {
  const out = new Float32Array(lattice.resY);
  let max = 0;
  for (let j = 0; j < lattice.resY; j++) {
    const y = rowForCellJ(lattice, j);
    const row = analysis.silhouette.rows.find((r) => Math.abs(r.y - Math.round(y)) <= 1);
    if (!row || row.minX < 0) continue;
    const halfCells = pixelsToCells(lattice, (row.maxX - row.minX + 1) / 2);
    out[j] = halfCells;
    if (halfCells > max) max = halfCells;
  }
  return { halfWidthCells: out, maxHalfWidthCells: max };
}

function sampleField(field: Float32Array, analysis: ImageAnalysis, x: number, y: number): number {
  const px = Math.max(0, Math.min(analysis.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(analysis.height - 1, Math.round(y)));
  return field[py * analysis.width + px];
}

export interface HypothesisOptions {
  /** Where the volume sits relative to the mid-plane: 0.5 centres it. */
  depthBias?: number;
}

/** The four single-view hypotheses, all on one lattice. */
export function buildHypotheses(lattice: AnalysisLattice, analysis: ImageAnalysis, options: HypothesisOptions = {}): ReconstructionHypothesis[] {
  const bias = options.depthBias ?? 0.5;
  const rows = rowHalfWidths(lattice, analysis);

  const slab = buildHypothesis(lattice, {
    id: "H1-silhouette-slab",
    kind: "silhouette-slab",
    label: "Silhouette slab (one-view visual hull)",
    rule: "every column extends as deep as its own image row is wide, centred on the mid-plane",
    notes: [
      "This is the largest volume consistent with the silhouette. It cannot be wrong about what the silhouette covers and is almost certainly wrong about how deep the body is at the neck and ankles.",
    ],
    column: (i, j, x) => {
      const halfCells = rows.halfWidthCells[j] || rows.maxHalfWidthCells;
      void i;
      void x;
      return {
        front: halfCells,
        back: halfCells,
        provenance: "SYNTHESIZED",
        confidence: 0.55,
        why: "silhouette width at this row, mirrored into depth",
      };
    },
  });

  const inflated = buildHypothesis(lattice, {
    id: "H2-inflated-symmetric",
    kind: "inflated-symmetric",
    label: "Inflated symmetric body",
    rule: "half-depth equals the largest disc that fits inside the silhouette at that pixel (distance transform), mirrored front and back",
    notes: [
      "This is the rule a sculptural inflation would use: a limb of half-width r becomes a cylinder of radius r. It is derived from measured silhouette geometry, which is why its cells are INFERRED rather than SYNTHESIZED where they are inside the silhouette.",
    ],
    column: (i, j, x, y) => {
      const inradiusPx = sampleField(analysis.depth.inflation, analysis, x, y);
      const halfCells = pixelsToCells(lattice, inradiusPx);
      void i;
      void j;
      return {
        front: halfCells * (1 + bias * 0.4),
        back: halfCells * (1 - bias * 0.2),
        provenance: "INFERRED",
        confidence: 0.7,
        why: "inscribed radius at this pixel, mirrored into depth",
      };
    },
  });

  const relief = buildHypothesis(lattice, {
    id: "H3-shading-relief",
    kind: "shading-relief",
    label: "Shading relief with a flat back",
    rule: "front surface follows the shading bulge (luminance and inradius), the back is a single flat cap one cell behind the mid-plane",
    notes: [
      "Lighting direction is unknown, so the shading term is a proxy, not a measurement of depth. The flat back is the cheapest defensible closure and is labelled SYNTHESIZED.",
    ],
    column: (i, j, x, y) => {
      const inradiusPx = sampleField(analysis.depth.inflation, analysis, x, y);
      const shade = sampleField(analysis.depth.blended, analysis, x, y);
      void i;
      void j;
      return {
        front: Math.max(0.5, pixelsToCells(lattice, inradiusPx) * (0.45 + shade * 1.1)),
        back: 0.5,
        provenance: "INFERRED",
        confidence: 0.62,
        why: "inradius scaled by the shading proxy; flat back",
      };
    },
  });

  const block = buildHypothesis(lattice, {
    id: "H4-block-prismatic",
    kind: "block-prismatic",
    label: "Block-prismatic cut-out",
    rule: "each anatomical region becomes a slab of constant thickness equal to 80% of its own widest inscribed radius",
    notes: [
      "A deliberate simplification: it keeps each component rigid and cheap, at the cost of rounded cross-sections. Useful as the lower bound on depth fidelity.",
    ],
    column: (i, j, x, y) => {
      const inradiusPx = sampleField(analysis.depth.inflation, analysis, x, y);
      const component = componentAt(analysis, x, y);
      const width = component ? Math.max(4, Math.min(component.bbox.maxX - component.bbox.minX, component.bbox.maxY - component.bbox.minY)) : 8;
      const thicknessCells = pixelsToCells(lattice, Math.min(inradiusPx * 1.6, width * 0.5)) * 0.8;
      void i;
      void j;
      return {
        front: Math.max(0.5, thicknessCells),
        back: Math.max(0.5, thicknessCells),
        provenance: "SYNTHESIZED",
        confidence: 0.5,
        why: `constant thickness for region ${component?.id ?? "unknown"}`,
      };
    },
  });

  return [slab, inflated, relief, block];
}

function componentAt(analysis: ImageAnalysis, x: number, y: number) {
  let best: ImageAnalysis["components"]["components"][number] | null = null;
  let bestArea = Infinity;
  for (const component of analysis.components.components) {
    const box = component.bbox;
    if (!(x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY)) continue;
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    // Overlapping regions (hands inside arms, clothing over the torso) resolve
    // to the smallest containing region: the most specific claim wins.
    if (area < bestArea) {
      bestArea = area;
      best = component;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- scoring */

export interface HypothesisScore {
  silhouetteAgreement: number;
  landmarkConsistency: number;
  geometricPlausibility: number;
  depthConsistency: number;
  informationRetention: number;
  /** Composite quality, 0..1, before provenance honesty is applied. */
  quality: number;
  /** Quality after the provenance ceiling: a synthesised body counts less. */
  confidence: number;
  costMs: number;
  /** Mean absolute front-depth change between horizontal neighbours, in cells. */
  depthRoughness: number;
  cells: number;
  observedShare: number;
  notes: string[];
}

export interface HypothesisEvaluation {
  hypothesis: ReconstructionHypothesis;
  score: HypothesisScore;
}

export interface HypothesisComparison {
  evaluations: HypothesisEvaluation[];
  ranked: HypothesisEvaluation[];
  chosen: HypothesisEvaluation;
  runnerUp: HypothesisEvaluation | null;
  /** One line per hypothesis, stating what won and what it cost. */
  table: Array<{ id: string; kind: HypothesisKind; quality: number; confidence: number; costMs: number; cells: number }>;
  rules: string[];
  statement: string;
}

const weighted = (values: number[], weights: number[]): number => {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    total += weights[i];
  }
  return total > 0 ? sum / total : 0;
};

/** Re-project a hypothesis to the image plane: which lattice columns it covers. */
export function projectCoverage(hypothesis: ReconstructionHypothesis, lattice: AnalysisLattice): Uint8Array {
  const coverage = new Uint8Array(lattice.resX * lattice.resY);
  const coords = hypothesis.voxels.coords;
  for (let v = 0; v < coords.length / 3; v++) {
    coverage[coords[v * 3 + 1] * lattice.resX + coords[v * 3]] = 1;
  }
  return coverage;
}

function iou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let shared = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 && b[i] === 1) shared++;
    if (a[i] === 1 || b[i] === 1) union++;
  }
  return union === 0 ? 0 : shared / union;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function scoreHypothesis(
  hypothesis: ReconstructionHypothesis,
  lattice: AnalysisLattice,
  analysis: ImageAnalysis,
): HypothesisScore {
  const projected = projectCoverage(hypothesis, lattice);
  const silhouetteAgreement = iou(projected, lattice.observedCoverage);

  // Landmark consistency: the projected extents must land where the measured
  // landmarks are. All four hypotheses share the silhouette, so this term
  // separates only geometry that spills outside it — which is the point.
  const errors: number[] = [];
  let top = -1;
  let bottom = -1;
  let left = Infinity;
  let right = -Infinity;
  for (let j = 0; j < lattice.resY; j++) {
    for (let i = 0; i < lattice.resX; i++) {
      if (projected[j * lattice.resX + i] === 0) continue;
      if (j > top) top = j;
      if (bottom < 0 || j < bottom) bottom = j;
      if (i < left) left = i;
      if (i > right) right = i;
    }
  }
  const height = Math.max(1, analysis.silhouette.bbox.maxY - analysis.silhouette.bbox.minY);
  const L = analysis.landmarks.byId;
  if (top >= 0) {
    if (L["head-top"]) errors.push(Math.abs(rowForCellJ(lattice, top) - L["head-top"].y) / height);
    if (L["feet-bottom"]) errors.push(Math.abs(rowForCellJ(lattice, bottom) - L["feet-bottom"].y) / height);
  }
  const columnWidth = Math.max(1, analysis.silhouette.bbox.maxX - analysis.silhouette.bbox.minX);
  if (left !== Infinity && L["shoulder-left"]) {
    errors.push(Math.abs(lattice.imageBox.minX + (left + 0.5) * lattice.pixelsPerCellX - L["shoulder-left"].x) / columnWidth);
    errors.push(Math.abs(lattice.imageBox.minX + (right + 0.5) * lattice.pixelsPerCellX - L["shoulder-right"].x) / columnWidth);
  }
  const landmarkConsistency = errors.length === 0 ? 0 : 1 - Math.min(1, errors.reduce((s, e) => s + e, 0) / errors.length);

  // Geometric plausibility from the volume metrics the NRE already measures:
  // isolated cells and extreme surface-to-volume are the signature of a rule
  // that has gone wrong, not of a body.
  const metrics = measureVolume(hypothesis.voxels);
  const isolatedPenalty = Math.min(1, metrics.isolatedFraction * 4);
  const svPenalty = metrics.surfaceToVolumeRatio > 1.2 ? Math.min(1, (metrics.surfaceToVolumeRatio - 1.2) / 2) : 0;
  const geometricPlausibility = Math.max(0, 1 - isolatedPenalty * 0.7 - svPenalty * 0.3);

  // Depth consistency: does the front surface agree with the shading proxy?
  const fronts: number[] = [];
  const shades: number[] = [];
  for (let j = 0; j < lattice.resY; j++) {
    for (let i = 0; i < lattice.resX; i++) {
      if (hypothesis.depth.covered[j * lattice.resX + i] === 0) continue;
      const [x, y] = cellToImage(lattice, i, j);
      fronts.push(hypothesis.depth.front[j * lattice.resX + i]);
      shades.push(sampleField(analysis.depth.blended, analysis, x, y));
    }
  }
  const depthConsistency = Math.abs(pearson(fronts, shades));

  let observedCells = 0;
  for (let i = 0; i < projected.length; i++) {
    if (projected[i] === 0) continue;
    observedCells += lattice.observedCoverage[i];
  }
  const observedTotal = lattice.observedCoverage.reduce((s, v) => s + v, 0);
  const informationRetention = observedTotal > 0 ? Math.min(1, observedCells / observedTotal) : 0;

  // Roughness: a front surface that jumps every cell is not a surface.
  let roughnessSum = 0;
  let roughnessCount = 0;
  for (let j = 0; j < lattice.resY; j++) {
    for (let i = 0; i + 1 < lattice.resX; i++) {
      const a = hypothesis.depth.covered[j * lattice.resX + i];
      const b = hypothesis.depth.covered[j * lattice.resX + i + 1];
      if (!a || !b) continue;
      roughnessSum += Math.abs(hypothesis.depth.front[j * lattice.resX + i] - hypothesis.depth.front[j * lattice.resX + i + 1]);
      roughnessCount++;
    }
  }
  const depthRoughness = roughnessCount > 0 ? roughnessSum / roughnessCount : 0;

  const quality = weighted(
    [silhouetteAgreement, landmarkConsistency, geometricPlausibility, depthConsistency, informationRetention],
    [0.3, 0.15, 0.2, 0.2, 0.15],
  );

  const totalCells = Math.max(1, voxelCount(hypothesis.voxels));
  const observedShare = hypothesis.provenanceCounts.OBSERVED / totalCells;
  // Honesty tax: the share of the volume that is not observed is discounted.
  // This is what stops the biggest (slab) hypothesis from winning purely by
  // covering more cells with invented volume.
  const ceiling =
    (hypothesis.provenanceCounts.OBSERVED * 1 +
      hypothesis.provenanceCounts.INFERRED * 0.6 +
      hypothesis.provenanceCounts.SYNTHESIZED * 0.35 +
      hypothesis.provenanceCounts.INTERPOLATED * 0.5) /
    totalCells;
  const confidence = quality * (0.5 + 0.5 * ceiling);

  const notes: string[] = [
    `silhouette IoU ${silhouetteAgreement.toFixed(4)} on a ${lattice.resX}x${lattice.resY} projection`,
    `front-depth roughness ${depthRoughness.toFixed(3)} cells between neighbours`,
    `${(100 * observedShare).toFixed(1)}% of cells are observed; the rest is inferred or synthesised`,
  ];

  return {
    silhouetteAgreement,
    landmarkConsistency,
    geometricPlausibility,
    depthConsistency,
    informationRetention,
    quality,
    confidence,
    costMs: hypothesis.buildMs,
    depthRoughness,
    cells: totalCells,
    observedShare,
    notes,
  };
}

export function compareHypotheses(
  hypotheses: ReconstructionHypothesis[],
  lattice: AnalysisLattice,
  analysis: ImageAnalysis,
): HypothesisComparison {
  const evaluations = hypotheses.map((hypothesis) => ({ hypothesis, score: scoreHypothesis(hypothesis, lattice, analysis) }));
  const ranked = [...evaluations].sort((a, b) => b.score.confidence - a.score.confidence);
  const chosen = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const table = ranked.map((e) => ({
    id: e.hypothesis.id,
    kind: e.hypothesis.kind,
    quality: e.score.quality,
    confidence: e.score.confidence,
    costMs: e.score.costMs,
    cells: e.score.cells,
  }));

  const rules: string[] = [];
  const metricNames = ["silhouetteAgreement", "landmarkConsistency", "geometricPlausibility", "depthConsistency", "informationRetention"] as const;
  for (const metric of metricNames) {
    const best = [...evaluations].sort((a, b) => b.score[metric] - a.score[metric])[0];
    rules.push(`${metric}: ${best.hypothesis.id} (${best.score[metric].toFixed(4)})`);
  }
  const cheapest = [...evaluations].sort((a, b) => a.score.costMs - b.score.costMs)[0];
  rules.push(`cheapest: ${cheapest.hypothesis.id} (${cheapest.score.costMs.toFixed(1)} ms)`);

  const margin = runnerUp ? chosen.score.confidence - runnerUp.score.confidence : 0;
  const statement =
    `${chosen.hypothesis.id} wins on composite confidence (${chosen.score.confidence.toFixed(4)}), ` +
    `${margin >= 0 ? `ahead of ${runnerUp?.hypothesis.id ?? "nothing"} by ${margin.toFixed(4)}` : "with no competitor"}. ` +
    `${(100 * chosen.score.observedShare).toFixed(1)}% of its cells are observed; ` +
    `${(100 * (1 - chosen.score.observedShare)).toFixed(1)}% are inferred or synthesised and are labelled as such.`;

  return { evaluations, ranked, chosen, runnerUp, table, rules, statement };
}

/* --------------------------------------------------------------- combining */

/**
 * Fuse two hypotheses where they agree and keep the better-supported depth
 * where they do not. The result is SYNTHESIZED by construction: it is a
 * composite of inferences, and no cell in it may claim to be observed.
 */
export function combineHypotheses(
  a: ReconstructionHypothesis,
  b: ReconstructionHypothesis,
  weightA: number,
  lattice: AnalysisLattice,
): ReconstructionHypothesis {
  const weight = Math.max(0, Math.min(1, weightA));
  const started = performance.now();
  const { resX, resY, resZ, midZ } = lattice;
  const cells: Array<[number, number, number]> = [];
  const confidences: number[] = [];
  const provenances: number[] = [];
  const front = new Float32Array(resX * resY);
  const back = new Float32Array(resX * resY);
  const covered = new Uint8Array(resX * resY);
  const columnConfidence = new Float32Array(resX * resY);
  const counts: Record<Provenance, number> = { OBSERVED: 0, INFERRED: 0, SYNTHESIZED: 0, INTERPOLATED: 0 };
  const halfZ = Math.max(0, Math.floor((resZ - 1) / 2));

  for (let p = 0; p < resX * resY; p++) {
    const ca = a.depth.covered[p];
    const cb = b.depth.covered[p];
    if (!ca && !cb) continue;
    const fa = ca ? a.depth.front[p] : 0;
    const fb = cb ? b.depth.front[p] : 0;
    const ba = ca ? a.depth.back[p] : 0;
    const bb = cb ? b.depth.back[p] : 0;
    const f = clampCell(fa * weight + fb * (1 - weight), 0, halfZ);
    const bk = clampCell(ba * weight + bb * (1 - weight), 0, halfZ);
    const i = p % resX;
    const j = (p - i) / resX;
    front[p] = f;
    back[p] = bk;
    covered[p] = 1;
    const blended = a.depth.confidence[p] * weight + b.depth.confidence[p] * (1 - weight);
    columnConfidence[p] = blended;
    for (let k = midZ - bk; k <= midZ + f; k++) {
      if (k < 0 || k >= resZ) continue;
      cells.push([i, j, k]);
      // A fused cell is a hypothesis about a hypothesis: SYNTHESIZED, always.
      provenances.push(PROVENANCE_CODE.SYNTHESIZED);
      counts.SYNTHESIZED++;
      const isFrontCap = k === midZ + f;
      confidences.push(Math.min(0.35, blended * (isFrontCap ? 0.9 : 0.6)));
    }
  }

  const voxels = buildSparseVoxels(lattice.grid, cells, {
    occupancy: "sparse-volume",
    channels: [DEFAULT_CONFIDENCE_CHANNEL, PROVENANCE_CHANNEL],
    attributes: { confidence: confidences, provenance: provenances },
  });

  return {
    id: `H5-combined(${a.kind}+${b.kind})`,
    kind: "combined",
    label: `Combined hypothesis: ${a.label} + ${b.label}`,
    provenance: "SYNTHESIZED",
    voxels,
    cellProvenance: Uint8Array.from(provenances),
    provenanceCounts: counts,
    depth: { front, back, covered, confidence: columnConfidence },
    rule: `front and back depth blended ${(weight * 100).toFixed(0)}% ${a.kind} / ${(100 - weight * 100).toFixed(0)}% ${b.kind}; every cell relabelled SYNTHESIZED because a fused inference is still an inference`,
    notes: ["Combining two hypotheses can only lower honesty, never raise it: the combined cells are never labelled observed."],
    buildMs: performance.now() - started,
  };
}

/** Provenance composition of any voxel set carrying the channel. */
export function provenanceSummary(hypothesis: ReconstructionHypothesis): Record<Provenance, { cells: number; share: number }> {
  const total = Math.max(1, voxelCount(hypothesis.voxels));
  const out = {} as Record<Provenance, { cells: number; share: number }>;
  for (const label of PROVENANCE_ORDER) {
    const cells = hypothesis.provenanceCounts[label];
    out[label] = { cells, share: cells / total };
  }
  return out;
}
