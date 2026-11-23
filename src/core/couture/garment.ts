/**
 * ==========================================================
 * LÉLU — GARMENT ASSEMBLY
 *
 * One garment is an assembly, not a single mesh: a simulated
 * cloth shell (one per fabric layer), rigid sculptural parts,
 * and the 2D pattern they were cut from. Every part keeps a
 * stable ID, and the report states for each part whether it
 * was simulated, generated, or only drafted.
 *
 * The 3D shell and the 2D net are the same construction: both
 * take their girths from the same measurements and the same
 * eases, so a waist seam length in the pattern is the waist
 * ring of the mesh.
 * ==========================================================
 */

import { clamp, round, surfaceArea, type Mesh } from "./geometry";
import {
  buildAvatar,
  garmentRadiusAt,
  garmentSurface,
  pleatRetention,
  simulateCloth,
  torsoCollider,
  type Avatar,
  type GridSurface,
  type SimMetrics,
} from "./cloth";
import {
  checkPattern,
  construction,
  DEFAULT_STYLE,
  draftPattern,
  fabricRequirement,
  patternOk,
  type BodyMeasurements,
  type GarmentStyle,
  type Pattern,
} from "./pattern";
import { generateSculptural, type SculpturalPart, type SculpturalSpec } from "./sculptural";
import { findMaterial, simulationParameters, type CoutureMaterial } from "./textiles";

export type LayerRole = "shell" | "lining" | "overlay" | "understructure";

export interface GarmentLayerSpec {
  material: string;
  role?: LayerRole;
  /** How far outside the shell this layer sits, mm. */
  offsetMm?: number;
  opacity?: number;
  simulate?: boolean;
}

export interface GarmentSpec {
  name?: string;
  style?: Partial<GarmentStyle>;
  measurements?: Partial<BodyMeasurements>;
  /** The main cloth. */
  material: string;
  /** Extra cloth layers. The shell is added automatically when absent. */
  layers?: GarmentLayerSpec[];
  sculptural?: SculpturalSpec[];
  pleats?: { count: number; depthMm: number; direction: "knife" | "box" | "accordion" };
  seed?: number;
  simulate?: boolean;
  steps?: number;
  iterations?: number;
  /** Resolution of the cloth mesh. */
  rows?: number;
  cols?: number;
}

export interface BuiltLayer {
  id: string;
  role: LayerRole;
  material: CoutureMaterial;
  materialId: string;
  offsetMm: number;
  opacity: number;
  /** The cloth as cut and placed, before gravity. */
  initial: GridSurface;
  /** After the solve; identical to `initial` when not simulated. */
  final: Float64Array;
  mesh: Mesh;
  simulated: boolean;
  areaMm2: number;
  massG: number;
  metrics: SimMetrics | null;
  note: string;
}

export interface GarmentCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BuiltGarment {
  id: string;
  name: string;
  pattern: Pattern;
  avatar: Avatar;
  layers: BuiltLayer[];
  sculptural: SculpturalPart[];
  checks: GarmentCheck[];
  report: {
    style: GarmentStyle;
    measurements: BodyMeasurements;
    material: string;
    simulatedLayers: number;
    totalTriangles: number;
    totalMassG: number;
    fabric: ReturnType<typeof fabricRequirement>;
    simulationMs: number;
    materialBehaviour: Array<{ layer: string; material: string; parameters: string; retention: number; drapeDropMm: number; maxStrainPct: number }>;
    notes: string[];
  };
}

export interface GarmentResult {
  ok: boolean;
  garment?: BuiltGarment;
  reason?: string;
}

/** Grid-aligned edges: the ones a knitted/woven cloth actually stretches along. */
function gridStructuralEdges(rows: number, cols: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const a = i * cols + j;
      if (j + 1 < cols) edges.push([a, a + 1]);
      if (i + 1 < rows) edges.push([a, a + cols]);
    }
  }
  return edges;
}

function meshFromSurface(positions: Float64Array, indices: Uint32Array): Mesh {
  return { positions: Array.from(positions), indices: Array.from(indices) };
}

/**
 * Build one complete garment. Returns the pattern, the avatar, every layer
 * (with its own simulated positions), every sculptural part, and the
 * checks that say what actually happened.
 */
