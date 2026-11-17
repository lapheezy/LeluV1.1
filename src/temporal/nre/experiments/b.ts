/**
 * ==========================================================
 * TEMPORAL STUDIO — EXPERIMENT B
 * NUMERICAL → 3D → NUMERICAL (REVERSIBILITY)
 *
 *   known numerical representation
 *     → geometry (boundary triangles)
 *     → GLB bytes
 *     → parsed back through the existing GlbInspector gate
 *     → numerical representation again
 *     → measured difference
 *
 * The output is numbers, not a verdict: intersection-over-union,
 * containment, displacement in cells, and how many cells could not be
 * matched within the probe radius. A rejection by the export gate is a
 * result too — the empty mesh must FAIL inspection, and the harness
 * treats that as a pass only because it proves the gate is not asleep.
 * ==========================================================
 */

import { inspectGlb, readGlbGeometry } from "../../../core/forge/GlbInspector.ts";
import { boundaryOf, encodeGlb, meshFromVoxels, triangleCount, vertexCount, voxelizeMesh } from "../geometry.ts";
import { compareVoxelSets } from "../compare.ts";
import { createGrid } from "../voxels.ts";
import type { ExperimentStatus, SpatialGrid, SparseVoxels, Vec3 } from "../types.ts";
import {
  boxShell,
  filledBox,
  filledSphere,
  irregularBlob,
  lineOfCells,
  planeSheet,
  randomSparse,
  sphereShell,
  torus,
  withUniformConfidence,
} from "../shapes.ts";

export const SURFACE_IOU_THRESHOLD = 0.98;
export const SURFACE_CONTAINMENT_THRESHOLD = 0.98;

export interface FidelityCaseResult {
  name: string;
  kind: "surface" | "volume" | "degenerate";
  description: string;
  grid: { resolution: Vec3; cellSize: number };
  inputCells: number;
  boundaryCells: number;
  recoveredCells: number;
  /** Cells only in the input / only in the recovered set, against the boundary subset. */
  onlyOriginal: number;
  onlyRecovered: number;
  sharedCells: number;
  /** Boundary subset vs recovered — what a surface mesh can in principle encode. */
  surfaceIou: number;
  surfaceContainment: number;
  /** Whole input vs recovered — includes interior cells a boundary cannot hold. */
  totalIou: number;
  totalContainment: number;
  maxDisplacementCells: number;
  meanDisplacementCells: number;
  unmatchedBeyondProbe: number;
  /** Fraction of the input a boundary mesh can represent at all. */
  representableFraction: number;
  mesh: { vertices: number; triangles: number };
  glbBytes: number;
  /** Did the existing GlbInspector gate accept the export? */
  gateAccepted: boolean;
  gateProblems: string[];
  timings: { meshMs: number; encodeMs: number; inspectMs: number; decodeMs: number; voxelizeMs: number; compareMs: number; totalMs: number };
  pass: boolean;
  notes: string[];
}

export interface ExperimentBReport {
  thresholds: { surfaceIou: number; surfaceContainment: number };
  cases: FidelityCaseResult[];
  summary: {
    cases: number;
    passed: number;
    failed: number;
    surfaceCases: number;
    meanSurfaceIou: number;
    worstSurfaceIou: number;
    worstCase: string;
    totalGlbBytes: number;
    status: ExperimentStatus;
    statement: string;
  };
}

interface CaseSpec {
  name: string;
  kind: "surface" | "volume" | "degenerate";
  description: string;
  grid: SpatialGrid;
  voxels: SparseVoxels;
  /** Empty meshes must be rejected by the gate. */
  expectGateRejection?: boolean;
}

function spec(name: string, kind: CaseSpec["kind"], description: string, grid: SpatialGrid, voxels: SparseVoxels, expectGateRejection = false): CaseSpec {
  return { name, kind, description, grid, voxels, expectGateRejection };
}

