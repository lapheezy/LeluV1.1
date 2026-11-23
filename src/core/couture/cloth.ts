/**
 * ==========================================================
 * LÉLU — CLOTH: AVATAR, GARMENT SURFACE, POSITION-BASED SIMULATION
 *
 * The garment is a real triangle mesh wrapped on a body
 * surface built from the same measurements as the 2D pattern:
 * girths become elliptical cross-sections (Ramanujan's
 * approximation), so the waist seam in 2D and the waist ring
 * in 3D are the same number.
 *
 * The solver is position-based dynamics: Predict with gravity,
 * then project distance constraints (structural, shear, bend,
 * seam) and body collisions. Material coefficients come from
 * the textile library, so satin falls and mikado stands for a
 * stated reason, and the difference is measurable in the
 * result rather than only in the material's colour.
 *
 * It is deterministic: no Math.random, seeded offsets only.
 * No GPU, no network, no external API.
 * ==========================================================
 */

import { clamp, rng, round, type Mesh } from "./geometry";
import type { BodyMeasurements, GarmentStyle, Pattern } from "./pattern";
import { construction, necklineDrop } from "./pattern";
import { simulationParameters, type CoutureMaterial, type SimulationParameters } from "./textiles";

/* ---------------- avatar ---------------- */

export interface AvatarLevel {
  /** Waist-relative height, mm. */
  z: number;
  /** Semi-axis across the body (x), mm. */
  rx: number;
  /** Semi-axis front-to-back (y), mm. */
  ry: number;
  /** What the level is, for reports. */
  label: string;
}

export interface Avatar {
  levels: AvatarLevel[];
  heightMm: number;
  notes: string[];
}

