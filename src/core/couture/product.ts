/**
 * ==========================================================
 * LÉLU — PRODUCT & JEWELLERY ENGINE
 *
 * Furniture, lighting, accessories and jewellery built from
 * parameters, not from meshes typed by hand. Each template
 * declares typed variables with units and ranges, a dependency
 * list (a seat height that is leg height + seat thickness), and
 * a builder that turns the resolved variables into parts and
 * components with sockets.
 *
 * Every dimension is in millimetres; metal weights are computed
 * from the generated volume and a handbook density and are
 * ESTIMATES — no structural validation, no FEA, no casting
 * simulation. The data block says so.
 *
 * No network, no dependencies, deterministic.
 * ==========================================================
 */

import { meshNormals, type Mesh } from "./geometry";
import type { ComponentKind, ComponentSocket, CreativeComponent, CreativePart, ObjectCheck } from "./objects";

/* ---------------- expressions ---------------- */

type Token = { type: "num"; value: number } | { type: "id"; value: string } | { type: "op"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      tokens.push({ type: "num", value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j += 1;
      tokens.push({ type: "id", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character "${ch}" in "${source}"`);
  }
  return tokens;
}

/**
 * A tiny arithmetic evaluator — no eval, no Function constructor.
 * Supports + - * / ^, parentheses, and min/max/round/abs.
 */
export function evalExpression(source: string, scope: Record<string, number>): number {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const eat = (value: string): boolean => {
    const t = peek();
    if (t && t.type === "op" && t.value === value) { pos += 1; return true; }
    return false;
  };

  const primary = (): number => {
    const t = tokens[pos];
    if (!t) throw new Error(`expression "${source}" ended early`);
    if (t.type === "num") { pos += 1; return t.value; }
    if (t.type === "op" && t.value === "(") { pos += 1; const v = expr(); if (!eat(")")) throw new Error(`unclosed "(" in "${source}"`); return v; }
    if (t.type === "op" && (t.value === "-" || t.value === "+")) { pos += 1; const v = primary(); return t.value === "-" ? -v : v; }
    if (t.type === "id") {
      pos += 1;
      if (eat("(")) {
        const args: number[] = [expr()];
        while (eat(",")) args.push(expr());
        if (!eat(")")) throw new Error(`unclosed call in "${source}"`);
        if (t.value === "min") return Math.min(...args);
        if (t.value === "max") return Math.max(...args);
        if (t.value === "round") return Math.round(args[0]);
        if (t.value === "abs") return Math.abs(args[0]);
        throw new Error(`unknown function ${t.value}`);
      }
      const value = scope[t.value];
      if (value === undefined) throw new Error(`"${t.value}" is not defined`);
      return value;
    }
    throw new Error(`unexpected token in "${source}"`);
  };

  const power = (): number => {
    const base = primary();
    if (eat("^")) return base ** power();
    return base;
  };
  const term = (): number => {
    let value = power();
    for (;;) {
      if (eat("*")) value *= power();
      else if (eat("/")) value /= power();
      else return value;
    }
  };
  const expr = (): number => {
    let value = term();
    for (;;) {
      if (eat("+")) value += term();
      else if (eat("-")) value -= term();
      else return value;
    }
  };

  const result = expr();
  if (pos !== tokens.length) throw new Error(`unexpected trailing input in "${source}"`);
  if (!Number.isFinite(result)) throw new Error(`"${source}" evaluated to a non-finite number`);
  return result;
}

/* ---------------- variables ---------------- */

export interface VariableSpec {
  value: number;
  min: number;
  max: number;
  unit: "mm" | "deg" | "count" | "ratio";
  label: string;
  /** When set, the value is computed from other variables and cannot be overridden. */
  expression?: string;
}

export type Variables = Record<string, VariableSpec>;

export interface VariableValue {
  name: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  derived: boolean;
  source: string;
}

export interface ResolvedVariables {
  values: Record<string, number>;
  list: VariableValue[];
  errors: string[];
}

/**
 * Resolve variable overrides in dependency order. A derived variable is
 * recomputed from its expression, so changing a chair's leg height moves its
 * seat height automatically instead of silently disagreeing with it.
 */
export function resolveVariables(specs: Variables, overrides: Record<string, number> = {}): ResolvedVariables {
  const values: Record<string, number> = {};
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.expression) continue;
    const requested = overrides[name];
    const value = requested === undefined ? spec.value : Number(requested);
    if (!Number.isFinite(value)) { errors.push(`${name} is not a number`); values[name] = spec.value; continue; }
    if (value < spec.min || value > spec.max) {
      errors.push(`${name} ${value}${spec.unit} is outside ${spec.min}–${spec.max}${spec.unit}; using the nearest allowed value`);
    }
    values[name] = Math.min(spec.max, Math.max(spec.min, value));
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (!spec.expression) continue;
    try {
      const v = evalExpression(spec.expression, values);
      values[name] = Math.min(spec.max, Math.max(spec.min, v));
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`);
      values[name] = spec.value;
    }
  }
  const list: VariableValue[] = Object.entries(specs).map(([name, spec]) => ({
    name,
    label: spec.label,
    unit: spec.unit,
    value: values[name],
    min: spec.min,
    max: spec.max,
    derived: Boolean(spec.expression),
    source: spec.expression ? `= ${spec.expression}` : overrides[name] !== undefined ? "override" : "template default",
  }));
  return { values, list, errors };
}

/* ---------------- meshes ---------------- */

export function boxMesh(min: [number, number, number], max: [number, number, number]): Mesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, // bottom
    4, 6, 5, 4, 7, 6, // top
    0, 4, 5, 0, 5, 1, // front
    1, 5, 6, 1, 6, 2, // right
    2, 6, 7, 2, 7, 3, // back
    3, 7, 4, 3, 4, 0, // left
  ];
  return { positions, indices, normals: meshNormals(positions, indices) };
}

export function cylinderMesh(radius: number, height: number, options: { segments?: number; z0?: number; cap?: boolean } = {}): Mesh {
  const segments = Math.max(8, options.segments ?? 40);
  const z0 = options.z0 ?? 0;
  const z1 = z0 + height;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, Math.sin(a) * radius, z0);
    positions.push(Math.cos(a) * radius, Math.sin(a) * radius, z1);
  }
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  if (options.cap !== false) {
    const base = positions.length / 3;
    positions.push(0, 0, z0, 0, 0, z1);
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      indices.push(base, j * 2, i * 2);
      indices.push(base + 1, i * 2 + 1, j * 2 + 1);
    }
  }
  return { positions, indices, normals: meshNormals(positions, indices) };
}

