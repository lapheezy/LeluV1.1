/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — ADAPTIVE REPRESENTATION SELECTOR
 *
 * Not every shape wants the same representation. A one-cell-thick shell
 * is fully described by its boundary; a solid is not, and exporting it as
 * a boundary silently deletes most of it. This module measures the shape
 * and says which representation it needs — with the numbers that decided
 * it and the alternatives it rejected.
 *
 * Signals come from occupied cells only: fill ratio, interior share,
 * connected components, isolation, surface-to-volume. When a temporal
 * history exists, motion is analysed per component, which is what
 * separates a rigid move from an articulated one.
 * ==========================================================
 */

import type { SparseVoxels } from "./types.ts";
import { denseIndexOf, occupancyKeySet } from "./voxels.ts";
import { connectedComponents, measureVolume, solidFromSurface, type VolumeMetrics } from "./volume.ts";
import { compareVoxelSets } from "./compare.ts";

export type RepresentationKind = "sparse-surface" | "volumetric" | "hollow" | "point-cloud" | "articulated" | "deforming";

/** Motion facts from a temporal history, if one exists. */
export interface TemporalSignals {
  snapshots: number;
  occupancyChanged: boolean;
  /** Best shift match across the whole shape, 0..1. */
  rigidMatch: number;
  /** Per-component rigid motion, when the shape has separable parts. */
  componentShifts: Array<{ shift: [number, number, number]; match: number; cells: number }>;
  confidenceDelta: number;
}

export interface RepresentationDecision {
  kind: RepresentationKind;
  /** How the container must store it to avoid losing information. */
  storage: "sparse-surface" | "sparse-volume";
  /** Which export path is faithful for this kind. */
  exportPath: "glb-boundary" | "volumetric-container" | "temporal-sequence";
  metrics: VolumeMetrics;
  temporal: TemporalSignals | null;
  /** Every rule that fired, with the measured value that fired it. */
  reasons: string[];
  rejected: Array<{ kind: RepresentationKind; because: string }>;
}

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

function distinctShifts(signals: TemporalSignals): number {
  const meaningful = signals.componentShifts.filter((s) => s.cells > 0 && s.match >= 0.5);
  return new Set(meaningful.map((s) => s.shift.join(","))).size;
}

