/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 4 EXPERIMENTS (ENGINE-SIDE)
 *
 * The pieces both the tests and the experiment runner need, written so
 * neither has to duplicate them:
 *
 *   reconstructFromAnalysis   analysis → lattice → hypotheses → choice
 *   syntheticCharacterFrame   a real pixel buffer of a figure, for tests
 *   variationSweep            apply a list of variations and measure reuse
 *   provenanceTotals          what a set of frames is made of
 *
 * The heavy, real-photograph run lives in scripts/temporal/run-mission4.ts;
 * this module is deterministic and fast enough to run inside the suite.
 * ==========================================================
 */

import { voxelCount } from "../../nre/voxels.ts";
import { analyseImage, type ImageAnalysis } from "../image.ts";
import { latticeForAnalysis, type AnalysisLattice } from "../lattice.ts";
import {
  buildHypotheses,
  combineHypotheses,
  compareHypotheses,
  provenanceSummary,
  type HypothesisComparison,
  type ReconstructionHypothesis,
} from "../hypotheses.ts";
import { applyVariation, identityVoxels, reuseRatio, type CharacterIdentity, type VariationRequest, type VariationResult } from "../identity.ts";
import type { ComponentId, ImageFrame, Provenance } from "../types.ts";
import { PROVENANCE_ORDER } from "../types.ts";

export interface ReconstructOptions {
  resolutionY?: number;
  worldHeightM?: number;
  /** Also build the fused runner-up hypothesis. */
  combine?: boolean;
}

export interface Reconstruction {
  analysis: ImageAnalysis;
  lattice: AnalysisLattice;
  comparison: HypothesisComparison;
  /** The hypothesis the engine would keep. */
  chosen: ReconstructionHypothesis;
  /** The fused second opinion, when requested. */
  combined: ReconstructionHypothesis | null;
}

export function reconstructFromAnalysis(analysis: ImageAnalysis, options: ReconstructOptions = {}): Reconstruction {
  const lattice = latticeForAnalysis(analysis, { resolutionY: options.resolutionY });
  const hypotheses = buildHypotheses(lattice, analysis);
  const comparison = compareHypotheses(hypotheses, lattice, analysis);
  const runnerUp = comparison.runnerUp;
  const combined = options.combine && runnerUp ? combineHypotheses(comparison.chosen.hypothesis, runnerUp.hypothesis, 0.65, lattice) : null;
  return { analysis, lattice, comparison, chosen: comparison.chosen.hypothesis, combined };
}

export function reconstructFromImage(frame: ImageFrame, options: ReconstructOptions = {}): Reconstruction {
  return reconstructFromAnalysis(analyseImage(frame, { worldHeightM: options.worldHeightM }), options);
}

/* ------------------------------------------------------------- test fixture */

/**
 * A synthetic front view of a figure: head, neck, torso, two arms, two legs,
 * feet. Drawn with real shading so the surface and depth analyses have
 * something to read. This is a fixture for the test suite, not a claim about
 * what a photograph looks like.
 */