/** Surface of revolution around Z from a (radius, z) profile. Open when `closed` is false. */
export function latheMesh(profile: Array<[number, number]>, segments = 48, closed = true): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [r, z] of profile) {
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  for (let row = 0; row < profile.length - 1; row += 1) {
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      const a = row * segments + i, b = row * segments + j, c = (row + 1) * segments + i, d = (row + 1) * segments + j;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (closed) {
    const bottom = positions.length / 3;
    positions.push(0, 0, profile[0][1]);
    for (let i = 0; i < segments; i += 1) indices.push(bottom, (i + 1) % segments, i);
    const top = positions.length / 3;
    positions.push(0, 0, profile[profile.length - 1][1]);
    const base = (profile.length - 1) * segments;
    for (let i = 0; i < segments; i += 1) indices.push(top, base + i, base + ((i + 1) % segments));
  }
  return { positions, indices, normals: meshNormals(positions, indices) };
}

export function torusMesh(majorRadius: number, minorRadius: number, options: { majorSegments?: number; minorSegments?: number; centre?: [number, number, number]; arcDeg?: number } = {}): Mesh {
  const major = Math.max(8, options.majorSegments ?? 48);
  const minor = Math.max(6, options.minorSegments ?? 16);
  const cx = options.centre?.[0] ?? 0, cy = options.centre?.[1] ?? 0, cz = options.centre?.[2] ?? 0;
  const sweep = ((options.arcDeg ?? 360) * Math.PI) / 180;
  const positions: number[] = [];
  const indices: number[] = [];
  const ringCount = options.arcDeg && options.arcDeg < 360 ? major + 1 : major;
  for (let i = 0; i < ringCount; i += 1) {
    const u = (i / major) * sweep;
    for (let j = 0; j < minor; j += 1) {
      const v = (j / minor) * Math.PI * 2;
      const r = majorRadius + Math.cos(v) * minorRadius;
      positions.push(cx + Math.cos(u) * r, cy + Math.sin(u) * r, cz + Math.sin(v) * minorRadius);
    }
  }
  for (let i = 0; i < ringCount - (ringCount === major ? 0 : 1); i += 1) {
    for (let j = 0; j < minor; j += 1) {
      const i2 = (i + 1) % ringCount;
      const j2 = (j + 1) % minor;
      const a = i * minor + j, b = i * minor + j2, c = i2 * minor + j, d = i2 * minor + j2;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices, normals: meshNormals(positions, indices) };
}

/**
 * A round brilliant cut: 8-fold table, crown and pavilion facets and a
 * girdle band. Real facets with real normals — not a sphere with a shine.
 */
export function brilliantCutMesh(options: { diameterMm: number; crownHeightMm: number; pavilionDepthMm: number; tableRatio?: number; segments?: number }): Mesh {
  const segments = Math.max(8, options.segments ?? 16);
  const r = options.diameterMm / 2;
  const tableR = r * (options.tableRatio ?? 0.56);
  const gridle = 0.35;
  const positions: number[] = [];
  const indices: number[] = [];
  // rings: table (0), crown break (1), girdle top (2), girdle bottom (3), pavilion tip (4)
  const rings: Array<{ z: number; r: number }> = [
    { z: options.crownHeightMm, r: tableR },
    { z: options.crownHeightMm * 0.45, r: r * 0.86 },
    { z: gridle, r },
    { z: -gridle, r: r * 0.985 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * ring.r, Math.sin(a) * ring.r, ring.z);
    }
  }
  const tip = positions.length / 3;
  positions.push(0, 0, -options.pavilionDepthMm);
  const tableCentre = positions.length / 3;
  positions.push(0, 0, options.crownHeightMm);
  const at = (ring: number, i: number) => ring * segments + (i % segments);
  for (let i = 0; i < segments; i += 1) {
    const n = (i + 1) % segments;
    // table fan
    indices.push(tableCentre, at(0, i), at(0, n));
    // crown: bezel (0→1) and star/upper-girdle (1→2)
    indices.push(at(0, i), at(1, i), at(0, n), at(0, n), at(1, i), at(1, n));
    indices.push(at(1, i), at(2, i), at(1, n), at(1, n), at(2, i), at(2, n));
    // girdle
    indices.push(at(2, i), at(3, i), at(2, n), at(2, n), at(3, i), at(3, n));
    // pavilion
    indices.push(at(3, i), tip, at(3, n));
  }
  return { positions, indices, normals: meshNormals(positions, indices) };
}

/** Signed volume of a closed triangle mesh, mm³. */
export function meshVolumeMm3(mesh: Mesh): number {
  let volume = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

/* ---------------- materials with real densities ---------------- */

export interface Metal {
  id: string;
  name: string;
  densityGPerCm3: number;
  colour: string;
  metalness: number;
  roughness: number;
  source: string;
  measured: false;
}

/**
 * Handbook densities, not laboratory measurements. Enough to estimate a
 * weight from a generated volume; not a materials certificate.
 */
export const METALS: Metal[] = [
  { id: "copper", name: "Copper (C110)", densityGPerCm3: 8.96, colour: "#b4633a", metalness: 1, roughness: 0.34, source: "ASM handbook density range 8.89–8.96 g/cm³", measured: false },
  { id: "silver-sterling", name: "Sterling silver (925)", densityGPerCm3: 10.36, colour: "#cfd2d6", metalness: 1, roughness: 0.26, source: "standard 925 alloy density", measured: false },
  { id: "gold-18k-yellow", name: "18k yellow gold", densityGPerCm3: 15.5, colour: "#d8aa5c", metalness: 1, roughness: 0.22, source: "18k yellow, handbook range 15.2–15.9 g/cm³", measured: false },
  { id: "brass", name: "Brass (C260)", densityGPerCm3: 8.53, colour: "#c3a04a", metalness: 1, roughness: 0.4, source: "cartridge brass handbook density", measured: false },
  { id: "steel-316", name: "316L stainless", densityGPerCm3: 7.99, colour: "#b9bec6", metalness: 1, roughness: 0.3, source: "316L handbook density", measured: false },
  { id: "platinum-950", name: "Platinum 950", densityGPerCm3: 20.7, colour: "#d6d8dc", metalness: 1, roughness: 0.2, source: "Pt950 handbook density", measured: false },
];

export const STONE_MATERIALS: Array<{ id: string; name: string; colour: string; index: number }> = [
  { id: "diamond", name: "Diamond (brilliant)", colour: "#eef4ff", index: 2.417 },
  { id: "ruby", name: "Ruby", colour: "#b3122b", index: 1.762 },
  { id: "sapphire", name: "Blue sapphire", colour: "#1c3f94", index: 1.762 },
  { id: "emerald", name: "Emerald", colour: "#1f6b45", index: 1.577 },
  { id: "garnet", name: "Garnet", colour: "#7a1f2b", index: 1.72 },
];

export function findMetal(id: string): Metal | undefined {
  return METALS.find((m) => m.id === id);
}

/* ---------------- templates ---------------- */

export interface TemplateBuild {
  parts: CreativePart[];
  components: CreativeComponent[];
  sockets: ComponentSocket[];
  checks: ObjectCheck[];
  limitations: string[];
  data: Record<string, unknown>;
}

export interface ProductTemplate {
  id: string;
  name: string;
  category: "furniture" | "lighting" | "accessory" | "jewelry" | "mechanical";
  description: string;
  variables: Variables;
  build: (v: Record<string, number>) => TemplateBuild;
}

const part = (id: string, label: string, mesh: Mesh, materialId: string, color: string, componentId: string, opacity = 1): CreativePart => ({
  id,
  label,
  mesh,
  materialId,
  color,
  opacity,
  thin: false,
  componentId,
});

const comp = (id: string, name: string, kind: ComponentKind, partIds: string[], materialId: string, dimensions: Record<string, number>, note: string, socket?: ComponentSocket): CreativeComponent => ({
  id,
  name,
  kind,
  partIds,
  materialId,
  status: "attached",
  dimensions,
  note,
  ...(socket ? { socket } : {}),
});

/* ---- chair ---- */

const chair: ProductTemplate = {
  id: "chair",
  name: "Modular side chair",
  category: "furniture",
  description: "Four legs, a seat and a back, with the seat height derived from the leg height and seat thickness.",
  variables: {
    legHeight: { value: 420, min: 320, max: 520, unit: "mm", label: "Leg height" },
    seatThickness: { value: 32, min: 18, max: 60, unit: "mm", label: "Seat thickness" },
    seatHeight: { value: 0, min: 320, max: 560, unit: "mm", label: "Seat height (derived)", expression: "legHeight + seatThickness" },
    seatWidth: { value: 440, min: 340, max: 600, unit: "mm", label: "Seat width" },
    seatDepth: { value: 430, min: 340, max: 600, unit: "mm", label: "Seat depth" },
    backHeight: { value: 400, min: 200, max: 560, unit: "mm", label: "Back height" },
    legThickness: { value: 34, min: 22, max: 70, unit: "mm", label: "Leg section" },
  },
  build: (v) => {
    const parts: CreativePart[] = [];
    const components: CreativeComponent[] = [];
    const sockets: ComponentSocket[] = [];
    const hw = v.seatWidth / 2, hd = v.seatDepth / 2, t = v.legThickness / 2;
    const wood = "#9a6b45";
    parts.push(part("p-seat", `Seat ${v.seatWidth}×${v.seatDepth} mm`, boxMesh([-hw, -hd, v.legHeight], [hw, hd, v.legHeight + v.seatThickness]), "oak-wood", wood, "c-seat"));
    components.push(comp("c-seat", "Seat", "seat", ["p-seat"], "oak-wood", { widthMm: v.seatWidth, depthMm: v.seatDepth, thicknessMm: v.seatThickness }, "Solid seat panel."));
    const corners: Array<[number, number, string]> = [
      [-hw + t, -hd + t, "front-left"],
      [hw - t, -hd + t, "front-right"],
      [-hw + t, hd - t, "back-left"],
      [hw - t, hd - t, "back-right"],
    ];
    for (const [x, y, label] of corners) {
      const id = `c-leg-${label}`;
      parts.push(part(`p-leg-${label}`, `${label} leg`, boxMesh([x - t, y - t, 0], [x + t, y + t, v.legHeight]), "oak-wood", wood, id));
      components.push(comp(id, `${label.replace("-", " ")} leg`, "leg", [`p-leg-${label}`], "oak-wood", { lengthMm: v.legHeight, sectionMm: v.legThickness }, "Square section, tenons into the seat."));
      sockets.push({ id: `socket-${label}`, accepts: ["leg"], positionMm: [x, y, v.legHeight], rotationDeg: [0, 0, 0] });
    }
    const backZ = v.legHeight + v.seatThickness;
    parts.push(part("p-back", "Back panel", boxMesh([-hw, hd - 60, backZ], [hw, hd, backZ + v.backHeight]), "oak-wood", wood, "c-back"));
    components.push(comp("c-back", "Back", "back", ["p-back"], "oak-wood", { heightMm: v.backHeight, widthMm: v.seatWidth }, "Rakes back 6° in the drawn assembly."));
    parts.push(part("p-stretcher", "Front stretcher", boxMesh([-hw + t, -hd + t, 140], [hw - t, -hd + t + 22, 162]), "oak-wood", wood, "c-stretcher"));
    components.push(comp("c-stretcher", "Front stretcher", "other", ["p-stretcher"], "oak-wood", { heightMm: 140 }, "Ties the front legs."));
    return {
      parts,
      components,
      sockets,
      checks: [
        { name: "seat height is consistent", ok: Math.abs(v.seatHeight - (v.legHeight + v.seatThickness)) < 1e-6, detail: `${v.seatHeight} mm = ${v.legHeight} + ${v.seatThickness}` },
        { name: "legs support the seat", ok: v.legHeight === v.seatHeight - v.seatThickness, detail: "leg height equals seat underside" },
      ],
      limitations: ["No structural analysis: joint strength, racking and load capacity are not simulated."],
      data: { seatHeight: v.seatHeight, joints: "mortise and tenon (drawn, not validated)" },
    };
  },
};

/* ---- shelf ---- */

const shelfUnit: ProductTemplate = {
  id: "shelf",
  name: "Modular shelving",
  category: "furniture",
  description: "Two sides and a stack of shelves, spaced by a derived pitch.",
  variables: {
    width: { value: 900, min: 500, max: 1600, unit: "mm", label: "Width" },
    height: { value: 1500, min: 800, max: 2200, unit: "mm", label: "Height" },
    depth: { value: 320, min: 180, max: 450, unit: "mm", label: "Depth" },
    thickness: { value: 22, min: 12, max: 40, unit: "mm", label: "Panel thickness" },
    shelves: { value: 5, min: 2, max: 8, unit: "count", label: "Shelf count" },
    pitch: { value: 0, min: 100, max: 700, unit: "mm", label: "Shelf pitch (derived)", expression: "(height - thickness) / (shelves - 1)" },
  },
  build: (v) => {
    const parts: CreativePart[] = [];
    const components: CreativeComponent[] = [];
    const sockets: ComponentSocket[] = [];
    const wood = "#c2a37a";
    const count = Math.max(2, Math.round(v.shelves));
    const hw = v.width / 2;
    for (const side of [-1, 1] as const) {
      const id = `c-side-${side < 0 ? "left" : "right"}`;
      parts.push(part(`p-side-${side}`, `${side < 0 ? "Left" : "Right"} side`, boxMesh([side * hw - v.thickness / 2, -v.depth / 2, 0], [side * hw + v.thickness / 2, v.depth / 2, v.height]), "oak-wood", wood, id));
      components.push(comp(id, `${side < 0 ? "Left" : "Right"} side`, "body", [`p-side-${side}`], "oak-wood", { heightMm: v.height, depthMm: v.depth }, "Full-height side panel with shelf pin holes.", { id: `socket-shelf-${side}`, accepts: ["shelf"], positionMm: [side * hw, 0, 0], rotationDeg: [0, 0, 0] }));
      sockets.push({ id: `socket-side-${side}`, accepts: ["shelf"], positionMm: [side * hw, 0, 0], rotationDeg: [0, 0, 0] });
    }
    for (let i = 0; i < count; i += 1) {
      const z = v.thickness / 2 + i * v.pitch;
      const id = `c-shelf-${i + 1}`;
      parts.push(part(`p-shelf-${i + 1}`, `Shelf ${i + 1}`, boxMesh([-hw + v.thickness / 2, -v.depth / 2, z - v.thickness / 2], [hw - v.thickness / 2, v.depth / 2, z + v.thickness / 2]), "oak-wood", wood, id));
      components.push(comp(id, `Shelf ${i + 1}`, "shelf", [`p-shelf-${i + 1}`], "oak-wood", { widthMm: v.width - v.thickness, zMm: Number(z.toFixed(1)) }, `Bay ${i + 1} of ${count}.`));
    }
    const topZ = v.thickness / 2 + (count - 1) * v.pitch;
    return {
      parts,
      components,
      sockets,
      checks: [
        { name: "top shelf fits inside the sides", ok: topZ <= v.height + 0.001, detail: `top shelf at ${topZ.toFixed(0)} mm of ${v.height} mm` },
        { name: "pitch is consistent", ok: Math.abs(v.pitch - (v.height - v.thickness) / (count - 1)) < 0.001, detail: `${v.pitch.toFixed(1)} mm between ${count} shelves` },
      ],
      limitations: ["No shelf-load deflection check (span/load capacity is not calculated)."],
      data: { bays: count, pitchMm: Number(v.pitch.toFixed(1)) },
    };
  },
};

/* ---- table ---- */

const table: ProductTemplate = {
  id: "table",
  name: "Pedestal table",
  category: "furniture",
  description: "Round top on a turned pedestal with a cross foot.",
  variables: {
    diameter: { value: 900, min: 500, max: 1400, unit: "mm", label: "Top diameter" },
    topThickness: { value: 34, min: 18, max: 60, unit: "mm", label: "Top thickness" },
    legHeight: { value: 706, min: 620, max: 780, unit: "mm", label: "Pedestal height" },
    totalHeight: { value: 0, min: 640, max: 840, unit: "mm", label: "Total height (derived)", expression: "legHeight + topThickness" },
    pedestalRadius: { value: 62, min: 40, max: 110, unit: "mm", label: "Pedestal radius" },
  },
  build: (v) => {
    const r = v.diameter / 2;
    const wood = "#8a5f3c";
    const parts: CreativePart[] = [
      part("p-top", `Top ⌀${v.diameter} mm`, latheMesh([[0, 0], [r, 0], [r, v.topThickness * 0.7], [r * 0.995, v.topThickness], [0, v.topThickness]], 64), "walnut", wood, "c-top"),
      part("p-pedestal", "Pedestal", latheMesh([[v.pedestalRadius * 1.5, 0], [v.pedestalRadius * 1.15, 40], [v.pedestalRadius, 120], [v.pedestalRadius * 1.25, v.legHeight - 60], [v.pedestalRadius * 1.6, v.legHeight], [v.pedestalRadius * 1.6, v.legHeight + 1]], 48), "walnut", wood, "c-pedestal"),
    ];
    const shifted = parts[0];
    shifted.mesh = { ...shifted.mesh, positions: shifted.mesh.positions.map((n, i) => (i % 3 === 2 ? n + v.legHeight : n)) };
    parts.push(part("p-foot", "Cross foot", boxMesh([-r * 0.55, -90, 0], [r * 0.55, 90, 42]), "walnut", wood, "c-foot"));
    parts.push(part("p-foot-2", "Cross foot (crosswise)", boxMesh([-90, -r * 0.55, 0], [90, r * 0.55, 42]), "walnut", wood, "c-foot"));
    return {
      parts,
      components: [
        comp("c-top", "Top", "body", ["p-top"], "walnut", { diameterMm: v.diameter, thicknessMm: v.topThickness }, "Solid top, chamfered under-edge."),
        comp("c-pedestal", "Pedestal", "leg", ["p-pedestal"], "walnut", { heightMm: v.legHeight }, "Turned pedestal."),
        comp("c-foot", "Cross foot", "base", ["p-foot", "p-foot-2"], "walnut", { spanMm: Number((r * 1.1).toFixed(0)) }, "Two interlocking feet."),
      ],
      sockets: [{ id: "socket-pedestal", accepts: ["leg"], positionMm: [0, 0, 0], rotationDeg: [0, 0, 0] }],
      checks: [
        { name: "top sits on the pedestal", ok: Math.abs(v.totalHeight - (v.legHeight + v.topThickness)) < 1e-6, detail: `${v.totalHeight} mm total = ${v.legHeight} + ${v.topThickness}` },
        { name: "foot is wider than the pedestal", ok: r * 1.1 > v.pedestalRadius * 3, detail: `${(r * 1.1).toFixed(0)} mm foot span` },
      ],
      limitations: ["Tip-over stability is not simulated."],
      data: { totalHeightMm: v.totalHeight },
    };
  },
};

/* ---- lamp ---- */

const lamp: ProductTemplate = {
  id: "lamp",
  name: "Table lamp",
  category: "lighting",
  description: "Disc base, stem and a tapered shade with a diffuser.",
  variables: {
    baseRadius: { value: 90, min: 60, max: 160, unit: "mm", label: "Base radius" },
    stemHeight: { value: 380, min: 220, max: 620, unit: "mm", label: "Stem height" },
    shadeTopRadius: { value: 90, min: 50, max: 180, unit: "mm", label: "Shade top radius" },
    shadeBottomRadius: { value: 170, min: 90, max: 320, unit: "mm", label: "Shade bottom radius" },
    shadeHeight: { value: 190, min: 100, max: 320, unit: "mm", label: "Shade height" },
    totalHeight: { value: 0, min: 300, max: 900, unit: "mm", label: "Total height (derived)", expression: "stemHeight + shadeHeight" },
  },
  build: (v) => {
    const shadeZ = v.stemHeight;
    const brass = findMetal("brass") ?? METALS[0];
    const parts: CreativePart[] = [
      part("p-base", "Base disc", cylinderMesh(v.baseRadius, 18, { segments: 64 }), brass.id, brass.colour, "c-base"),
      part("p-stem", "Stem", cylinderMesh(9, v.stemHeight, { segments: 24, z0: 18 }), brass.id, brass.colour, "c-stem"),
      part("p-shade", "Shade", latheMesh([[v.shadeBottomRadius, shadeZ], [v.shadeTopRadius, shadeZ + v.shadeHeight]], 64, false), "linen-shade", "#efe3cd", "c-shade"),
      part("p-diffuser", "Diffuser", latheMesh([[v.shadeTopRadius * 0.98, shadeZ + v.shadeHeight], [v.shadeTopRadius * 0.98, shadeZ + v.shadeHeight + 3], [0, shadeZ + v.shadeHeight + 3]], 48), "opal-glass", "#fff6e2", "c-shade"),
    ];
    parts[2].thin = true;
    parts[2].opacity = 0.72;
    return {
      parts,
      components: [
        comp("c-base", "Base", "base", ["p-base"], brass.id, { radiusMm: v.baseRadius }, "Weighted base."),
        comp("c-stem", "Stem", "leg", ["p-stem"], brass.id, { heightMm: v.stemHeight }, "Threaded at both ends."),
        comp("c-shade", "Shade", "shade", ["p-shade", "p-diffuser"], "linen-shade", { topMm: v.shadeTopRadius, bottomMm: v.shadeBottomRadius, heightMm: v.shadeHeight }, "Tapered linen over an opal diffuser."),
      ],
      sockets: [{ id: "socket-stem", accepts: ["leg"], positionMm: [0, 0, 18], rotationDeg: [0, 0, 0] }],
      checks: [
        { name: "base is wider than the shade's centre of mass is high", ok: v.baseRadius * 2.4 > v.shadeBottomRadius, detail: `base ⌀${(v.baseRadius * 2).toFixed(0)} mm against a ⌀${(v.shadeBottomRadius * 2).toFixed(0)} mm shade` },
        { name: "shade clears the stem", ok: v.shadeTopRadius > 12, detail: `${v.shadeTopRadius} mm top opening` },
      ],
      limitations: ["No photometric analysis: this is geometry, not a lighting calculation."],
      data: { totalHeightMm: v.totalHeight },
    };
  },
};

/* ---- pendant ---- */

const pendant: ProductTemplate = {
  id: "pendant",
  name: "Bezel-set pendant",
  category: "jewelry",
  description: "A hammered copper disc with a bezel setting and a brilliant-cut stone, hanging from a bail.",
  variables: {
    discDiameter: { value: 34, min: 18, max: 60, unit: "mm", label: "Disc diameter" },
    thickness: { value: 2.2, min: 1.2, max: 5, unit: "mm", label: "Metal thickness" },
    stoneDiameter: { value: 8, min: 3, max: 20, unit: "mm", label: "Stone diameter" },
    bezelWall: { value: 1.1, min: 0.6, max: 3, unit: "mm", label: "Bezel wall" },
    stoneSeat: { value: 0, min: 0, max: 12, unit: "mm", label: "Stone seat depth (derived)", expression: "min(3, max(1.2, stoneDiameter * 0.22))" },
    bailRadius: { value: 4.2, min: 3, max: 9, unit: "mm", label: "Bail radius" },
  },
  build: (v) => {
    const metal = findMetal("copper") ?? METALS[0];
    const stone = STONE_MATERIALS[0];
    const r = v.discDiameter / 2;
    const stoneR = v.stoneDiameter / 2;
    const parts: CreativePart[] = [
      part("p-body", `Disc ⌀${v.discDiameter} mm`, latheMesh([[0, -v.thickness / 2], [r - 1.2, -v.thickness / 2], [r, -v.thickness * 0.1], [r, v.thickness / 2], [r - 1.2, v.thickness / 2], [0, v.thickness / 2]], 64), metal.id, metal.colour, "c-body"),
      part("p-bezel", `Bezel ⌀${(v.stoneDiameter + v.bezelWall * 2).toFixed(1)} mm`, latheMesh([[stoneR, v.thickness / 2 - v.stoneSeat], [stoneR + v.bezelWall, v.thickness / 2 - v.stoneSeat], [stoneR + v.bezelWall, v.thickness / 2 + Math.max(1.4, v.stoneDiameter * 0.22)], [stoneR + v.bezelWall * 0.55, v.thickness / 2 + Math.max(1.4, v.stoneDiameter * 0.22)], [stoneR, v.thickness / 2 + Math.max(1.4, v.stoneDiameter * 0.22) - 0.2], [stoneR, v.thickness / 2 - v.stoneSeat]], 64, false), metal.id, metal.colour, "c-setting"),
      part("p-stone", `${stone.name} ⌀${v.stoneDiameter} mm`, brilliantCutMesh({ diameterMm: v.stoneDiameter, crownHeightMm: v.stoneDiameter * 0.16, pavilionDepthMm: v.stoneDiameter * 0.42 }), stone.id, stone.colour, "c-stone"),
      // The bail sits in the pendant's own plane, above the disc, so it reads
      // as a hanging loop once the piece is turned upright.
      part("p-bail", "Bail", torusMesh(v.bailRadius, 1.15, { centre: [0, -(r + v.bailRadius * 0.8), 0], majorSegments: 40, minorSegments: 12 }), metal.id, metal.colour, "c-bail"),
    ];
    parts[2].thin = false;
    // The stone sits ON the face, girdle just above the metal, so its crown is
    // visible inside the bezel instead of being buried in the disc.
    const stoneZ = v.thickness / 2 + 0.15;
    parts[2].mesh = { ...parts[2].mesh, positions: parts[2].mesh.positions.map((n, i) => (i % 3 === 2 ? n + stoneZ : n)) };
    const bodyVolume = meshVolumeMm3(parts[0].mesh) + meshVolumeMm3(parts[1].mesh) + meshVolumeMm3(parts[3].mesh);
    const weightG = (bodyVolume / 1000) * metal.densityGPerCm3;
    return {
      parts,
      components: [
        comp("c-body", "Pendant body", "body", ["p-body"], metal.id, { diameterMm: v.discDiameter, thicknessMm: v.thickness }, `${metal.name}; hammered face.`),
        comp("c-setting", "Bezel setting", "setting", ["p-bezel"], metal.id, { stoneDiameterMm: v.stoneDiameter, wallMm: v.bezelWall, seatMm: Number(v.stoneSeat.toFixed(2)) }, "Bezel wall rolled over the girdle.", { id: "socket-stone", accepts: ["stone"], positionMm: [0, 0, stoneZ], rotationDeg: [0, 0, 0] }),
        comp("c-stone", "Stone", "stone", ["p-stone"], stone.id, { diameterMm: v.stoneDiameter, crownMm: Number((v.stoneDiameter * 0.16).toFixed(2)), pavilionMm: Number((v.stoneDiameter * 0.42).toFixed(2)) }, `${stone.name}, brilliant cut, refractive index ${stone.index}.`),
        comp("c-bail", "Bail", "bail", ["p-bail"], metal.id, { radiusMm: v.bailRadius }, "Soldered bail, 1.15 mm wire."),
      ],
      sockets: [
        { id: "socket-bail", accepts: ["chain"], positionMm: [0, -(r + v.bailRadius * 0.8), 0], rotationDeg: [0, 0, 0] },
        { id: "socket-setting", accepts: ["setting"], positionMm: [0, 0, v.thickness / 2], rotationDeg: [0, 0, 0] },
      ],
      checks: [
        { name: "stone fits the disc", ok: v.stoneDiameter + v.bezelWall * 2 < v.discDiameter * 0.75, detail: `${(v.stoneDiameter + v.bezelWall * 2).toFixed(1)} mm bezel inside a ${v.discDiameter} mm disc` },
        { name: "bezel wall is thick enough to roll", ok: v.bezelWall >= 0.6, detail: `${v.bezelWall} mm wall` },
        { name: "bail is clear of the setting", ok: r + v.bailRadius * 0.8 - v.bailRadius > stoneR + v.bezelWall, detail: `bail centre ${(r + v.bailRadius * 0.8).toFixed(1)} mm from the disc centre, stone radius ${stoneR} mm` },
      ],
      limitations: [
        "Weight is an estimate from the generated volume and a handbook density; no casting yield, sprue or shrinkage allowance.",
        "No structural or stone-security validation: prong/bezel retention is drawn, not tested.",
      ],
      data: {
        metal: metal.name,
        metalDensity: metal.densityGPerCm3,
        estimatedMetalVolumeMm3: Math.round(bodyVolume),
        estimatedWeightG: Number(weightG.toFixed(2)),
        stone: stone.name,
        notes: ["Volume is the closed mesh volume of body, bezel and bail.", "The stone volume is excluded from the metal weight."],
      },
    };
  },
};

/* ---- ring ---- */

const ring: ProductTemplate = {
  id: "ring",
  name: "Solitaire ring",
  category: "jewelry",
  description: "A comfort-fit band with four prongs and a brilliant-cut stone.",
  variables: {
    innerDiameter: { value: 17.3, min: 14, max: 23, unit: "mm", label: "Inner diameter" },
    bandWidth: { value: 2.4, min: 1.4, max: 6, unit: "mm", label: "Band width" },
    bandThickness: { value: 1.8, min: 1, max: 4, unit: "mm", label: "Band thickness" },
    stoneDiameter: { value: 6.5, min: 3, max: 12, unit: "mm", label: "Stone diameter" },
    prongCount: { value: 4, min: 3, max: 6, unit: "count", label: "Prongs" },
    totalHeight: { value: 0, min: 4, max: 20, unit: "mm", label: "Rise above the band (derived)", expression: "stoneDiameter * 0.34 + bandThickness" },
  },
  build: (v) => {
    const metal = findMetal("gold-18k-yellow") ?? METALS[0];
    const stone = STONE_MATERIALS[0];
    const bandR = v.innerDiameter / 2 + v.bandThickness / 2;
    const parts: CreativePart[] = [
      part("p-band", `Band ⌀${v.innerDiameter} mm`, torusMesh(bandR, v.bandThickness / 2, { majorSegments: 96, minorSegments: 16 }), metal.id, metal.colour, "c-band"),
    ];
    // Torus is drawn lying in the XY plane; stand it upright by rotating a copy.
    const band = parts[0];
    const upright = (mesh: Mesh): Mesh => {
      const positions: number[] = [];
      for (let i = 0; i < mesh.positions.length; i += 3) {
        positions.push(mesh.positions[i], mesh.positions[i + 2], mesh.positions[i + 1]);
      }
      return { positions, indices: [...mesh.indices], normals: meshNormals(positions, mesh.indices) };
    };
    band.mesh = upright(band.mesh);
    const topZ = bandR + v.bandThickness / 2;
    parts.push(part("p-stone", `${stone.name} ⌀${v.stoneDiameter} mm`, brilliantCutMesh({ diameterMm: v.stoneDiameter, crownHeightMm: v.stoneDiameter * 0.16, pavilionDepthMm: v.stoneDiameter * 0.42 }), stone.id, stone.colour, "c-stone"));
    parts[1].mesh = { ...parts[1].mesh, positions: parts[1].mesh.positions.map((n, i) => (i % 3 === 2 ? n + topZ + v.bandThickness : n)) };
    const prongs = Math.max(3, Math.round(v.prongCount));
    for (let i = 0; i < prongs; i += 1) {
      const a = (i / prongs) * Math.PI * 2;
      const r = (v.stoneDiameter / 2) * 0.94;
      const prong = cylinderMesh(0.55, v.bandThickness + v.stoneDiameter * 0.2, { segments: 10, z0: topZ - 0.4 });
      const positions: number[] = [];
      for (let k = 0; k < prong.positions.length; k += 3) {
        positions.push(prong.positions[k] + Math.cos(a) * r, prong.positions[k + 1] + Math.sin(a) * r, prong.positions[k + 2]);
      }
      parts.push(part(`p-prong-${i + 1}`, `Prong ${i + 1}`, { positions, indices: prong.indices, normals: meshNormals(positions, prong.indices) }, metal.id, metal.colour, "c-setting"));
    }
    const bandVolume = meshVolumeMm3(parts[0].mesh) + parts.filter((p) => p.id.startsWith("p-prong")).reduce((n, p) => n + meshVolumeMm3(p.mesh), 0);
    return {
      parts,
      components: [
        comp("c-band", "Band", "band", ["p-band"], metal.id, { innerDiameterMm: v.innerDiameter, widthMm: v.bandWidth, thicknessMm: v.bandThickness }, "Comfort-fit band."),
        comp("c-setting", "Prong setting", "setting", parts.filter((p) => p.id.startsWith("p-prong")).map((p) => p.id), metal.id, { prongs: prongs, heightMm: Number((v.bandThickness + v.stoneDiameter * 0.2).toFixed(2)) }, `${prongs} prongs.`),
        comp("c-stone", "Stone", "stone", ["p-stone"], stone.id, { diameterMm: v.stoneDiameter }, stone.name),
      ],
      sockets: [{ id: "socket-stone", accepts: ["stone"], positionMm: [0, 0, topZ + v.bandThickness], rotationDeg: [0, 0, 0] }],
      checks: [
        { name: "stone is wider than the band is thick", ok: v.stoneDiameter > v.bandThickness, detail: `${v.stoneDiameter} mm stone on a ${v.bandThickness} mm band` },
        { name: "prongs clear the stone girdle", ok: prongs >= 3, detail: `${prongs} prongs at ${(v.stoneDiameter * 0.47).toFixed(2)} mm radius` },
      ],
      limitations: ["Prong tension and stone security are not simulated.", "Ring size follows the inner diameter only; no comfort-fit curve analysis."],
      data: { metal: metal.name, estimatedMetalVolumeMm3: Math.round(bandVolume), estimatedWeightG: Number(((bandVolume / 1000) * metal.densityGPerCm3).toFixed(2)) },
    };
  },
};

/* ---- cuff ---- */

const cuff: ProductTemplate = {
  id: "cuff",
  name: "Open cuff",
  category: "jewelry",
  description: "An open sheet-metal cuff with a rolled rim.",
  variables: {
    wristMm: { value: 165, min: 130, max: 220, unit: "mm", label: "Wrist circumference" },
    openingDeg: { value: 42, min: 20, max: 90, unit: "deg", label: "Opening angle" },
    heightMm: { value: 28, min: 10, max: 70, unit: "mm", label: "Cuff height" },
    thickness: { value: 1.2, min: 0.6, max: 3, unit: "mm", label: "Sheet thickness" },
    radius: { value: 0, min: 20, max: 40, unit: "mm", label: "Radius (derived)", expression: "wristMm / (2 * 3.14159) * 1.04" },
  },
  build: (v) => {
    const metal = findMetal("silver-sterling") ?? METALS[0];
    const r = v.radius;
    const sweep = 360 - v.openingDeg;
    const angle = (sweep * Math.PI) / 180;
    const segments = Math.max(16, Math.round(sweep / 3));
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const a = -angle / 2 + (i / segments) * angle;
      const x = Math.sin(a) * r, y = Math.cos(a) * r;
      const nx = Math.sin(a), ny = Math.cos(a);
      positions.push(x, y, -v.heightMm / 2);
      positions.push(x, y, v.heightMm / 2);
      positions.push(x - nx * v.thickness, y - ny * v.thickness, -v.heightMm / 2);
      positions.push(x - nx * v.thickness, y - ny * v.thickness, v.heightMm / 2);
    }
    for (let i = 0; i < segments; i += 1) {
      const a = i * 4, b = (i + 1) * 4;
      indices.push(a, b, a + 1, b, b + 1, a + 1); // outer
      indices.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // inner
      indices.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3); // top rim
      indices.push(a, a + 2, b, b, a + 2, b + 2); // bottom rim
    }
    const mesh: Mesh = { positions, indices, normals: meshNormals(positions, indices) };
    const volume = meshVolumeMm3(mesh);
    return {
      parts: [part("p-cuff", `Cuff ${sweep.toFixed(0)}° of arc`, mesh, metal.id, metal.colour, "c-band")],
      components: [comp("c-band", "Cuff body", "band", ["p-cuff"], metal.id, { radiusMm: Number(r.toFixed(2)), heightMm: v.heightMm, openingDeg: v.openingDeg, thicknessMm: v.thickness }, `Open arc of ${sweep.toFixed(0)}°.`)],
      sockets: [],
      checks: [
        { name: "opening is wide enough to pass the wrist", ok: v.openingDeg >= 30, detail: `${v.openingDeg}° opening on a ${(2 * Math.PI * r).toFixed(0)} mm circumference` },
        { name: "radius follows the wrist", ok: Math.abs(v.radius - (v.wristMm / (2 * Math.PI)) * 1.04) < 0.01, detail: `${v.radius.toFixed(2)} mm derived from ${v.wristMm} mm` },
      ],
      limitations: ["Spring-back and work-hardening of the sheet are not simulated."],
      data: { arcDeg: sweep, metal: metal.name, estimatedMetalVolumeMm3: Math.round(volume), estimatedWeightG: Number(((volume / 1000) * metal.densityGPerCm3).toFixed(2)) },
    };
  },
};