export function analyseRepresentation(voxels: SparseVoxels, temporal: TemporalSignals | null = null): RepresentationDecision {
  const metrics = measureVolume(voxels);
  const reasons: string[] = [];
  const rejected: Array<{ kind: RepresentationKind; because: string }> = [];

  if (metrics.cells > 0 && metrics.isolatedFraction >= 0.5) {
    reasons.push(
      `${percent(metrics.isolatedFraction)} of ${metrics.cells} cells have no face neighbour and the shape splits into ${metrics.components} components: this is a point cloud.`,
    );
    return {
      kind: "point-cloud",
      storage: "sparse-surface",
      exportPath: "glb-boundary",
      metrics,
      temporal,
      reasons,
      rejected: [
        { kind: "sparse-surface", because: "a surface mesh needs faces, and isolated points have none" },
        { kind: "volumetric", because: `interior share is ${percent(metrics.interiorFraction)} — there is no interior to preserve` },
      ],
    };
  }

  // Motion decides the KIND before density decides the STORAGE. A solid that
  // articulates is still an articulated body; its interior only changes how
  // it must be stored. Testing density first would label it "volumetric" and
  // silently drop the fact that its parts move independently.
  const storageForShape: "sparse-surface" | "sparse-volume" = metrics.interiorFraction > 0.15 ? "sparse-volume" : "sparse-surface";
  if (temporal) {
    const distinct = distinctShifts(temporal);
    if (distinct >= 2) {
      reasons.push(
        `${temporal.componentShifts.length} components move with ${distinct} distinct shifts (overall match ${percent(temporal.rigidMatch)}): articulated, so one rigid transform would misrepresent it.`,
      );
      if (storageForShape === "sparse-volume") {
        reasons.push(`Storage follows the interior: ${percent(metrics.interiorFraction)} of cells are interior, so the container must keep volume.`);
      }
      return { kind: "articulated", storage: storageForShape, exportPath: "temporal-sequence", metrics, temporal, reasons, rejected };
    }
    if (temporal.occupancyChanged && temporal.rigidMatch < 0.95) {
      reasons.push(
        `Occupancy changed across ${temporal.snapshots} snapshots and only ${percent(temporal.rigidMatch)} of cells survive the best rigid shift: the surface itself deforms.`,
      );
      return { kind: "deforming", storage: storageForShape, exportPath: "temporal-sequence", metrics, temporal, reasons, rejected };
    }
  }

  if (metrics.interiorFraction > 0.15) {
    reasons.push(
      `${percent(metrics.interiorFraction)} of cells are interior (${metrics.interiorCells} of ${metrics.cells}); a boundary mesh would keep only ${metrics.boundaryCells}, so storage must be volumetric.`,
    );
    rejected.push({
      kind: "sparse-surface",
      because: `a GLB boundary would discard ${metrics.interiorCells} interior cells (${percent(metrics.interiorFraction)} of the shape)`,
    });
    return { kind: "volumetric", storage: "sparse-volume", exportPath: "volumetric-container", metrics, temporal, reasons, rejected };
  }

  // A thin shell that encloses a cavity is fully described by its boundary;
  // the cavity is reported because it changes what solidifying would do.
  const solidification = solidFromSurface(voxels);
  if (solidification.enclosedCells > 0) {
    reasons.push(
      `${percent(metrics.interiorFraction)} of cells are interior, and the shell encloses ${solidification.enclosedCells} empty cells: a hollow structure whose boundary is complete.`,
    );
    rejected.push({ kind: "volumetric", because: "the cavity is empty; filling it would invent material that was never observed" });
    return { kind: "hollow", storage: "sparse-surface", exportPath: "glb-boundary", metrics, temporal, reasons, rejected };
  }

  if (temporal) {
    reasons.push(
      `Temporal history exists (${temporal.snapshots} snapshots) and motion is consistent with a rigid shift (${percent(temporal.rigidMatch)}).`,
    );
  }

  reasons.push(
    `Thin structure: ${percent(metrics.interiorFraction)} interior, surface-to-volume ${metrics.surfaceToVolumeRatio.toFixed(3)}, ${metrics.components} component(s). A boundary mesh describes it completely.`,
  );
  return { kind: "sparse-surface", storage: "sparse-surface", exportPath: "glb-boundary", metrics, temporal, reasons, rejected };
}

/** Apply the decision's storage mode so the container records it truthfully. */
export function withRepresentation(voxels: SparseVoxels, decision: RepresentationDecision): SparseVoxels {
  return { ...voxels, occupancy: decision.storage };
}

export interface MotionAnalysis {
  rigidMatch: number;
  occupancyChanged: boolean;
  componentShifts: Array<{ shift: [number, number, number]; match: number; cells: number }>;
  changedCells: number;
}

/**
 * Motion facts between two snapshots, per connected component.
 *
 * Each component's best integer shift is found by testing the shift
 * search space against the later set; two components with different
 * shifts is what "articulated" means here, and it is measured rather
 * than assumed.
 */
export function analyseMotion(before: SparseVoxels, after: SparseVoxels, radius = 4): MotionAnalysis {
  const grid = before.grid;
  const afterKeys = occupancyKeySet(after);
  const [nx, ny, nz] = grid.resolution;
  const compare = compareVoxelSets(before, after);
  const components = connectedComponents(before);

  const componentShifts = components.map((component) => {
    if (component.length === 0) return { shift: [0, 0, 0] as [number, number, number], match: 0, cells: 0 };
    let bestMatch = 0;
    let bestShift: [number, number, number] = [0, 0, 0];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          let matched = 0;
          for (const [i, j, k] of component) {
            const ni = i + dx, nj = j + dy, nk = k + dz;
            if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
            if (afterKeys.has(denseIndexOf(grid, ni, nj, nk))) matched++;
          }
          const match = matched / component.length;
          if (match > bestMatch + 1e-9) {
            bestMatch = match;
            bestShift = [dx, dy, dz];
          }
        }
      }
    }
    return { shift: bestShift, match: bestMatch, cells: component.length };
  });

  return {
    rigidMatch: compare.countA === 0 ? 0 : compare.shared / compare.countA,
    occupancyChanged: compare.onlyA > 0 || compare.onlyB > 0,
    componentShifts,
    changedCells: compare.onlyA + compare.onlyB,
  };
}

export { measureVolume };