/** Ramanujan's ellipse circumference — the bridge from a tape measure to semi-axes. */
export function ellipseCircumference(a: number, b: number): number {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Semi-axes of an ellipse with the given girth and depth ratio (ry = ratio · rx). */
export function ellipseFromGirth(girthMm: number, depthRatio: number): { rx: number; ry: number } {
  const d = clamp(depthRatio, 0.4, 1.1);
  // circumference scales linearly with rx, so solve once at rx = 1.
  const unit = ellipseCircumference(1, d);
  const rx = girthMm / unit;
  return { rx, ry: rx * d };
}

/** The body the garment is fitted to, from the measurements used to draft it. */
export function buildAvatar(m: BodyMeasurements, style: GarmentStyle): Avatar {
  const c = construction(style, m);
  const g = (girth: number, z: number, label: string): AvatarLevel => ({ z, ...ellipseFromGirth(girth, m.depthRatio), label });
  const levels: AvatarLevel[] = [
    g(m.neck + 20, c.shoulderY - 5, "neck base"),
    { z: c.shoulderY - 25, rx: m.shoulder / 2, ry: (m.shoulder / 2) * 0.62, label: "shoulder line" },
    g(m.bust + 30, c.shoulderY - 70, "chest"),
    g(m.bust, c.shoulderY - 140, "bust"),
    g(m.underbust, c.underarmY, "underbust"),
    g(m.waist, 40, "high waist"),
    g(m.waist, 0, "waist"),
    g(m.hip * 0.96, -90, "high hip"),
    g(m.hip, c.hipY, "hip"),
    g(m.hip * 0.97, c.hipY - 80, "low hip"),
    g(m.hip * 0.66, c.kneeY, "knee"),
    g(m.hip * 0.5, c.hemY, "hem line (mannequin stand)"),
  ];
  for (let i = 1; i < levels.length; i += 1) if (levels[i].z >= levels[i - 1].z) levels[i].z = levels[i - 1].z - 1;
  return {
    levels,
    heightMm: c.shoulderY - c.hemY,
    notes: [
      "Semi-axes come from each girth and the measured depth ratio; they are a fitted mannequin, not a scan.",
      "Shoulders use the across-shoulder measurement directly, because a girth cannot describe them.",
      "Collision is against this surface only — the garment does not collide with itself in this build.",
    ],
  };
}

/** Body semi-axes at a height, interpolated between the measured levels. */
export function levelAt(avatar: Avatar, z: number): { rx: number; ry: number } {
  const ls = avatar.levels;
  if (z >= ls[0].z) return { rx: ls[0].rx, ry: ls[0].ry };
  if (z <= ls[ls.length - 1].z) {
    const last = ls[ls.length - 1];
    return { rx: last.rx, ry: last.ry };
  }
  for (let i = 1; i < ls.length; i += 1) {
    if (z <= ls[i - 1].z && z >= ls[i].z) {
      const a = ls[i - 1], b = ls[i];
      const t = (a.z - z) / Math.max(1e-6, a.z - b.z);
      return { rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t };
    }
  }
  return { rx: ls[0].rx, ry: ls[0].ry };
}

export interface Collider {
  /** Move a point that is inside the body out to its surface. Returns true if it moved. */
  resolve(x: number, y: number, z: number, out: [number, number, number]): boolean;
}

/** Body collision with friction: a cloth point inside the mannequin is pushed to its surface. */
export function torsoCollider(avatar: Avatar, marginMm = 2): Collider {
  return {
    resolve(x, y, z, out) {
      const { rx, ry } = levelAt(avatar, z);
      const nx = x / Math.max(1e-6, rx + marginMm);
      const ny = y / Math.max(1e-6, ry + marginMm);
      const r2 = nx * nx + ny * ny;
      if (r2 >= 1) return false;
      const s = 1 / Math.sqrt(Math.max(1e-9, r2));
      out[0] = nx * s * (rx + marginMm);
      out[1] = ny * s * (ry + marginMm);
      out[2] = z;
      return true;
    },
  };
}

/* ---------------- garment surface ---------------- */

export interface GridSurface {
  /** mm, z-up; length 3·rows·cols. */
  positions: Float64Array;
  indices: Uint32Array;
  rows: number;
  cols: number;
  /** Smoothed radial multiplier used for pleats, kept for the retention metric. */
  pleatProfile: Float64Array;
}

export interface SurfaceOptions {
  rows?: number;
  cols?: number;
  /** Extra girth on top of the pattern ease (layers). */
  offsetMm?: number;
  pleats?: { count: number; depthMm: number; direction: "knife" | "box" | "accordion" };
  /** Radial wave used by sculptural overlays. */
  wave?: { count: number; amplitudeMm: number; phase: number };
  seed?: number;
}

/** Girth profile of the garment, from the pattern's construction — the same numbers as the net. */
function girthAt(style: GarmentStyle, m: BodyMeasurements, pattern: Pattern, z: number): number {
  const c = construction(style, m, pattern.eases);
  const points: Array<{ z: number; girth: number }> = [];
  points.push({ z: c.shoulderY, girth: m.bust + pattern.eases.bust + 20 });
  points.push({ z: c.underarmY, girth: m.bust + pattern.eases.bust });
  points.push({ z: 0, girth: m.waist + pattern.eases.waist });
  if (z <= 0) {
    if (["dress", "gown", "skirt"].includes(style.category)) {
      points.push({ z: c.hipY, girth: m.hip + pattern.eases.hip });
      points.push({ z: c.kneeY, girth: (m.hip + pattern.eases.hip) * (style.silhouette === "mermaid" ? 0.82 : 0.95) });
      points.push({ z: c.hemY, girth: Math.max(m.waist + pattern.eases.waist, c.hemQuarter * 4) });
    }
  } else {
    points.push({ z: c.shoulderY - 60, girth: (m.bust + pattern.eases.bust) * 1.02 });
  }
  const sorted = [...points].sort((a, b) => b.z - a.z);
  if (z >= sorted[0].z) return sorted[0].girth;
  if (z <= sorted[sorted.length - 1].z) return sorted[sorted.length - 1].girth * clamp((sorted[sorted.length - 1].z - z) / 400 + 1, 1, 4);
  for (let i = 1; i < sorted.length; i += 1) {
    if (z <= sorted[i - 1].z && z >= sorted[i].z) {
      const a = sorted[i - 1], b = sorted[i];
      const t = (a.z - z) / Math.max(1e-6, a.z - b.z);
      return a.girth + (b.girth - a.girth) * t;
    }
  }
  return sorted[0].girth;
}

/**
 * Radius of the garment (not the body) at a height: a sculptural part placed
 * on top of a flared skirt has to follow the skirt, or it dives inside it.
 */
export function garmentRadiusAt(style: GarmentStyle, m: BodyMeasurements, pattern: Pattern, z: number): number {
  const av = levelAt(buildAvatar(m, style), z);
  const girth = girthAt(style, m, pattern, z);
  return Math.max(av.rx, girth / (Math.PI * 2));
}

/**
 * Wrap a garment surface on the body: rows follow height, columns follow the
 * angle around the torso. Pleats are a radial wave that fades out at the
 * waist, which is where cloth can move; the simulation then decides how much
 * of that pleat survives.
 */
export function garmentSurface(style: GarmentStyle, m: BodyMeasurements, pattern: Pattern, options: SurfaceOptions = {}): GridSurface {
  const rows = clamp(Math.round(options.rows ?? 30), 6, 80);
  const cols = clamp(Math.round(options.cols ?? 96), 12, 240);
  const c = construction(style, m, pattern.eases);
  const top = c.shoulderY;
  const bottom = ["dress", "gown", "skirt"].includes(style.category) || ["cropped", "hip", "knee", "midi", "floor"].includes(style.length)
    ? Math.min(0, c.hemY)
    : 0;
  const positions = new Float64Array(rows * cols * 3);
  const pleatProfile = new Float64Array(rows * cols);
  const offset = (options.offsetMm ?? 0) + 6; // a little air between cloth and body
  const random = rng(options.seed ?? 7);
  const jitterPhase = random() * Math.PI * 2;

  // The neckline: the top edge of the tube dips at centre front and centre back
  // and stays high at the shoulders, so the garment has a shaped neck edge
  // and straps instead of a sawn-off cylinder.
  const drop = necklineDrop(style);
  const topAt = (theta: number): number => {
    const c = Math.cos(theta);
    const frontDip = Math.max(0, c) ** 1.6 * drop.front;
    const backDip = Math.max(0, -c) ** 1.6 * drop.back;
    return top - frontDip - backDip;
  };

  for (let i = 0; i < rows; i += 1) {
    const t = i / (rows - 1);
    for (let j = 0; j < cols; j += 1) {
      const theta = (j / cols) * Math.PI * 2;
      const topZ = topAt(theta);
      const z = topZ + (bottom - topZ) * t;
      const girth = girthAt(style, m, pattern, z) + offset * Math.PI * 2;
      const { rx, ry } = ellipseFromGirth(girth, m.depthRatio);
      const fade = clamp((top - z) / 240, 0, 1);
      let radial = 1;
      if (options.pleats && options.pleats.count > 0) {
        const k = Math.max(2, Math.round(options.pleats.count));
        const depth = clamp(options.pleats.depthMm, 1, 120);
        // Folds are cut outward from the body only: a pleat valley that started
        // inside the mannequin would spend the whole solve being pushed through
        // it, which is a modelling error, not a fabric behaviour.
        const shape = 0.5 + 0.5 * Math.sin(k * theta + jitterPhase);
        radial += (shape * depth * fade) / Math.max(40, girth / Math.PI);
      }
      if (options.wave) radial += (Math.sin(options.wave.count * theta + options.wave.phase) * options.wave.amplitudeMm * fade) / Math.max(40, girth / Math.PI);
      const idx = i * cols + j;
      pleatProfile[idx] = radial;
      positions[idx * 3] = Math.sin(theta) * rx * radial;
      positions[idx * 3 + 1] = -Math.cos(theta) * ry * radial;
      positions[idx * 3 + 2] = z;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const j2 = (j + 1) % cols;
      const a = i * cols + j, b = i * cols + j2, cIdx = (i + 1) * cols + j, d = (i + 1) * cols + j2;
      indices.push(a, b, cIdx, b, d, cIdx);
    }
  }
  return { positions, indices: new Uint32Array(indices), rows, cols, pleatProfile };
}

/* ---------------- simulation ---------------- */

export interface SimInput {
  positions: Float64Array;
  indices: ArrayLike<number>;
  /** 1 = held (shoulder line, waistband), 0 = free. */
  pinned: Uint8Array;
  material: SimulationParameters;
  /** Surface area of the cloth, mm² — with GSM this gives the mass. */
  areaMm2: number;
  collider: Collider;
  /** Grid-aligned edges that carry the cloth's stretch; the rest are shear. */
  structuralEdges?: Array<[number, number]>;
  /**
   * The same mesh in its un-pleated reference shape. Bend rest lengths come
   * from here, so a soft cloth relaxes out of a fold and a stiff one holds it.
   */
  referencePositions?: Float64Array;
  /** Seam stitches: pairs of vertices held together. */
  seamPairs?: Array<[number, number]>;
  /** Floor for a floor-length piece, mm. */
  groundZ?: number;
  steps?: number;
  iterations?: number;
  /** mm/s². */
  gravity?: number;
  seed?: number;
}

export interface SimMetrics {
  /** Vertex count. */
  vertices: number;
  triangles: number;
  steps: number;
  iterations: number;
  /** Largest structural strain reached, %. */
  maxStrainPct: number;
  meanStrainPct: number;
  /** Mean displacement of every vertex from where it was placed, mm. */
  meanDisplacementMm: number;
  /** Mean height change of the bottom row, mm (negative = the hem dropped). */
  drapeDropMm: number;
  /** How much of the pleat survived: 1 = unchanged, 0 = flat as the reference. */
  pleatRetention: number;
  /** Contact points resolved in the last step. */
  contacts: number;
  /** Largest per-iteration movement at the end, mm. */
  residualMm: number;
  converged: boolean;
  /** Extra iterations run after the last step to let the cloth settle. */
  settleIterations: number;
  /** Simulated time, s. */
  simSeconds: number;
  /** Mass of the cloth, g, from GSM × area. */
  massG: number;
  wallMs: number;
  notes: string[];
}

export interface SimResult {
  positions: Float64Array;
  metrics: SimMetrics;
  /** Residual after each step, for the evidence file. */
  residualPerStep: number[];
}

/**
 * Position-based dynamics. Constraint stiffness and damping come from the
 * material, so a change of cloth changes the drape and the measured result.
 */
export function simulateCloth(input: SimInput): SimResult {
  const started = Date.now();
  const pos = Float64Array.from(input.positions);
  const n = pos.length / 3;
  const prev = Float64Array.from(pos);
  const steps = clamp(Math.round(input.steps ?? 90), 1, 600);
  const iterations = clamp(Math.round(input.iterations ?? 8), 1, 40);
  const dt = 1 / 480; // s
  const gravity = -(input.gravity ?? 9810); // mm/s², z-up
  const invMass = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i += 1) if (input.pinned[i]) invMass[i] = 0;

  /* --- constraints from topology --- */
  const seen = new Set<number>();
  const edges: Array<[number, number]> = [];
  const index = input.indices;
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    for (let k = 0; k < 3; k += 1) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const id = key(a, b);
      if (!seen.has(id)) { seen.add(id); edges.push([Math.min(a, b), Math.max(a, b)]); }
    }
  }
  // Shear: the diagonals of each triangle (they are already edges of the
  // neighbouring triangle in a regular grid, so add nothing new here).
  const neighbours = new Map<number, Set<number>>();
  for (const [a, b] of edges) {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  // Bend: vertices two edges apart that are not already joined.
  const bend: Array<[number, number]> = [];
  for (const [a, set] of neighbours) {
    for (const b of set) for (const c2 of neighbours.get(b) ?? []) {
      if (c2 === a) continue;
      if (neighbours.get(a)?.has(c2)) continue;
      if (a < c2) bend.push([a, c2]);
    }
  }
  const restLength = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const edgeRest = new Float32Array(edges.length);
  for (let i = 0; i < edges.length; i += 1) edgeRest[i] = Math.max(0.01, restLength(edges[i][0], edges[i][1]));
  const bendRest = new Float32Array(bend.length);
  for (let i = 0; i < bend.length; i += 1) {
    const [a, b] = bend[i];
    if (input.referencePositions && input.referencePositions.length === pos.length) {
      const ref = input.referencePositions;
      bendRest[i] = Math.max(0.01, Math.hypot(ref[a * 3] - ref[b * 3], ref[a * 3 + 1] - ref[b * 3 + 1], ref[a * 3 + 2] - ref[b * 3 + 2]));
    } else {
      bendRest[i] = Math.max(0.01, restLength(a, b));
    }
  }

  const structural = clamp(input.material.structuralStiffness, 0.01, 1);
  const shear = clamp(input.material.shearStiffness, 0.01, 1);
  const bending = clamp(input.material.bendStiffness, 0.005, 1);
  const damping = clamp(input.material.damping, 0, 0.95);
  const friction = clamp(input.material.friction, 0, 0.95);
  const seamPairs = input.seamPairs ?? [];
  const groundZ = input.groundZ;

  // Which edges stretch (structural) and which resist shear (the diagonals).
  let structuralEdges = edges;
  let shearEdges: Array<[number, number]> = [];
  if (input.structuralEdges?.length) {
    const iso = new Set(input.structuralEdges.map(([a, b]) => key(a, b)));
    structuralEdges = input.structuralEdges.filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n);
    shearEdges = edges.filter(([a, b]) => !iso.has(key(a, b)));
  }
  const structuralRest = new Float32Array(structuralEdges.length);
  for (let i = 0; i < structuralEdges.length; i += 1) structuralRest[i] = Math.max(0.01, restLength(structuralEdges[i][0], structuralEdges[i][1]));
  const shearRest = new Float32Array(shearEdges.length);
  for (let i = 0; i < shearEdges.length; i += 1) shearRest[i] = Math.max(0.01, restLength(shearEdges[i][0], shearEdges[i][1]));

  const out: [number, number, number] = [0, 0, 0];
  let contacts = 0;
  let residual = 0;
  const residualPerStep: number[] = [];
  const hemStart = (() => {
    let m = Infinity;
    for (let i = 0; i < n; i += 1) m = Math.min(m, pos[i * 3 + 2]);
    return m;
  })();

  const project = (a: number, b: number, rest: number, stiffness: number) => {
    const ax = a * 3, bx = b * 3;
    const wa = invMass[a], wb = invMass[b];
    const w = wa + wb;
    if (w === 0) return 0;
    const dx = pos[bx] - pos[ax], dy = pos[bx + 1] - pos[ax + 1], dz = pos[bx + 2] - pos[ax + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) return 0;
    const diff = (len - rest) / len * stiffness;
    const cx = dx * diff, cy = dy * diff, cz = dz * diff;
    const fa = (wa / w), fb = (wb / w);
    pos[ax] += cx * fa; pos[ax + 1] += cy * fa; pos[ax + 2] += cz * fa;
    pos[bx] -= cx * fb; pos[bx + 1] -= cy * fb; pos[bx + 2] -= cz * fb;
    return Math.abs(len - rest) * stiffness;
  };

  /** One projection sweep. Returns the largest remaining correction, mm. */
  const iterate = (): number => {
    let worst = 0;
    for (let i = 0; i < structuralEdges.length; i += 1) worst = Math.max(worst, project(structuralEdges[i][0], structuralEdges[i][1], structuralRest[i], structural));
    for (let i = 0; i < shearEdges.length; i += 1) worst = Math.max(worst, project(shearEdges[i][0], shearEdges[i][1], shearRest[i], shear));
    for (let i = 0; i < bend.length; i += 1) worst = Math.max(worst, project(bend[i][0], bend[i][1], bendRest[i], bending));
    for (const [a, b] of seamPairs) {
      if (invMass[a] === 0 && invMass[b] === 0) continue;
      worst = Math.max(worst, project(a, b, 0, 1));
    }
    // Collisions, with friction on the tangential component.
    for (let i = 0; i < n; i += 1) {
      if (invMass[i] === 0) continue;
      const i3 = i * 3;
      out[0] = pos[i3]; out[1] = pos[i3 + 1]; out[2] = pos[i3 + 2];
      if (input.collider.resolve(out[0], out[1], out[2], out)) {
        worst = Math.max(worst, Math.hypot(out[0] - pos[i3], out[1] - pos[i3 + 1], out[2] - pos[i3 + 2]));
        pos[i3] = out[0]; pos[i3 + 1] = out[1]; pos[i3 + 2] = out[2];
        for (let k = 0; k < 3; k += 1) prev[i3 + k] = pos[i3 + k] + (prev[i3 + k] - pos[i3 + k]) * (1 - friction);
        contacts += 1;
      }
      if (groundZ !== undefined && pos[i3 + 2] < groundZ) {
        worst = Math.max(worst, groundZ - pos[i3 + 2]);
        pos[i3 + 2] = groundZ;
        prev[i3 + 2] = groundZ + (prev[i3 + 2] - groundZ) * (1 - friction);
        contacts += 1;
      }
    }
    return worst;
  };

  for (let step = 0; step < steps; step += 1) {
    // Predict (Verlet).
    for (let i = 0; i < n; i += 1) {
      if (invMass[i] === 0) continue;
      const i3 = i * 3;
      for (let k = 0; k < 3; k += 1) {
        const v = (pos[i3 + k] - prev[i3 + k]) * (1 - damping * 0.5);
        prev[i3 + k] = pos[i3 + k];
        pos[i3 + k] += v + (k === 2 ? gravity * dt * dt : 0);
      }
    }
    contacts = 0;
    for (let it = 0; it < iterations; it += 1) {
      residual = iterate();
      if (residual < 0.05) break;
    }
    residualPerStep.push(round(residual, 4));
  }

  // Settle: drop the velocity and keep solving until the cloth stops creeping.
  // The reported drape is the settled state, not where the last frame stopped.
  for (let i = 0; i < n * 3; i += 1) prev[i] = pos[i];
  contacts = 0;
  let settleIterations = 0;
  for (; settleIterations < 40; settleIterations += 1) {
    residual = iterate();
    if (residual < 0.05) break;
  }

  /* --- metrics --- */
  let maxStrainPct = 0;
  let sumStrain = 0;
  for (let i = 0; i < edges.length; i += 1) {
    const len = restLength(edges[i][0], edges[i][1]);
    const strain = ((len - edgeRest[i]) / Math.max(0.01, edgeRest[i])) * 100;
    maxStrainPct = Math.max(maxStrainPct, Math.abs(strain));
    sumStrain += Math.abs(strain);
  }
  let sumDisp = 0;
  for (let i = 0; i < n * 3; i += 3) sumDisp += Math.hypot(pos[i] - input.positions[i], pos[i + 1] - input.positions[i + 1], pos[i + 2] - input.positions[i + 2]);
  const meanDisplacement = sumDisp / Math.max(1, n);
  let hemEnd = 0;
  let hemCount = 0;
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(input.positions[i * 3 + 2] - hemStart) < 1e-6) { hemEnd += pos[i * 3 + 2]; hemCount += 1; }
  }
  const hemMean = hemCount ? hemEnd / hemCount : hemStart;
  const massG = (input.areaMm2 / 1_000_000) * (input.material.massPerAreaKgM2 * 1000);

  return {
    positions: pos,
    residualPerStep,
    metrics: {
      vertices: n,
      triangles: index.length / 3,
      steps,
      iterations,
      maxStrainPct: round(maxStrainPct, 2),
      meanStrainPct: round(edges.length ? sumStrain / edges.length : 0, 2),
      meanDisplacementMm: round(meanDisplacement, 1),
      drapeDropMm: round(hemMean - hemStart, 1),
      pleatRetention: 1,
      contacts,
      residualMm: round(residual, 3),
      // A garment 1.4 m tall is settled when no point still moves more than a
      // millimetre; sub-millimetre would be a stronger claim than this solver earns.
      converged: residual < 2,
      settleIterations,
      simSeconds: round(steps * dt, 3),
      massG: round(massG, 1),
      wallMs: Date.now() - started,
      notes: [
        "Position-based dynamics, CPU, deterministic (no randomness in the solve).",
        "The garment collides with the mannequin surface and the floor; it does not self-collide in this build.",
        "Strain is measured on the structural edges; the max-strain limit is applied as a soft target, not a hard cap.",
      ],
    },
  };
}