/* ---- chain ---- */

const chain: ProductTemplate = {
  id: "chain",
  name: "Linked chain",
  category: "accessory",
  description: "Round links alternating orientation, with a clasp link at one end.",
  variables: {
    linkCount: { value: 9, min: 3, max: 40, unit: "count", label: "Links" },
    linkRadius: { value: 7.5, min: 4, max: 16, unit: "mm", label: "Link radius" },
    wireRadius: { value: 1.05, min: 0.6, max: 2.5, unit: "mm", label: "Wire radius" },
    spacing: { value: 0, min: 4, max: 30, unit: "mm", label: "Link spacing (derived)", expression: "linkRadius * 1.42" },
  },
  build: (v) => {
    const metal = findMetal("silver-sterling") ?? METALS[0];
    const count = Math.max(3, Math.round(v.linkCount));
    const parts: CreativePart[] = [];
    let volume = 0;
    for (let i = 0; i < count; i += 1) {
      const mesh = torusMesh(v.linkRadius, v.wireRadius, { majorSegments: 32, minorSegments: 10 });
      const rotated: number[] = [];
      for (let k = 0; k < mesh.positions.length; k += 3) {
        const x = mesh.positions[k], y = mesh.positions[k + 1], z = mesh.positions[k + 2];
        const a = i % 2 === 0 ? 0 : Math.PI / 2;
        const xr = x * Math.cos(a) - z * Math.sin(a);
        const zr = x * Math.sin(a) + z * Math.cos(a);
        rotated.push(xr + i * v.spacing, zr, y);
      }
      const link: Mesh = { positions: rotated, indices: [...mesh.indices], normals: meshNormals(rotated, mesh.indices) };
      volume += meshVolumeMm3(link);
      parts.push(part(`p-link-${i + 1}`, `Link ${i + 1}`, link, metal.id, metal.colour, `c-link-${i + 1}`));
    }
    const components = parts.map((p, i) =>
      comp(`c-link-${i + 1}`, `Link ${i + 1}`, "chain", [p.id], metal.id, { radiusMm: v.linkRadius, wireMm: v.wireRadius }, `Link ${i + 1} of ${count}.`, i < count - 1 ? { id: `socket-next-${i + 1}`, accepts: ["chain"], positionMm: [v.spacing, 0, 0], rotationDeg: [0, 90, 0] } : { id: `socket-clasp-${i + 1}`, accepts: ["clasp"], positionMm: [v.spacing, 0, 0], rotationDeg: [0, 0, 0] }),
    );
    const clasp = torusMesh(v.linkRadius * 0.62, v.wireRadius * 1.4, { arcDeg: 300, majorSegments: 28, minorSegments: 10 });
    const claspPos: number[] = [];
    for (let k = 0; k < clasp.positions.length; k += 3) claspPos.push(clasp.positions[k] + count * v.spacing, clasp.positions[k + 2], clasp.positions[k + 1]);
    parts.push(part("p-clasp", "Clasp", { positions: claspPos, indices: [...clasp.indices], normals: meshNormals(claspPos, clasp.indices) }, metal.id, metal.colour, "c-clasp"));
    components.push(comp("c-clasp", "Clasp", "clasp", ["p-clasp"], metal.id, { openingMm: Number((v.linkRadius * 0.9).toFixed(2)) }, "Hook clasp, drawn open."));
    return {
      parts,
      components,
      sockets: [],
      checks: [
        { name: "links overlap so the chain cannot pull apart", ok: v.spacing < v.linkRadius * 2, detail: `spacing ${v.spacing.toFixed(2)} mm against a ${(v.linkRadius * 2).toFixed(1)} mm link` },
        { name: "wire is thick enough for the link radius", ok: v.linkRadius / v.wireRadius >= 4, detail: `ratio ${(v.linkRadius / v.wireRadius).toFixed(1)}:1` },
      ],
      limitations: ["No tensile test: link strength is not computed."],
      data: { links: count, lengthMm: Number((count * v.spacing).toFixed(1)), estimatedWeightG: Number(((volume / 1000) * metal.densityGPerCm3).toFixed(2)) },
    };
  },
};