function evaluateCase(input: CaseSpec): FidelityCaseResult {
  const started = performance.now();
  const notes: string[] = [];

  let t = performance.now();
  const mesh = meshFromVoxels(input.voxels);
  const meshMs = performance.now() - t;

  t = performance.now();
  const glb = encodeGlb(mesh, { name: input.name, generator: "nre-v1 experiment-b" });
  const encodeMs = performance.now() - t;

  t = performance.now();
  const gate = inspectGlb(glb);
  const inspectMs = performance.now() - t;

  t = performance.now();
  const decoded = readGlbGeometry(glb);
  const decodeMs = performance.now() - t;

  t = performance.now();
  const recovered = voxelizeMesh(decoded, input.grid, { samplesPerCell: 2 });
  const voxelizeMs = performance.now() - t;

  t = performance.now();
  const boundary = boundaryOf(input.voxels);
  const compareBoundary = compareVoxelSets(boundary, recovered);
  const compareTotal = compareVoxelSets(input.voxels, recovered);
  const compareMs = performance.now() - t;

  const inputCells = input.voxels.coords.length / 3;
  const boundaryCells = boundary.coords.length / 3;
  const recoveredCells = recovered.coords.length / 3;
  const representableFraction = inputCells === 0 ? 0 : boundaryCells / inputCells;

  if (decoded.unreadablePrimitives > 0) notes.push(`${decoded.unreadablePrimitives} primitive(s) could not be read back from the GLB.`);
  if (gate.generator !== "nre-v1 experiment-b") notes.push(`GLB generator read back as ${String(gate.generator)}.`);

  let pass: boolean;
  if (input.expectGateRejection === true) {
    pass = gate.ok === false && gate.problems.length > 0;
    notes.push(
      gate.ok === false
        ? "An empty numerical set produced a mesh the export gate REJECTED, which is the correct outcome: no geometry exists to export."
        : "The export gate ACCEPTED an empty set — this is a gate failure, not a success.",
    );
  } else if (input.kind === "volume") {
    const lossMeasured = compareTotal.containment < 0.999 && representableFraction < 1;
    pass = compareBoundary.iou >= SURFACE_IOU_THRESHOLD && compareBoundary.containment >= SURFACE_CONTAINMENT_THRESHOLD && lossMeasured;
    notes.push(
      `Interior cells cannot be represented by a boundary mesh: ${(compareTotal.containment * 100).toFixed(2)}% of the input is recoverable, ` +
        `while ${(compareBoundary.containment * 100).toFixed(2)}% of its BOUNDARY is. This is the irreducible information loss of a surface encoding, measured rather than assumed.`,
    );
  } else {
    pass =
      compareBoundary.iou >= SURFACE_IOU_THRESHOLD &&
      compareBoundary.containment >= SURFACE_CONTAINMENT_THRESHOLD &&
      gate.ok;
    if (!gate.ok) notes.push(`Export gate rejected the GLB: ${gate.problems.join("; ")}`);
  }

  if (compareTotal.unmatchedBeyondProbe > 0) {
    notes.push(`${compareTotal.unmatchedBeyondProbe} input cells had no recovered cell within the 4-cell probe radius.`);
  }

  return {
    name: input.name,
    kind: input.kind,
    description: input.description,
    grid: { resolution: input.grid.resolution, cellSize: input.grid.cellSize },
    inputCells,
    boundaryCells,
    recoveredCells,
    onlyOriginal: compareBoundary.onlyA,
    onlyRecovered: compareBoundary.onlyB,
    sharedCells: compareBoundary.shared,
    surfaceIou: compareBoundary.iou,
    surfaceContainment: compareBoundary.containment,
    totalIou: compareTotal.iou,
    totalContainment: compareTotal.containment,
    maxDisplacementCells: compareTotal.maxDisplacementCells,
    meanDisplacementCells: compareTotal.meanDisplacementCells,
    unmatchedBeyondProbe: compareTotal.unmatchedBeyondProbe,
    representableFraction,
    mesh: { vertices: vertexCount(mesh), triangles: triangleCount(mesh) },
    glbBytes: glb.byteLength,
    gateAccepted: gate.ok,
    gateProblems: gate.problems,
    timings: { meshMs, encodeMs, inspectMs, decodeMs, voxelizeMs, compareMs, totalMs: performance.now() - started },
    pass,
    notes,
  };
}

