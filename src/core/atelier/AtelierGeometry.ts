/**
 * ==========================================================
 * LÉLU — ATELIER: GEOMETRY, MASS, COST, INTERFERENCE
 *
 * Pure calculations from the components as stated. Units: mm,
 * cm³, g. Every result says how it was obtained, so a report can
 * call a mass "calculated" and an interference check
 * "software-validated (bounding boxes)" — and no more than that.
 * ==========================================================
 */

import { MATERIAL_LIBRARY, type Component, type DesignDirection, type Material, type Vec3 } from "./AtelierTypes";

export interface Mesh {
  id: string;
  name: string;
  positions: number[]; // x,y,z triples (mm)
  normals: number[];
  indices: number[];
}

export interface Bounds { min: Vec3; max: Vec3 }

/* ---------------- meshes ---------------- */

function pushTri(m: Mesh, a: number[], b: number[], c: number[]) {
  const base = m.positions.length / 3;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  for (const p of [a, b, c]) { m.positions.push(p[0], p[1], p[2]); m.normals.push(nx, ny, nz); }
  m.indices.push(base, base + 1, base + 2);
}

/** A component as a closed triangle mesh, outward-facing, in assembly coordinates. */
export function componentMesh(c: Component, offset: Vec3 = { x: 0, y: 0, z: 0 }): Mesh {
  const m: Mesh = { id: c.id, name: c.name, positions: [], normals: [], indices: [] };
  const cx = c.position.x + offset.x, cy = c.position.y + offset.y, cz = c.position.z + offset.z;
  if (c.shape === "box") {
    const hx = c.size.width / 2, hy = c.size.depth / 2, hz = c.size.height / 2;
    const v = (sx: number, sy: number, sz: number) => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
    const quad = (a: number[], b: number[], cc: number[], d: number[]) => { pushTri(m, a, b, cc); pushTri(m, a, cc, d); };
    quad(v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)); // bottom (-z)
    quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));     // top (+z)
    quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)); // front (-y)
    quad(v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1));     // back (+y)
    quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); // left (-x)
    quad(v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1));     // right (+x)
  } else if (c.shape === "cylinder") {
    const r = c.size.width / 2, hz = c.size.height / 2, n = 32;
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      pushTri(m, [p0[0], p0[1], cz - hz], [p1[0], p1[1], cz - hz], [p1[0], p1[1], cz + hz]);
      pushTri(m, [p0[0], p0[1], cz - hz], [p1[0], p1[1], cz + hz], [p0[0], p0[1], cz + hz]);
      pushTri(m, [cx, cy, cz + hz], [p0[0], p0[1], cz + hz], [p1[0], p1[1], cz + hz]);
      pushTri(m, [cx, cy, cz - hz], [p1[0], p1[1], cz - hz], [p0[0], p0[1], cz - hz]);
    }
  } else {
    const r = c.size.width / 2, rings = 14, segs = 24;
    const pt = (i: number, j: number) => {
      const th = (i / rings) * Math.PI, ph = (j / segs) * Math.PI * 2;
      return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), cz + r * Math.cos(th)];
    };
    for (let i = 0; i < rings; i += 1) for (let j = 0; j < segs; j += 1) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (i > 0) pushTri(m, a, b, d);
      if (i < rings - 1) pushTri(m, b, cc, d);
    }
  }
  return m;
}

export function meshBounds(meshes: Mesh[]): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    min.x = Math.min(min.x, m.positions[i]); max.x = Math.max(max.x, m.positions[i]);
    min.y = Math.min(min.y, m.positions[i + 1]); max.y = Math.max(max.y, m.positions[i + 1]);
    min.z = Math.min(min.z, m.positions[i + 2]); max.z = Math.max(max.z, m.positions[i + 2]);
  }
  return { min, max };
}

/** Axis-aligned box of one component (exact for boxes; enclosing for cylinders and spheres). */
export function componentBounds(c: Component): Bounds {
  const hx = c.size.width / 2;
  const hy = c.shape === "box" ? c.size.depth / 2 : c.size.width / 2;
  const hz = c.shape === "sphere" ? c.size.width / 2 : c.size.height / 2;
  return { min: { x: c.position.x - hx, y: c.position.y - hy, z: c.position.z - hz }, max: { x: c.position.x + hx, y: c.position.y + hy, z: c.position.z + hz } };
}

/* ---------------- mass and cost ---------------- */

/** Volume of ONE part, mm³ (analytic). */
export function componentVolume(c: Component): number {
  if (c.shape === "box") return c.size.width * c.size.depth * c.size.height;
  if (c.shape === "cylinder") return Math.PI * (c.size.width / 2) ** 2 * c.size.height;
  return (4 / 3) * Math.PI * (c.size.width / 2) ** 3;
}

export function findMaterial(name: string, extra: Material[] = []): Material | undefined {
  const key = name.trim().toLowerCase();
  const all = [...extra, ...MATERIAL_LIBRARY];
  return all.find((m) => m.name.toLowerCase() === key) ?? all.find((m) => key.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(key));
}

export interface BomRow {
  id: string;
  name: string;
  material: string;
  quantity: number;
  size: string;
  make: "buy" | "fabricate";
  unitCost: number | null;
  lineCost: number | null;
  /** g, for all `quantity` parts; null when the material's density is unknown. */
  mass: number | null;
  supplier: string;
  sources: string;
  /** How the cost is known. */
  costBasis: "sourced" | "stated" | "unknown";
}