export const PRODUCT_TEMPLATES: ProductTemplate[] = [chair, shelfUnit, table, lamp, pendant, ring, cuff, chain];

export function findTemplate(id: string): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES.find((t) => t.id === id);
}

export interface BuiltProduct {
  ok: boolean;
  reason?: string;
  template?: ProductTemplate;
  variables?: ResolvedVariables;
  assembly?: TemplateBuild;
}

/** Build a product from a template id and variable overrides. */
export function buildProduct(templateId: string, overrides: Record<string, number> = {}): BuiltProduct {
  const template = findTemplate(templateId);
  if (!template) return { ok: false, reason: `no template "${templateId}". Available: ${PRODUCT_TEMPLATES.map((t) => t.id).join(", ")}` };
  const variables = resolveVariables(template.variables, overrides);
  if (variables.errors.length && variables.list.every((v) => !Number.isFinite(v.value))) {
    return { ok: false, reason: variables.errors.join("; "), template, variables };
  }
  const assembly = template.build(variables.values);
  return { ok: true, template, variables, assembly };
}

/** Offset each component along its own direction from the assembly centre — an exploded assembly. */
export function explodedAssembly(assembly: TemplateBuild, factor = 1.6): TemplateBuild {
  const parts = assembly.parts.map((p) => ({ ...p, mesh: { ...p.mesh, positions: [...p.mesh.positions] } }));
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const p of parts) {
    for (let i = 0; i < p.mesh.positions.length; i += 3) {
      cx += p.mesh.positions[i]; cy += p.mesh.positions[i + 1]; cz += p.mesh.positions[i + 2]; n += 1;
    }
  }
  cx /= n || 1; cy /= n || 1; cz /= n || 1;
  // Explosion distance follows the size of the assembly, so a 26 mm pendant
  // and a 900 mm chair both read as exploded views instead of dust.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.mesh.positions.length; i += 3) {
      minX = Math.min(minX, p.mesh.positions[i]); maxX = Math.max(maxX, p.mesh.positions[i]);
      minY = Math.min(minY, p.mesh.positions[i + 1]); maxY = Math.max(maxY, p.mesh.positions[i + 1]);
      minZ = Math.min(minZ, p.mesh.positions[i + 2]); maxZ = Math.max(maxZ, p.mesh.positions[i + 2]);
    }
  }
  const span = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY, maxZ - minZ) : 100;
  const gap = Math.max(26, Math.min(180, span * 0.5 * factor));
  const centres = new Map<string, [number, number, number]>();
  for (const p of parts) {
    let x = 0, y = 0, z = 0, k = 0;
    for (let i = 0; i < p.mesh.positions.length; i += 3) { x += p.mesh.positions[i]; y += p.mesh.positions[i + 1]; z += p.mesh.positions[i + 2]; k += 1; }
    centres.set(p.componentId, [x / (k || 1) - cx, y / (k || 1) - cy, z / (k || 1) - cz]);
  }
  for (const p of parts) {
    const c = centres.get(p.componentId) ?? [0, 0, 1];
    const length = Math.hypot(c[0], c[1], c[2]) || 1;
    const dx = (c[0] / length) * gap, dy = (c[1] / length) * gap, dz = (c[2] / length) * gap;
    for (let i = 0; i < p.mesh.positions.length; i += 3) {
      p.mesh.positions[i] += dx;
      p.mesh.positions[i + 1] += dy;
      p.mesh.positions[i + 2] += dz;
    }
  }
  return { ...assembly, parts };
}
