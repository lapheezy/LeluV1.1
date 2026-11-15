/**
 * ==========================================================
 * LÉLU — COUTURE: SCULPTURAL GEOMETRY
 *
 * Haute couture is not only cloth. These are the parametric
 * structures that share an assembly with simulated fabric:
 * pleated panels, ruffles, a rib cage of curved ribs, a
 * translucent shell, a lattice, modular panels and a standing
 * collar. Every one is generated from numbers, so every one is
 * editable, exportable and reproducible.
 *
 * Units: mm, z-up, waist at z = 0 — the same space as the
 * pattern and the simulated shell.
 * ==========================================================
 */

import { clamp, round, type Mesh, type Vec3 } from "./geometry";
import { levelAt, type Avatar } from "./cloth";
import { construction, type BodyMeasurements, type GarmentStyle, type Pattern } from "./pattern";

export type SculpturalKind =
  | "pleated-panel"
  | "ruffle"
  | "rib-cage"
  | "translucent-shell"
  | "lattice"
  | "modular-panels"
  | "standing-collar";

export interface SculpturalSpec {
  kind: SculpturalKind;
  id?: string;
  material: string;
  /** Kind-specific numbers; defaults are documented per kind. */
  params?: Record<string, number>;
  note?: string;
}

export interface SculpturalPart {
  id: string;
  kind: SculpturalKind;
  name: string;
  material: string;
  mesh: Mesh;
  /** Structural parts are rigid in this build: they are not cloth-simulated. */
  simulated: false;
  triangles: number;
  note: string;
  params: Record<string, number>;
}

export interface SculpturalContext {
  avatar: Avatar;
  measurements: BodyMeasurements;
  style: GarmentStyle;
  pattern: Pattern;
  /** Radius of the garment surface at a height; falls back to the body. */
  radiusAt?: (z: number) => number;
}

const radiusOf = (ctx: SculpturalContext, z: number): number => (ctx.radiusAt ? ctx.radiusAt(z) : Math.max(levelAt(ctx.avatar, z).rx, levelAt(ctx.avatar, z).ry));

/* ---------------- mesh helpers ---------------- */

/** A surface from a parametric function, (u,v) ∈ [0,1]². */
export function gridMesh(nu: number, nv: number, fn: (u: number, v: number) => Vec3): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= nu; i += 1) {
    for (let j = 0; j <= nv; j += 1) {
      const p = fn(i / nu, j / nv);
      positions.push(p.x, p.y, p.z);
    }
  }
  const row = nv + 1;
  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

/** A tube swept along a path — ribs, lattice struts, collars. */
export function sweepTube(path: Vec3[], radius: number, sides = 8): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = path.length;
  if (n < 2) return { positions, indices };
  for (let i = 0; i < n; i += 1) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
    const len = Math.hypot(tx, ty, tz) || 1;
    // A stable frame: any vector not parallel to the tangent.
    let ax = 0, ay = 0, az = 1;
    if (Math.abs(tz / len) > 0.95) { ax = 1; az = 0; }
    const ux = (ty / len) * az - (tz / len) * ay;
    const uy = (tz / len) * ax - (tx / len) * az;
    const uz = (tx / len) * ay - (ty / len) * ax;
    const ul = Math.hypot(ux, uy, uz) || 1;
    const vx = (ty / len) * (uz / ul) - (tz / len) * (uy / ul);
    const vy = (tz / len) * (ux / ul) - (tx / len) * (uz / ul);
    const vz = (tx / len) * (uy / ul) - (ty / len) * (ux / ul);
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      const radiusNow = radius;
      positions.push(
        path[i].x + ((ux / ul) * Math.cos(a) + vx * Math.sin(a)) * radiusNow,
        path[i].y + ((uy / ul) * Math.cos(a) + vy * Math.sin(a)) * radiusNow,
        path[i].z + ((uz / ul) * Math.cos(a) + vz * Math.sin(a)) * radiusNow,
      );
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = i * sides + s, b = i * sides + ((s + 1) % sides);
      const c = (i + 1) * sides + s, d = (i + 1) * sides + ((s + 1) % sides);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

const frame = (r: number, theta: number, z: number): Vec3 => ({ x: Math.sin(theta) * r, y: -Math.cos(theta) * r, z });

/* ---------------- generators ---------------- */

function pleatedPanel(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const pleats = clamp(Math.round(p.pleats ?? 22), 2, 90);
  const depth = clamp(p.depthMm ?? 26, 0, 140);
  const span = (clamp(p.spanDeg ?? 210, 20, 350) * Math.PI) / 180;
  const start = ((p.startDeg ?? -span / 2 * 180 / Math.PI) * Math.PI) / 180;
  const z0 = p.zStartMm ?? 120;
  const z1 = p.zEndMm ?? c.hipY - 120;
  const width = p.widthMm ?? 0;
  const base = clamp(p.baseRadiusMm ?? 0, 0, 400);
  return gridMesh(110, 26, (u, v) => {
    const theta = start + span * u;
    const z = z0 + (z1 - z0) * v;
    const avatar = levelAt(ctx.avatar, z);
    const r = Math.max(avatar.rx, avatar.ry) + base + width;
    const taper = 0.35 + 0.65 * v;
    const radial = r + Math.sin(theta * pleats) * depth * taper;
    return frame(radial, theta, z);
  });
}