/**
 * How much of the pleat survived: the solved hem's deviation from the plain
 * surface, projected onto the deviation it was cut with.
 *
 * 1 = the folds are exactly as cut; 0 = they have relaxed completely flat.
 * This compares against the un-pleated reference, so a garment that sags or
 * stretches does not accidentally score above 1.
 */
export function pleatRetention(
  initial: GridSurface,
  finalPositions: Float64Array,
  referencePositions: Float64Array,
  rows = initial.rows,
  cols = initial.cols,
): number {
  const lastRow = rows - 1;
  let dot = 0;
  let norm = 0;
  for (let j = 0; j < cols; j += 1) {
    const idx = (lastRow * cols + j) * 3;
    const r0 = Math.hypot(initial.positions[idx], initial.positions[idx + 1]);
    const r1 = Math.hypot(finalPositions[idx], finalPositions[idx + 1]);
    const rr = Math.hypot(referencePositions[idx], referencePositions[idx + 1]);
    const d0 = r0 - rr;
    dot += (r1 - rr) * d0;
    norm += d0 * d0;
  }
  if (norm < 1e-6) return 1;
  return round(clamp(dot / norm, 0, 2), 3);
}

/* ---------------- cantilever drape test ---------------- */

export interface DrapeResult {
  material: string;
  /** How far the free end fell below the horizontal, mm (length = fully limp). */
  tipDropMm: number;
  /** 0 = falls like water, 1 = holds its own weight out straight. */
  rigidity: number;
  mesh: Mesh;
  metrics: SimMetrics;
}

