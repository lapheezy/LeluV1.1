/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — IMAGE ↔ LATTICE MAPPING
 *
 * A photograph is a projection. Turning it into a numerical
 * representation means choosing a lattice and fixing exactly where each
 * pixel lands in it, once, so every hypothesis is built on the same
 * coordinates and two hypotheses can be compared cell for cell.
 *
 * The lattice is Y-up (LÉLU/Cosmos convention), the silhouette's top of
 * head sits at the top row, and depth runs along +Z toward the viewer.
 * The mapping is recorded in the returned struct rather than implied, so
 * re-projecting geometry for scoring cannot quietly use a different frame
 * from the one that built it.
 * ==========================================================
 */

import type { SpatialGrid, Vec3 } from "../nre/types.ts";
import { createGrid } from "../nre/voxels.ts";
import type { ImageAnalysis } from "./image.ts";

export interface LatticeOptions {
  /** Cells along the body height. 96 gives ~1.8 cm cells on a 1.7 m figure. */
  resolutionY?: number;
  /** Cells along depth; clamped to an odd number so there is a mid-plane. */
  resolutionZ?: number;
  /** Extra cells around the silhouette in X and Z. */
  padCells?: number;
}

export interface AnalysisLattice {
  grid: SpatialGrid;
  resX: number;
  resY: number;
  resZ: number;
  /** z index of the mid-plane: depth 0 sits here. */
  midZ: number;
  /** Image-space box the lattice covers (the silhouette bbox). */
  imageBox: { minX: number; minY: number; maxX: number; maxY: number };
  pixelsPerCellX: number;
  pixelsPerCellY: number;
  /** Depth half-extent implied by the silhouette's widest point, in cells. */
  maxDepthCells: number;
  /** Foreground coverage per (i,j), 0..1. */
  coverage: Float32Array;
  /** Observed mask sampled on the same (i,j) grid, for scoring. */
  observedCoverage: Float32Array;
  notes: string[];
}

/** Build the lattice the analysis will be represented on. */
export function latticeForAnalysis(analysis: ImageAnalysis, options: LatticeOptions = {}): AnalysisLattice {
  const box = analysis.silhouette.bbox;
  const imageWidth = Math.max(1, box.maxX - box.minX + 1);
  const imageHeight = Math.max(1, box.maxY - box.minY + 1);
  const resY = Math.max(8, Math.round(options.resolutionY ?? 96));
  const cellSize = analysis.measurements.assumedWorldHeightM / resY;
  const pad = Math.max(1, Math.round(options.padCells ?? 2));

  const resX = Math.max(4, Math.round((imageWidth / imageHeight) * resY) + pad * 2);
  const depthCells = analysis.depth.maxHalfThicknessPx * (resY / imageHeight);
  const resZraw = Math.max(4, Math.round(depthCells * 2) + pad * 2);
  const resZ = options.resolutionZ ?? (resZraw % 2 === 0 ? resZraw + 1 : resZraw);
  const midZ = Math.floor(resZ / 2);

  const grid = createGrid({
    cellSize,
    resolution: [resX, resY, resZ] as Vec3,
    origin: [(-resX * cellSize) / 2, 0, (-resZ * cellSize) / 2],
  });

  const pixelsPerCellX = imageWidth / resX;
  const pixelsPerCellY = imageHeight / resY;
  const coverage = new Float32Array(resX * resY);
  const mask = analysis.mask;

  // Area sampling: each lattice column averages the pixels it covers, so a
  // half-covered column at the edge of the silhouette is not rounded up into
  // a full cell.
  for (let j = 0; j < resY; j++) {
    const y0 = box.minY + j * pixelsPerCellY;
    const y1 = y0 + pixelsPerCellY;
    for (let i = 0; i < resX; i++) {
      const x0 = box.minX + i * pixelsPerCellX;
      const x1 = x0 + pixelsPerCellX;
      let on = 0;
      let total = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        if (y < 0 || y >= analysis.height) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          if (x < 0 || x >= analysis.width) continue;
          total++;
          on += mask[y * analysis.width + x];
        }
      }
      coverage[j * resX + i] = total > 0 ? on / total : 0;
    }
  }

  const observedCoverage = new Float32Array(resX * resY);
  for (let p = 0; p < coverage.length; p++) observedCoverage[p] = coverage[p] > 0.5 ? 1 : 0;

  const notes = [
    `lattice ${resX}x${resY}x${resZ} at ${(cellSize * 100).toFixed(2)} cm cells, Y-up, +Z toward the viewer`,
    `${resY} cells span the declared ${analysis.measurements.assumedWorldHeightM.toFixed(2)} m height`,
    `depth resolution chosen from the silhouette: widest inradius ${analysis.depth.maxHalfThicknessPx.toFixed(1)} px = ${depthCells.toFixed(2)} cells`,
  ];

  return {
    grid,
    resX,
    resY,
    resZ,
    midZ,
    imageBox: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
    pixelsPerCellX,
    pixelsPerCellY,
    maxDepthCells: depthCells,
    coverage,
    observedCoverage,
    notes,
  };
}

/** Cell column (i,j) for an image pixel, using the lattice's own box. */
export function imageToCell(lattice: AnalysisLattice, x: number, y: number): [number, number] {
  const i = Math.floor((x - lattice.imageBox.minX) / lattice.pixelsPerCellX);
  const jFromTop = Math.floor((y - lattice.imageBox.minY) / lattice.pixelsPerCellY);
  const j = lattice.resY - 1 - jFromTop;
  return [Math.max(0, Math.min(lattice.resX - 1, i)), Math.max(0, Math.min(lattice.resY - 1, j))];
}

/** Image pixel at the centre of cell column (i,j). */
export function cellToImage(lattice: AnalysisLattice, i: number, j: number): [number, number] {
  const x = lattice.imageBox.minX + (i + 0.5) * lattice.pixelsPerCellX;
  const yFromTop = lattice.resY - 1 - j;
  const y = lattice.imageBox.minY + (yFromTop + 0.5) * lattice.pixelsPerCellY;
  return [x, y];
}

/**
 * Image row (from the top) of a lattice j. Used to compare projected
 * geometry against landmarks that were measured in image space.
 */
export function rowForCellJ(lattice: AnalysisLattice, j: number): number {
  return lattice.imageBox.minY + (lattice.resY - 1 - j + 0.5) * lattice.pixelsPerCellY;
}

/** Lattice column for an image x. */
export function columnForImageX(lattice: AnalysisLattice, x: number): number {
  return (x - lattice.imageBox.minX) / lattice.pixelsPerCellX - 0.5;
}

/** A depth in image pixels as a half-extent in cells. */
export function pixelsToCells(lattice: AnalysisLattice, px: number): number {
  return px / lattice.pixelsPerCellY;
}

/** World-space centre of a lattice cell. */
export function cellWorld(grid: SpatialGrid, i: number, j: number, k: number): Vec3 {
  return [
    grid.origin[0] + (i + 0.5) * grid.cellSize,
    grid.origin[1] + (j + 0.5) * grid.cellSize,
    grid.origin[2] + (k + 0.5) * grid.cellSize,
  ];
}