function ruffle(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const turns = clamp(p.turns ?? 3, 0.5, 12);
  const lobes = clamp(Math.round(p.lobes ?? 26), 3, 120);
  const amp = clamp(p.amplitudeMm ?? 60, 0, 300);
  const ribbon = clamp(p.widthMm ?? 90, 10, 300);
  const z0 = p.zStartMm ?? 60;
  const z1 = p.zEndMm ?? c.hipY - 40;
  const offset = clamp(p.offsetMm ?? 30, 0, 300);
  // The band's WIDTH runs vertically (a frill), while the wave pushes it in and
  // out; a ribbon laid flat would read as a disc, not a ruffle.
  return gridMesh(300, 4, (u, v) => {
    const angle = u * turns * Math.PI * 2 + (p.phase ?? 0);
    const z = z0 + (z1 - z0) * u;
    const base = radiusOf(ctx, z) + offset;
    const wave = Math.sin(angle * lobes * 0.5) * amp * 0.5;
    return frame(base + wave, angle, z + (v - 0.5) * ribbon);
  });
}

function ribCage(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const count = clamp(Math.round(p.count ?? 10), 3, 40);
  const span = (clamp(p.spanDeg ?? 170, 20, 350) * Math.PI) / 180;
  const z0 = p.zStartMm ?? 150;
  const z1 = p.zEndMm ?? c.hipY - 80;
  const radius = clamp(p.tubeMm ?? 5, 1, 30);
  const outward = clamp(p.outwardMm ?? 40, 0, 300);
  const meshes: Mesh[] = [];
  const vertical = (p.vertical ?? 0) > 0.5;
  for (let k = 0; k < count; k += 1) {
    const path: Vec3[] = [];
    const segments = 48;
    if (vertical) {
      // Boning: a strut running up the bodice, bowed outward at its middle.
      const theta = count > 1 ? -span / 2 + (span * k) / (count - 1) : 0;
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        const z = z0 + (z1 - z0) * t;
        path.push(frame(radiusOf(ctx, z) + Math.sin(t * Math.PI) * outward, theta, z));
      }
    } else {
      const z = z0 + ((z1 - z0) * k) / Math.max(1, count - 1);
      const tilt = (k / count - 0.5) * (p.tiltMm ?? 30);
      for (let s = 0; s <= segments; s += 1) {
        const theta = -span / 2 + (span * s) / segments;
        const bulge = Math.sin((s / segments) * Math.PI) * outward;
        path.push(frame(radiusOf(ctx, z) + bulge, theta, z + Math.sin((s / segments) * Math.PI) * tilt));
      }
    }
    meshes.push(sweepTube(path, radius, 8));
  }
  // Merge the ribs into one mesh with stable vertex groups.
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    for (const i of m.indices) indices.push(i + base);
  }
  return { positions, indices };
}

function translucentShell(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const waves = clamp(Math.round(p.waves ?? 7), 2, 40);
  const amp = clamp(p.amplitudeMm ?? 55, 0, 250);
  const span = (clamp(p.spanDeg ?? 300, 30, 359) * Math.PI) / 180;
  const z0 = p.zStartMm ?? c.shoulderY - 30;
  const z1 = p.zEndMm ?? c.hipY;
  const clearance = clamp(p.offsetMm ?? 30, 2, 200);
  return gridMesh(120, 30, (u, v) => {
    const theta = -span / 2 + span * u;
    const z = z0 + (z1 - z0) * v;
    const r = radiusOf(ctx, z) + clearance + Math.abs(Math.sin(u * Math.PI * waves)) * amp * (0.4 + 0.6 * v);
    return frame(r, theta, z + Math.cos(u * Math.PI * 2) * amp * 0.15);
  });
}

function lattice(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const nodes = clamp(Math.round(p.nodes ?? 18), 4, 60);
  const levels = clamp(Math.round(p.levels ?? 5), 2, 24);
  const z0 = p.zStartMm ?? 120;
  const z1 = p.zEndMm ?? c.hipY - 60;
  const tube = clamp(p.tubeMm ?? 2.4, 0.5, 12);
  const offset = clamp(p.offsetMm ?? 34, 0, 200);
  const point = (i: number, n: number): Vec3 => {
    const z = z0 + ((z1 - z0) * i) / Math.max(1, levels - 1);
    const av = levelAt(ctx.avatar, z);
    const r = Math.max(av.rx, av.ry) + offset + Math.sin((i / levels) * Math.PI) * (p.bulgeMm ?? 40);
    return frame(r, (n / nodes) * Math.PI * 2, z);
  };
  const meshes: Mesh[] = [];
  for (let i = 0; i < levels - 1; i += 1) {
    for (let n = 0; n < nodes; n += 1) {
      meshes.push(sweepTube([point(i, n), point(i + 1, n)], tube, 6));
      meshes.push(sweepTube([point(i, n), point(i + 1, n + 1)], tube, 6));
      if (i === 0) meshes.push(sweepTube([point(i, n), point(i, n + 1)], tube, 6));
    }
  }
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    for (const idx of m.indices) indices.push(idx + base);
  }
  return { positions, indices };
}