export function buildGarment(spec: GarmentSpec): GarmentResult {
  const primary = findMaterial(spec.material);
  if (!primary) return { ok: false, reason: `No material matches “${spec.material}”. Use a textile from the library.` };
  if (!primary.physical) return { ok: false, reason: `${primary.name} is a solid: a garment shell needs a cloth (use it for a sculptural part or a product instead).` };

  const style: GarmentStyle = { ...DEFAULT_STYLE, ...spec.style };
  const pattern = draftPattern(style, spec.measurements ?? {}, "M");
  const avatar = buildAvatar(pattern.measurements, style);
  const c = construction(style, pattern.measurements, pattern.eases);

  const layerSpecs: GarmentLayerSpec[] = spec.layers?.length ? spec.layers : [{ material: spec.material, role: "shell" }];
  const hasShell = layerSpecs.some((l) => (l.role ?? "shell") === "shell");
  if (!hasShell) layerSpecs.unshift({ material: spec.material, role: "shell" });

  const rows = Math.max(8, Math.round(spec.rows ?? 30));
  const cols = Math.max(24, Math.round(spec.cols ?? 96));
  const structuralEdges = gridStructuralEdges(rows, cols);
  const collider = torsoCollider(avatar, 1.5);
  const layers: BuiltLayer[] = [];
  let simulationMs = 0;

  layerSpecs.forEach((layerSpec, k) => {
    const material = findMaterial(layerSpec.material) ?? primary;
    if (!material.physical) return;
    const role = layerSpec.role ?? (k === 0 ? "shell" : "overlay");
    const offset = layerSpec.offsetMm ?? (role === "lining" ? -3 : role === "overlay" ? 6 : role === "understructure" ? 14 : 0);
    const pleated = garmentSurface(style, pattern.measurements, pattern, {
      rows,
      cols,
      offsetMm: offset,
      pleats: spec.pleats,
      seed: (spec.seed ?? 11) + k * 37,
    });
    const plain = garmentSurface(style, pattern.measurements, pattern, {
      rows,
      cols,
      offsetMm: offset,
      pleats: undefined,
      seed: (spec.seed ?? 11) + k * 37,
    });
    const pinned = new Uint8Array(rows * cols);
    for (let j = 0; j < cols; j += 1) pinned[j] = 1; // the shoulder line holds the garment up
    const areaMm2 = surfaceArea(meshFromSurface(pleated.positions, pleated.indices));
    const shouldSimulate = spec.simulate !== false && layerSpec.simulate !== false;
    let final: Float64Array<ArrayBufferLike> = Float64Array.from(pleated.positions);
    let metrics: SimMetrics | null = null;
    let note = shouldSimulate ? "Simulated with the textile's own coefficients." : "Not simulated: the geometry is as drafted (simulation switched off for this layer).";

    if (shouldSimulate) {
      const result = simulateCloth({
        positions: pleated.positions,
        indices: pleated.indices,
        pinned,
        material: simulationParameters(material),
        areaMm2,
        collider,
        structuralEdges,
        groundZ: Math.min(c.hemY, 0),
        steps: spec.steps ?? 80,
        iterations: spec.iterations ?? 7,
        seed: (spec.seed ?? 11) + k,
      });
      final = result.positions;
      metrics = { ...result.metrics, pleatRetention: pleatRetention(pleated, result.positions, plain.positions, rows, cols) };
      simulationMs += result.metrics.wallMs;
      note = `Simulated ${result.metrics.steps} steps × ${result.metrics.iterations} iterations (${result.metrics.simSeconds}s of motion), settled to ${result.metrics.residualMm} mm; hem fold amplitude now ${round(metrics.pleatRetention * 100, 0)}% of the cut amplitude.`;
    }

    const massG = (areaMm2 / 1_000_000) * (material.physical.gsm);
    layers.push({
      id: `L-${String(k + 1).padStart(2, "0")}`,
      role,
      material,
      materialId: material.id,
      offsetMm: offset,
      opacity: layerSpec.opacity ?? material.visual.opacity,
      initial: pleated,
      final,
      mesh: meshFromSurface(final, pleated.indices),
      simulated: shouldSimulate,
      areaMm2: round(areaMm2, 0),
      massG: round(massG, 1),
      metrics,
      note,
    });
  });

  const sculptural = (spec.sculptural ?? []).map((s, i) => generateSculptural(
    s,
    { avatar, measurements: pattern.measurements, style, pattern, radiusAt: (z) => garmentRadiusAt(style, pattern.measurements, pattern, z) },
    i,
  ));

  const checks: GarmentCheck[] = [
    { name: "pattern checks", ok: patternOk(pattern), detail: `${pattern.checks.filter((x) => x.ok).length}/${pattern.checks.length} pattern checks passed` },
    { name: "avatar built", ok: avatar.levels.length >= 8, detail: `${avatar.levels.length} measured levels from neck to hem` },
    { name: "cloth layers", ok: layers.length > 0, detail: layers.map((l) => `${l.id} ${l.material.name} (${l.role})`).join(", ") },
    ...layers.map((l) => ({
      name: `${l.id} simulation ${l.simulated ? "converged" : "not run"}`,
      ok: l.simulated ? (l.metrics?.converged ?? false) : true,
      detail: l.metrics ? `residual ${l.metrics.residualMm} mm, ${l.metrics.contacts} contacts, ${l.metrics.wallMs} ms` : l.note,
    })),
    ...layers.filter((l) => l.metrics).map((l) => ({
      name: `${l.id} mean strain within material limit`,
      ok: (l.metrics?.meanStrainPct ?? 0) <= simulationParameters(l.material).maxStrainPct,
      detail: `${l.metrics?.meanStrainPct}% mean strain, ${l.metrics?.maxStrainPct}% at the worst single edge (${l.material.name} allows ${simulationParameters(l.material).maxStrainPct}%)`,
    })),
    ...sculptural.map((s) => ({ name: `${s.id} ${s.kind}`, ok: s.triangles > 0, detail: `${s.triangles} triangles, rigid, ${s.material}` })),
  ];

  const totalTriangles = layers.reduce((n, l) => n + l.mesh.indices.length / 3, 0) + sculptural.reduce((n, s) => n + s.triangles, 0);
  const totalMassG = layers.reduce((n, l) => n + l.massG, 0);

  return {
    ok: true,
    garment: {
      id: `gar_${Math.abs(Math.round((pattern.measurements.bust * 3 + pattern.measurements.waist * 7 + totalTriangles) * 10))}`,
      name: spec.name ?? `${style.silhouette} ${style.category} in ${primary.name}`,
      pattern,
      avatar,
      layers,
      sculptural,
      checks,
      report: {
        style,
        measurements: pattern.measurements,
        material: primary.name,
        simulatedLayers: layers.filter((l) => l.simulated).length,
        totalTriangles,
        totalMassG: round(totalMassG, 1),
        fabric: fabricRequirement(pattern),
        simulationMs,
        materialBehaviour: layers.map((l) => ({
          layer: l.id,
          material: l.material.name,
          parameters: l.material.physical ? simulationParameters(l.material).derivation : "",
          retention: l.metrics?.pleatRetention ?? 1,
          drapeDropMm: l.metrics?.drapeDropMm ?? 0,
          maxStrainPct: l.metrics?.maxStrainPct ?? 0,
        })),
        notes: [
          "The shell is simulated; sculptural parts are generated rigid geometry.",
          "Collision is against the mannequin and the floor. Self-collision between layers is not solved in this build.",
          "Pleat retention is the hem's radial fold amplitude after the solve divided by its amplitude as cut.",
          "No external generation API is involved: geometry, simulation and checks are computed locally.",
        ],
      },
    },
  };
}

