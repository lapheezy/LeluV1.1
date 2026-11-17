/**
 * ==========================================================
 * LÉLU ASRE — WHAT IS MISSING, AND WHICH VIEW WOULD HELP MOST
 *
 * A reconstruction from one image is mostly guessed. This splits the
 * grid into six sides around its centroid (relative to the camera that
 * took the observation) and measures, per side, how much of it rests
 * on evidence that was seen or measured (OBSERVED / INFERRED) versus
 * evidence a model made up (SYNTHESIZED / INTERPOLATED only).
 *
 * The suggested next observation is the side with the highest
 *     expectedGain(importance, confidence, missing)
 * — the same objective the scheduler uses.
 * ==========================================================
 */

import { mortonDecode } from "../nre/morton";
import type { SparseVoxelGrid } from "../nre/SparseVoxelGrid";
import { Provenance, type Vec3 } from "../nre/types";
import { expectedGain } from "../scheduler/Scheduler";

export type Side = "front" | "back" | "left" | "right" | "top" | "bottom";

export interface SideCoverage {
  side: Side;
  cells: number;
  /** Fraction of the side's cells with no OBSERVED or INFERRED evidence. */
  unsupported: number;
  meanConfidence: number;
  gain: number;
}

export interface CoverageReport {
  sides: SideCoverage[];
  overallUnsupported: number;
  /** Ranked observation requests. */
  requests: Array<{ view: Side; reason: string; gain: number }>;
}

/**
 * @param front unit vector pointing from the object toward the camera that
 *              produced the observation (grid axes)
 * @param up    unit vector for "up" in grid axes
 */
export function assessCoverage(grid: SparseVoxelGrid, front: Vec3, up: Vec3, importance: Partial<Record<Side, number>> = {}): CoverageReport {
  const c = grid.centroid() ?? [0, 0, 0];
  const right: Vec3 = [up[1] * front[2] - up[2] * front[1], up[2] * front[0] - up[0] * front[2], up[0] * front[1] - up[1] * front[0]];
  const acc: Record<Side, { cells: number; unsupported: number; conf: number }> = {
    front: { cells: 0, unsupported: 0, conf: 0 }, back: { cells: 0, unsupported: 0, conf: 0 }, left: { cells: 0, unsupported: 0, conf: 0 },
    right: { cells: 0, unsupported: 0, conf: 0 }, top: { cells: 0, unsupported: 0, conf: 0 }, bottom: { cells: 0, unsupported: 0, conf: 0 },
  };
  let totalUnsupported = 0;
  const supported = Provenance.OBSERVED | Provenance.INFERRED;
  for (const [code, cell] of grid.entries()) {
    const p = mortonDecode(code);
    const d: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const f = d[0] * front[0] + d[1] * front[1] + d[2] * front[2];
    const u = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const r = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const [af, au, ar] = [Math.abs(f), Math.abs(u), Math.abs(r)];
    const side: Side = af >= au && af >= ar ? (f >= 0 ? "front" : "back") : au >= ar ? (u >= 0 ? "top" : "bottom") : r >= 0 ? "right" : "left";
    const a = acc[side];
    a.cells++;
    a.conf += cell.confidence;
    if (!(cell.provenance & supported)) {
      a.unsupported++;
      totalUnsupported++;
    }
  }
  const sides: SideCoverage[] = (Object.keys(acc) as Side[]).map((side) => {
    const a = acc[side];
    const unsupported = a.cells ? a.unsupported / a.cells : 0;
    const meanConfidence = a.cells ? a.conf / a.cells : 0;
    return { side, cells: a.cells, unsupported, meanConfidence, gain: a.cells ? expectedGain({ importance: importance[side] ?? 1, confidence: meanConfidence, missing: unsupported }) : 0 };
  });
  const requests = sides
    .filter((s) => s.gain > 0.01)
    .sort((a, b) => b.gain - a.gain)
    .map((s) => ({ view: s.side, gain: s.gain, reason: `${(s.unsupported * 100).toFixed(0)}% of the ${s.side} rests only on synthesized evidence (mean confidence ${s.meanConfidence.toFixed(2)})` }));
  return { sides, overallUnsupported: grid.size ? totalUnsupported / grid.size : 0, requests };
}