function modularPanels(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const count = clamp(Math.round(p.count ?? 12), 3, 48);
  const gapDeg = clamp(p.gapDeg ?? 6, 0, 40);
  const z0 = p.zStartMm ?? 60;
  const z1 = p.zEndMm ?? c.hipY - 100;
  const flare = clamp(p.flareMm ?? 90, 0, 400);
  const panelDeg = 360 / count - gapDeg;
  const meshes: Mesh[] = [];
  for (let k = 0; k < count; k += 1) {
    const center = ((k / count) * 360);
    const span = (panelDeg * Math.PI) / 180;
    const start = ((center - panelDeg / 2) * Math.PI) / 180;
    meshes.push(gridMesh(6, 16, (u, v) => {
      const theta = start + span * u;
      const z = z0 + (z1 - z0) * v;
      const r = radiusOf(ctx, z) + 18 + flare * v * v + Math.sin(u * Math.PI) * (p.crownMm ?? 20);
      return frame(r, theta, z);
    }));
  }
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    for (const idx of m.indices) indices.push(idx + base);
  }
  return { positions, indices };
}

function standingCollar(ctx: SculpturalContext, p: Record<string, number>): Mesh {
  const c = construction(ctx.style, ctx.measurements, ctx.pattern.eases);
  const height = clamp(p.heightMm ?? 75, 15, 200);
  const flare = clamp(p.flareMm ?? 26, -20, 150);
  // Above the shoulder line the body is the neck, which is what a collar circles.
  const z0 = p.zStartMm ?? c.shoulderY - 6;
  const gap = (clamp(p.gapDeg ?? 24, 0, 120) * Math.PI) / 180;
  // A collar circles the neck, not the shoulders: use the neck-level radius.
  const neck = ctx.avatar.levels[0];
  const neckRadius = Math.max(neck.rx, neck.ry);
  return gridMesh(90, 8, (u, v) => {
    const theta = -Math.PI + gap + (Math.PI * 2 - gap * 2) * u;
    const r = neckRadius + 14 + flare * v + Math.sin(u * Math.PI) * 6;
    return frame(r, theta, z0 + height * v);
  });
}

const DEFAULTS: Record<SculpturalKind, { name: string; note: string }> = {
  "pleated-panel": { name: "Knife-pleated panel", note: "A pleated surface whose folds are real geometry; the simulated shell moves independently of it." },
  ruffle: { name: "Spiral ruffle", note: "A helical ribbon with a wave: volume that travels around the body." },
  "rib-cage": { name: "Rib cage", note: "Curved structural ribs held off the body — the corsetry/armature layer." },
  "translucent-shell": { name: "Translucent shell", note: "An offset double-sided shell: volume that reads as light rather than cloth." },
  lattice: { name: "Lattice", note: "A strut network: open structure at minimum mass." },
  "modular-panels": { name: "Modular panels", note: "Discrete curved panels with gaps — a modular silhouette." },
  "standing-collar": { name: "Standing collar", note: "A flared band around the neck: the couture collar that frames the face." },
};

export function generateSculptural(spec: SculpturalSpec, ctx: SculpturalContext, index = 0): SculpturalPart {
  const params = spec.params ?? {};
  const kind = spec.kind;
  const mesh = kind === "pleated-panel" ? pleatedPanel(ctx, params)
    : kind === "ruffle" ? ruffle(ctx, params)
      : kind === "rib-cage" ? ribCage(ctx, params)
        : kind === "translucent-shell" ? translucentShell(ctx, params)
          : kind === "lattice" ? lattice(ctx, params)
            : kind === "modular-panels" ? modularPanels(ctx, params)
              : standingCollar(ctx, params);
  return {
    id: spec.id ?? `S-${String(index + 1).padStart(2, "0")}`,
    kind,
    name: DEFAULTS[kind].name,
    material: spec.material,
    mesh,
    simulated: false,
    triangles: mesh.indices.length / 3,
    note: spec.note ?? DEFAULTS[kind].note,
    params,
  };
}

export const SCULPTURAL_KINDS = Object.keys(DEFAULTS) as SculpturalKind[];

/** Bounding size of a part, mm — for reports and scene framing. */
export function partExtent(mesh: Mesh): Vec3 {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]); maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]); maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]); maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  return { x: round(maxX - minX, 1), y: round(maxY - minY, 1), z: round(maxZ - minZ, 1) };
}

export const SCULPTURAL_EVIDENCE = "Parametric surfaces generated from the assembly's own measurements; rigid parts are not cloth-simulated.";