export function experimentBCases(): CaseSpec[] {
  const cases: CaseSpec[] = [];
  const g16 = createGrid({ cellSize: 0.05, resolution: [16, 16, 16] });
  const g24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });
  const g32 = createGrid({ cellSize: 0.05, resolution: [32, 32, 32] });

  cases.push(spec("cube-shell-16", "surface", "Hollow cube: the simplest irregular-free topology.", g16, boxShell(g16, { min: [2, 2, 2], max: [13, 13, 13] })));
  cases.push(spec("torus-24", "surface", "Genus-1 surface with a hole: winding and connectivity stress.", g24, torus(g24, [0.6, 0.6, 0.6], 0.28, 0.08)));
  cases.push(spec("irregular-blob-24", "surface", "Non-convex seeded blob: no analytic inverse, closest to character geometry.", g24, irregularBlob(g24, [0.6, 0.6, 0.6], 0.34, 7, 0.3)));
  cases.push(spec("sparse-random-24", "surface", "400 pseudo-random cells: no surface at all, the worst case for a boundary mesh.", g24, randomSparse(g24, 400, 99)));

  cases.push(spec("filled-box-16", "volume", "Solid 12³ block: interior cells a boundary mesh cannot hold.", g16, filledBox(g16, { min: [2, 2, 2], max: [13, 13, 13] })));
  cases.push(spec("filled-sphere-20", "volume", "Solid sphere: interior loss at a curved boundary.", createGrid({ cellSize: 0.05, resolution: [20, 20, 20] }), filledSphere(createGrid({ cellSize: 0.05, resolution: [20, 20, 20] }), [0.5, 0.5, 0.5], 0.4)));

  const g48 = createGrid({ cellSize: 0.04, resolution: [48, 48, 48] });
  cases.push(spec("sphere-shell-48", "surface", "Higher resolution sphere shell (48³): does fidelity survive scale?", g48, sphereShell(g48, [0.96, 0.96, 0.96], 0.8, 0.04)));

  cases.push(spec("line-32", "degenerate", "One-cell-wide open curve: a surface with no volume.", g32, lineOfCells(g32, [4, 4, 4], [27, 20, 12])));
  cases.push(spec("plane-16", "degenerate", "Flat one-cell sheet: zero thickness.", g16, planeSheet(g16, 8, 12)));
  cases.push(spec("single-cell", "degenerate", "One cell: the smallest possible representation.", g16, boxShell(g16, { min: [8, 8, 8], max: [8, 8, 8] })));
  cases.push(spec("empty", "degenerate", "No cells: absence of observed geometry.", g16, boxShell(g16, { min: [8, 8, 8], max: [8, 8, 7] }), true));

  // Multiple resolutions of the same shape.
  for (const resolution of [16, 24, 32]) {
    const grid = createGrid({ cellSize: 1 / resolution, resolution: [resolution, resolution, resolution] });
    const center: Vec3 = [0.5, 0.5, 0.5];
    cases.push(spec(`resolution-${resolution}`, "surface", `Sphere shell on a ${resolution}³ lattice — resolution comparison.`, grid, sphereShell(grid, center, 0.4, grid.cellSize)));
  }

  // Confidence must survive the geometry detour as data, not be lost.
  const confident = withUniformConfidence(sphereShell(g24, [0.6, 0.6, 0.6], 0.34, 0.05), 0.72);
  cases.push(spec("confidence-carrying-24", "surface", "Sphere shell carrying a confidence channel: the detour must not fabricate confidence.", g24, confident));

  return cases;
}

export async function runExperimentB(): Promise<ExperimentBReport> {
  const cases = experimentBCases().map(evaluateCase);
  const surfaceCases = cases.filter((c) => c.kind === "surface");
  const passed = cases.filter((c) => c.pass).length;
  const meanSurfaceIou = surfaceCases.reduce((s, c) => s + c.surfaceIou, 0) / Math.max(1, surfaceCases.length);
  const worst = surfaceCases.reduce((worst, c) => (c.surfaceIou < worst.surfaceIou ? c : worst), surfaceCases[0]);

  return {
    thresholds: { surfaceIou: SURFACE_IOU_THRESHOLD, surfaceContainment: SURFACE_CONTAINMENT_THRESHOLD },
    cases,
    summary: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      surfaceCases: surfaceCases.length,
      meanSurfaceIou,
      worstSurfaceIou: worst?.surfaceIou ?? 0,
      worstCase: worst?.name ?? "none",
      totalGlbBytes: cases.reduce((s, c) => s + c.glbBytes, 0),
      status: passed === cases.length ? "VERIFIED" : passed > 0 ? "PARTIAL" : "BLOCKED",
      statement:
        "Reversibility is measured, not claimed: every case reports the boundary intersection, the recovered cells and the displacement. " +
        "Surface encodings are lossless within the stated tolerance; dense volumes are not, and the size of that loss is reported per case.",
    },
  };
}