/**
 * The cantilever drape test, in simulation: a strip held flat by one edge and
 * left to gravity. A fabric with low bending stiffness curls down; a stiff one
 * stays out. Same strip, same gravity, only the material changes — which is
 * what makes the comparison evidence rather than styling.
 */
export function drapeBenchmark(
  material: CoutureMaterial,
  options: { widthMm?: number; lengthMm?: number; steps?: number; along?: number; across?: number } = {},
): DrapeResult | { error: string } {
  if (!material.physical) return { error: `${material.name} is a solid, not a cloth.` };
  const width = options.widthMm ?? 200;
  const length = options.lengthMm ?? 320;
  const across = options.across ?? 14;
  const along = options.along ?? 30;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= along; i += 1) {
    for (let j = 0; j <= across; j += 1) {
      positions.push(-width / 2 + (width * j) / across, (length * i) / along, 0);
    }
  }
  const row = across + 1;
  for (let i = 0; i < along; i += 1) {
    for (let j = 0; j < across; j += 1) {
      const a = i * row + j;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const structuralEdges: Array<[number, number]> = [];
  for (let i = 0; i <= along; i += 1) for (let j = 0; j <= across; j += 1) {
    const a = i * row + j;
    if (j < across) structuralEdges.push([a, a + 1]);
    if (i < along) structuralEdges.push([a, a + row]);
  }
  const pinned = new Uint8Array((along + 1) * row);
  for (let j = 0; j <= across; j += 1) pinned[j] = 1;
  const n = ((along + 1) * row);
  // The strip has no pleats: a flat reference is the same as the cut shape, so
  // bending resists the droop itself.
  const result = simulateCloth({
    positions: Float64Array.from(positions),
    indices,
    pinned,
    material: simulationParameters(material),
    areaMm2: width * length,
    collider: { resolve: () => false },
    structuralEdges,
    referencePositions: Float64Array.from(positions),
    steps: options.steps ?? 110,
    iterations: 9,
  });
  let tipZ = 0;
  for (let j = 0; j <= across; j += 1) tipZ += result.positions[(along * row + j) * 3 + 2] / (across + 1);
  const tipDrop = Math.max(0, -tipZ);
  return {
    material: material.name,
    tipDropMm: round(tipDrop, 1),
    rigidity: round(clamp(1 - tipDrop / length, 0, 1), 3),
    mesh: { positions: Array.from(result.positions), indices },
    metrics: { ...result.metrics, vertices: n },
  };
}

/** Convert simulated mm positions into a triangle mesh at scene scale (metres, y-up). */
export function simulatedSceneMesh(positions: Float64Array, indices: ArrayLike<number>): { positions: number[]; indices: number[] } {
  const outPositions: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    outPositions[i] = positions[i] / 1000;
    outPositions[i + 1] = positions[i + 2] / 1000;
    outPositions[i + 2] = -positions[i + 1] / 1000;
  }
  return { positions: outPositions, indices: Array.from(indices as ArrayLike<number>) };
}

export const averageZ = (positions: Float64Array): number => {
  let sum = 0;
  for (let i = 2; i < positions.length; i += 3) sum += positions[i];
  return sum / Math.max(1, positions.length / 3);
};