export interface BomSummary {
  rows: BomRow[];
  totalCost: number;
  /** Parts whose cost is unknown: the total excludes them. */
  uncosted: string[];
  totalMass: number;
  /** Parts whose mass could not be calculated (unknown material density). */
  unweighed: string[];
}

const fmtSize = (c: Component) =>
  c.shape === "box" ? `${c.size.width} × ${c.size.depth} × ${c.size.height} mm` : c.shape === "cylinder" ? `Ø${c.size.width} × ${c.size.height} mm` : `Ø${c.size.width} mm`;

export function billOfMaterials(direction: DesignDirection, materials: Material[] = []): BomSummary {
  const rows: BomRow[] = direction.components.map((c) => {
    const mat = findMaterial(c.material, materials);
    const mass = mat ? (componentVolume(c) / 1000) * mat.density * c.quantity : null;
    const unit = typeof c.unitCost === "number" && Number.isFinite(c.unitCost) ? c.unitCost : null;
    return {
      id: c.id,
      name: c.name,
      material: c.material,
      quantity: c.quantity,
      size: fmtSize(c),
      make: c.make ?? (unit !== null && c.supplier ? "buy" : "fabricate"),
      unitCost: unit,
      lineCost: unit === null ? null : Math.round(unit * c.quantity * 100) / 100,
      mass: mass === null ? null : Math.round(mass * 10) / 10,
      supplier: c.supplier ?? "",
      sources: (c.sources ?? []).join(", "),
      costBasis: unit === null ? "unknown" : c.sources?.length ? "sourced" : "stated",
    };
  });
  return {
    rows,
    totalCost: Math.round(rows.reduce((s, r) => s + (r.lineCost ?? 0), 0) * 100) / 100,
    uncosted: rows.filter((r) => r.lineCost === null).map((r) => r.id),
    totalMass: Math.round(rows.reduce((s, r) => s + (r.mass ?? 0), 0) * 10) / 10,
    unweighed: rows.filter((r) => r.mass === null).map((r) => r.id),
  };
}

/* ---------------- interference ---------------- */

export interface Interference {
  a: string;
  b: string;
  /** Overlap of the two bounding boxes, mm³. */
  overlap: number;
  /** Exact for two boxes; a conservative bounding-box result otherwise. */
  exact: boolean;
}

/** Pairs of components that occupy the same space. Touching faces (zero overlap) are allowed. */
export function interferences(components: Component[], allowance = 0.01): Interference[] {
  const out: Interference[] = [];
  const boxes = components.map((c) => ({ c, b: componentBounds(c) }));
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const A = boxes[i].b, B = boxes[j].b;
    const dx = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x);
    const dy = Math.min(A.max.y, B.max.y) - Math.max(A.min.y, B.min.y);
    const dz = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z);
    if (dx > allowance && dy > allowance && dz > allowance) {
      out.push({ a: boxes[i].c.id, b: boxes[j].c.id, overlap: Math.round(dx * dy * dz), exact: boxes[i].c.shape === "box" && boxes[j].c.shape === "box" });
    }
  }
  return out;
}

/** Tolerance stack along one axis for components listed in order (worst case and RSS, mm). */
export function toleranceStack(components: Component[]): { nominal: number; worstCase: number; rss: number } {
  const nominal = components.reduce((s, c) => s + c.size.height, 0);
  const tols = components.map((c) => c.tolerance ?? 0);
  return { nominal, worstCase: tols.reduce((s, t) => s + t, 0), rss: Math.round(Math.sqrt(tols.reduce((s, t) => s + t * t, 0)) * 1000) / 1000 };
}

/* ---------------- how different two directions are ---------------- */

const tokens = (d: DesignDirection) => new Set([
  ...d.architecture.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  ...d.components.map((c) => `${c.shape}:${c.material.toLowerCase()}`),
  ...d.components.map((c) => c.name.toLowerCase().replace(/\s+/g, " ")),
]);

/** 0 = nothing shared, 1 = identical (architecture words, materials and parts). */
export function similarity(a: DesignDirection, b: DesignDirection): number {
  const A = tokens(a), B = tokens(b);
  const shared = [...A].filter((x) => B.has(x)).length;
  return shared / Math.max(1, new Set([...A, ...B]).size);
}

/**
 * Directions that are cosmetic variations of each other rather than
 * different architectures (same parts, same materials, same principle).
 */
export function cosmeticPairs(directions: DesignDirection[], threshold = 0.7): Array<{ a: string; b: string; similarity: number }> {
  const pairs: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < directions.length; i += 1) for (let j = i + 1; j < directions.length; j += 1) {
    const s = similarity(directions[i], directions[j]);
    if (s >= threshold) pairs.push({ a: directions[i].id, b: directions[j].id, similarity: Math.round(s * 100) / 100 });
  }
  return pairs;
}

/** Assembly order: explicit steps first, then bottom-up by position. */
export function assemblyOrder(components: Component[]): Component[] {
  return [...components].sort((a, b) => (a.step ?? 1e9) - (b.step ?? 1e9) || componentBounds(a).min.z - componentBounds(b).min.z || a.id.localeCompare(b.id));
}