/** Every mesh of the garment, labelled with its material, in mm z-up. */
export interface RenderPart {
  id: string;
  mesh: Mesh;
  material: CoutureMaterial;
  opacity: number;
  /** double-sided cloth */
  thin: boolean;
  note: string;
}

export function garmentRenderParts(g: BuiltGarment, options: { includeMannequin?: boolean } = {}): RenderPart[] {
  const parts: RenderPart[] = [];
  for (const layer of g.layers) {
    parts.push({ id: layer.id, mesh: layer.mesh, material: layer.material, opacity: layer.opacity, thin: true, note: `${layer.role} · ${layer.material.name}` });
  }
  for (const s of g.sculptural) {
    const material = findMaterial(s.material) ?? g.layers[0].material;
    // Transmission is what makes organza a veil instead of a white sheet.
    const opacity = clamp(material.visual.opacity * (1 - material.visual.transmission * 1.2), 0.2, 1);
    parts.push({ id: s.id, mesh: s.mesh, material, opacity, thin: true, note: `${s.kind} · ${material.name}` });
  }
  if (options.includeMannequin) {
    const mannequin = mannequinMesh(g.avatar);
    parts.push({
      id: "mannequin",
      mesh: mannequin,
      material: {
        ...g.layers[0].material,
        id: "mannequin",
        name: "Mannequin (matte plaster)",
        visual: { ...g.layers[0].material.visual, baseColor: "#d8d2c8", roughness: 0.85, metallic: 0, transmission: 0, sheen: 0, opacity: 1, doubleSided: false },
      },
      opacity: 1,
      thin: false,
      note: "The fitted mannequin the garment was simulated against.",
    });
  }
  return parts;
}

/** A body mesh from the avatar's measured levels, for context in a render. */
export function mannequinMesh(avatar: Avatar): Mesh {
  const cols = 48;
  const rows = avatar.levels.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    const level = avatar.levels[i];
    for (let j = 0; j < cols; j += 1) {
      const theta = (j / cols) * Math.PI * 2;
      positions.push(Math.sin(theta) * level.rx, -Math.cos(theta) * level.ry, level.z);
    }
  }
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const j2 = (j + 1) % cols;
      const a = i * cols + j, b = i * cols + j2, c = (i + 1) * cols + j, d = (i + 1) * cols + j2;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

/** The pattern's seam list with stitch counts — the bridge from pattern to 3D. */
export function seamReport(pattern: Pattern): Array<{ id: string; type: string; a: string; b: string; lengthA?: number; lengthB?: number; stitches: number }> {
  return pattern.seams.map((s) => {
    const check = pattern.checks.find((c) => c.name.startsWith(`${s.id}: seam lengths`));
    const numbers = check?.detail.match(/([\d.]+) mm against ([\d.]+) mm/);
    return {
      id: s.id,
      type: s.type,
      a: `${s.a.piece}.${s.a.edge}`,
      b: `${s.b.piece}.${s.b.edge}`,
      lengthA: numbers ? Number(numbers[1]) : undefined,
      lengthB: numbers ? Number(numbers[2]) : undefined,
      stitches: 24,
    };
  });
}

export { checkPattern };