export function syntheticCharacterFrame(width = 320, height = 480): ImageFrame {
  const rgba = new Uint8Array(width * height * 4);
  const bg = { r: 214, g: 214, b: 218 };
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = bg.r;
    rgba[p * 4 + 1] = bg.g;
    rgba[p * 4 + 2] = bg.b;
    rgba[p * 4 + 3] = 255;
  }

  const cx = width / 2;
  const paint = (x: number, y: number, shade: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.floor(y) * width + Math.floor(x)) * 4;
    rgba[i] = Math.min(255, Math.round(170 * shade));
    rgba[i + 1] = Math.min(255, Math.round(120 * shade));
    rgba[i + 2] = Math.min(255, Math.round(96 * shade));
    rgba[i + 3] = 255;
  };

  // A cylinder-lighting profile so shading carries a real gradient.
  const shadeAt = (x: number, centre: number, radius: number): number => {
    const d = Math.min(1, Math.abs(x - centre) / Math.max(1, radius));
    return 1.15 - 0.55 * d * d;
  };

  const headCy = height * 0.12;
  const headR = height * 0.075;
  for (let y = Math.floor(headCy - headR * 1.25); y <= headCy + headR * 1.25; y++) {
    const dy = (y - headCy) / headR;
    const halfWidth = headR * Math.sqrt(Math.max(0, 1 - Math.min(1, (dy / 1.25) ** 2)));
    for (let x = Math.floor(cx - halfWidth); x <= cx + halfWidth; x++) paint(x, y, shadeAt(x, cx, headR));
  }

  // Neck.
  for (let y = Math.floor(headCy + headR * 1.1); y <= height * 0.24; y++) {
    for (let x = Math.floor(cx - headR * 0.34); x <= cx + headR * 0.34; x++) paint(x, y, shadeAt(x, cx, headR * 0.34));
  }

  // Torso: shoulders at 24%, hips at 52%.
  const shoulderY = height * 0.24;
  const hipY = height * 0.52;
  for (let y = Math.floor(shoulderY); y <= hipY; y++) {
    const t = (y - shoulderY) / (hipY - shoulderY);
    const half = width * (0.15 + 0.02 * Math.sin(t * Math.PI)) * (1 - t * 0.12);
    for (let x = Math.floor(cx - half); x <= cx + half; x++) paint(x, y, shadeAt(x, cx, half));
  }

  // Arms, angled outward from the shoulder (A-pose).
  for (const side of [-1, 1]) {
    for (let step = 0; step < height * 0.3; step++) {
      const y = shoulderY + step * 0.9;
      const x = cx + side * (width * 0.155 + step * 0.16);
      for (let d = -width * 0.022; d <= width * 0.022; d++) paint(x + d, y, shadeAt(x + d, x, width * 0.022));
    }
  }

  // Legs, separated below the crotch.
  for (const side of [-1, 1]) {
    for (let y = Math.floor(hipY); y <= height * 0.94; y++) {
      const t = (y - hipY) / (height * 0.94 - hipY);
      const centre = cx + side * (width * 0.055 + t * width * 0.02);
      const half = width * (0.062 - t * 0.012);
      for (let x = Math.floor(centre - half); x <= centre + half; x++) paint(x, y, shadeAt(x, centre, half));
    }
    // Feet.
    for (let y = Math.floor(height * 0.94); y <= height * 0.965; y++) {
      const centre = cx + side * width * 0.085;
      for (let x = Math.floor(centre - width * 0.045); x <= centre + width * 0.045; x++) paint(x, y, shadeAt(x, centre, width * 0.045));
    }
  }

  return { width, height, rgba };
}

/* --------------------------------------------------------------- variations */

export interface SweepEntry {
  request: VariationRequest;
  changed: ComponentId[];
  preserved: ComponentId[];
  reusedCells: number;
  regeneratedCells: number;
  producedCells: number;
  reuse: number;
  cells: number;
  failures: string[];
}

export function variationSweep(identity: CharacterIdentity, requests: VariationRequest[]): { entries: SweepEntry[]; results: VariationResult[]; failed: SweepEntry[] } {
  const entries: SweepEntry[] = [];
  const results: VariationResult[] = [];
  for (const request of requests) {
    const result = applyVariation(identity, request);
    results.push(result);
    entries.push({
      request,
      changed: result.changed,
      preserved: result.preserved,
      reusedCells: result.reusedCells,
      regeneratedCells: result.regeneratedCells,
      producedCells: result.producedCells,
      reuse: reuseRatio(result),
      cells: voxelCount(identityVoxels(result.identity)),
      failures: result.failures,
    });
  }
  return { entries, results, failed: entries.filter((entry) => entry.failures.length > 0) };
}

/* ---------------------------------------------------------------- provenance */

export function provenanceTotals(hypotheses: ReconstructionHypothesis[]): Record<Provenance, { cells: number; share: number }> {
  const totals = {} as Record<Provenance, { cells: number; share: number }>;
  for (const label of PROVENANCE_ORDER) totals[label] = { cells: 0, share: 0 };
  let all = 0;
  for (const hypothesis of hypotheses) {
    const summary = provenanceSummary(hypothesis);
    for (const label of PROVENANCE_ORDER) {
      totals[label].cells += summary[label].cells;
      all += summary[label].cells;
    }
  }
  for (const label of PROVENANCE_ORDER) totals[label].share = all > 0 ? totals[label].cells / all : 0;
  return totals;
}
