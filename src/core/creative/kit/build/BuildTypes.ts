/**
 * ==========================================================
 * LÉLU — THE BUILD ENGINE: shared construction primitives
 *
 * One program shape for every constructed artifact, whatever the
 * domain. A builder turns validated parameters into parts with
 * stable ids, layers, a step-by-step explanation and the same
 * Scene3D program every exporter already understands.
 *
 * The engine was the first instance of this; it stays as it is,
 * and these builders use the identical pattern so the viewer,
 * the exporter and the chat render them the same way.
 * ==========================================================
 */

import type { Scene3DProgram, SceneObject } from "../Scene3D";

/** A point or direction in world space (metres). */
export type Vec3 = [number, number, number];

export type BuildDomain = "mechanical" | "architecture" | "science" | "environment" | "art";

export const BUILD_DOMAINS: BuildDomain[] = ["mechanical", "architecture", "science", "environment", "art"];

export interface BuildPart {
  id: string;
  name: string;
  layer: string;
  shape: "box" | "cylinder" | "cone" | "sphere" | "torus";
  /** Shape parameters, metres. */
  size: Record<string, number>;
  position: Vec3;
  /** Degrees, three.js XYZ order. */
  rotation?: Vec3;
  color: string;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Where the label points, world space. */
  label: Vec3;
  /** Where this part moves to in the fully exploded view. */
  explode: Vec3;
  /** What it is for, one sentence. */
  note: string;
  /** Turns about its own centre while the artifact is open. */
  spin?: { axis: "x" | "y" | "z"; speed: number };
}

export interface BuildLayer {
  id: string;
  label: string;
  color: string;
  note: string;
  parts: string[];
}

export interface BuildStep {
  id: string;
  name: string;
  summary: string;
  detail: string;
  /** Parts this step is about (the viewer can highlight them). */
  focus: string[];
}

export interface ParamSpec {
  key: string;
  label: string;
  kind: "number" | "choice";
  value: number | string;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  unit?: string;
  /** What this parameter drives elsewhere in the build. */
  affects: string;
}

export interface DerivedFact {
  label: string;
  value: string;
}

export interface BuildProgram {
  kind: "build";
  /** Registry id of the builder that produced this program. */
  builder: string;
  domain: BuildDomain;
  title: string;
  params: Record<string, number | string>;
  paramSpecs: ParamSpec[];
  parts: BuildPart[];
  layers: BuildLayer[];
  steps: BuildStep[];
  /** Relationships computed from the parameters (shown in the card). */
  derived: DerivedFact[];
  /** Scene3D program, so GLB/glTF export is the same code path. */
  scene: Scene3DProgram;
  notes: string[];
  /**
   * Where the numbers came from.
   *
   * A construction informed by research records each source beside what it was
   * used for, and whether the figure was read from the page or assumed. The
   * card shows both, so a schematic model never passes for a sourced design.
   */
  sources?: BuildSource[];
}

export interface BuildSource {
  url: string;
  title?: string;
  /** the parameter or relationship this source informed */
  used: string;
  /** "verified": read from the source. "assumption": chosen, not sourced. */
  basis: "verified" | "assumption";
}

export interface Rejection {
  key: string;
  reason: string;
}

export interface BuildOutcome {
  ok: boolean;
  program?: BuildProgram;
  reason?: string;
  rejected: Rejection[];
}

export interface BuildBuilder {
  id: string;
  domain: BuildDomain;
  label: string;
  /** Words that select this builder from a request. */
  keywords: string[];
  /** The parameter surface, with current defaults. */
  paramSpecs(input?: Record<string, unknown>): ParamSpec[];
  /** Pure: equivalent inputs always produce the same program. */
  build(params: Record<string, unknown>, title?: string): BuildOutcome;
}

/* ------------------------------------------------------------------ *
 * Parameter validation
 * ------------------------------------------------------------------ */

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Validates against the builder's own parameter surface.
 *
 * Unknown keys and out-of-range values are REJECTED with a reason rather
 * than silently clipped: a caller that asks for a 900-tooth gear should be
 * told no, not handed a 60-tooth one that looks like it worked.
 */
export function validateParams(
  specs: ParamSpec[],
  input: Record<string, unknown> | undefined,
): { values: Record<string, number | string>; rejected: Rejection[] } {
  const values: Record<string, number | string> = {};
  const rejected: Rejection[] = [];
  const byKey = new Map(specs.map((s) => [s.key, s]));
  for (const spec of specs) values[spec.key] = spec.value;
  for (const [key, raw] of Object.entries(input ?? {})) {
    const spec = byKey.get(key);
    if (!spec) {
      rejected.push({ key, reason: `“${key}” is not a parameter here — use ${[...byKey.keys()].join(", ")}` });
      continue;
    }
    if (spec.kind === "choice") {
      const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      const match = (spec.choices ?? []).find((c) => c.toLowerCase() === text);
      if (!match) {
        rejected.push({ key, reason: `“${String(raw)}” is not one of ${(spec.choices ?? []).join(", ")}` });
        continue;
      }
      values[key] = match;
      continue;
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      rejected.push({ key, reason: `“${String(raw)}” is not a number` });
      continue;
    }
    const lo = spec.min ?? -Infinity;
    const hi = spec.max ?? Infinity;
    if (n < lo || n > hi) {
      rejected.push({ key, reason: `${n} is outside ${lo}…${hi}${spec.unit ? ` ${spec.unit}` : ""}` });
      continue;
    }
    values[key] = spec.step ? clampNum(Math.round(n / spec.step) * spec.step, lo, hi) : n;
  }
  return { values, rejected };
}

export function num(values: Record<string, number | string>, key: string, fallback = 0): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function text(values: Record<string, number | string>, key: string, fallback = ""): string {
  const v = values[key];
  return typeof v === "string" ? v : fallback;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers shared by every builder
 * ------------------------------------------------------------------ */

/** A part with the defaults every builder wants (labelled, explodable). */
export function part(input: Omit<BuildPart, "label" | "explode"> & { label?: Vec3; explode?: Vec3 }): BuildPart {
  const [x, y, z] = input.position;
  return {
    ...input,
    label: input.label ?? [x + 0.02, y + 0.02, z + 0.02],
    explode: input.explode ?? [0, 0, 0],
  };
}

/** The polar position of something placed around the Y axis. */
export function ringPoint(radius: number, degrees: number, y = 0): Vec3 {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a) * radius, y, Math.sin(a) * radius];
}

/**
 * The Euler rotation (three.js XYZ order) that turns a +Y cylinder to point
 * along `direction`.
 *
 * Bonds, struts and braces are all "a cylinder between two points", and an
 * arbitrary direction cannot be expressed by a single axis rotation. This is
 * the closed form of R = Ry(yaw)·Rx(pitch) written back as XYZ Euler.
 */
export function alignY(direction: Vec3): Vec3 {
  const [x, y, z] = direction;
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return [0, 0, 0];
  const dx = x / len;
  const dy = y / len;
  const dz = z / len;
  const pitch = Math.acos(clampNum(dy, -1, 1));
  const sinPitch = Math.sin(pitch);
  if (sinPitch < 1e-6) return [dy > 0 ? 0 : 180, 0, 0];
  const yaw = Math.atan2(dx, dz);
  const cosPitch = Math.cos(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  // R = Ry(yaw)·Rx(pitch), row-major as three.js composes it.
  const r00 = cosYaw;
  const r01 = sinYaw * sinPitch;
  const r12 = -sinPitch;
  const r22 = cosYaw * cosPitch;
  const s2 = sinYaw * cosPitch;
  const c2 = Math.sqrt(Math.max(0, 1 - s2 * s2));
  const y2 = Math.asin(clampNum(s2, -1, 1));
  const z3 = c2 < 1e-6 ? 0 : Math.atan2(-r01 / c2, r00 / c2);
  const x1 = c2 < 1e-6 ? Math.atan2(sinPitch, cosYaw * cosPitch) : Math.atan2(sinPitch / c2, r22 / c2);
  const deg = (rad: number) => (rad * 180) / Math.PI;
  void r12;
  return [deg(x1), deg(y2), deg(z3)];
}

/** A cylinder from one point to another, sized to reach. */
export function strut(
  input: Omit<BuildPart, "shape" | "size" | "position" | "rotation" | "label" | "explode"> & {
    from: Vec3;
    to: Vec3;
    radius: number;
    label?: Vec3;
    explode?: Vec3;
  },
): BuildPart {
  const { from, to, radius, ...rest } = input;
  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  const dir: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const height = Math.hypot(...dir);
  return {
    ...rest,
    shape: "cylinder",
    size: { radius, height },
    position: mid,
    rotation: alignY(dir),
    label: input.label ?? [mid[0] + 0.02, mid[1] + 0.02, mid[2] + 0.02],
    explode: input.explode ?? [0, 0, 0],
  };
}

/** Groups parts into the layers a builder declares, in declaration order. */
export function layersOf(
  declared: Array<{ id: string; label: string; color: string; note: string }>,
  parts: BuildPart[],
): BuildLayer[] {
  return declared.map((layer) => ({
    ...layer,
    parts: parts.filter((p) => p.layer === layer.id).map((p) => p.id),
  }));
}

/** The Scene3D program for a set of parts (identical shape to the engine's). */
export function sceneOf(
  parts: BuildPart[],
  options: {
    background?: string;
    camera?: { position: Vec3; target: Vec3; fov: number };
    preset?: string;
    seed?: number;
  } = {},
): Scene3DProgram {
  const objects: SceneObject[] = parts.map((p) => ({
    id: p.id,
    shape: p.shape,
    position: p.position,
    rotation: p.rotation ?? [0, 0, 0],
    scale: [1, 1, 1],
    color: p.color,
    metalness: p.metalness ?? 0.35,
    roughness: p.roughness ?? 0.45,
    opacity: p.opacity ?? 1,
    emissive: p.emissive,
    emissiveIntensity: p.emissiveIntensity,
    size: p.size,
  }));
  return {
    background: options.background ?? "#07060f",
    camera: options.camera ?? { position: [0.9, 0.6, 1.1], target: [0, 0.1, 0], fov: 40 },
    lights: [
      { type: "hemisphere", color: "#cfd8ff", intensity: 0.55, position: [0, 1, 0], ground: "#161027" },
      { type: "directional", color: "#ffffff", intensity: 1.7, position: [1.2, 1.8, 1.4] },
      { type: "directional", color: "#b98cff", intensity: 0.6, position: [-1.4, 0.6, -1.2] },
    ],
    objects,
    duration: 4,
    seed: options.seed ?? 19714,
    preset: options.preset ?? "build",
  };
}

/** Human-readable differences between two builds of the same builder. */
export function diffPrograms(before: BuildProgram, after: BuildProgram): string[] {
  const lines: string[] = [];
  for (const spec of after.paramSpecs) {
    const a = before.params[spec.key];
    const b = after.params[spec.key];
    if (a === b) continue;
    lines.push(`${spec.label}: ${String(a)}${spec.unit ? ` ${spec.unit}` : ""} → ${String(b)}${spec.unit ? ` ${spec.unit}` : ""}`);
  }
  for (const fact of after.derived) {
    const old = before.derived.find((d) => d.label === fact.label);
    if (old && old.value !== fact.value) lines.push(`${fact.label}: ${old.value} → ${fact.value}`);
  }
  if (before.parts.length !== after.parts.length) {
    lines.push(`Components: ${before.parts.length} → ${after.parts.length}`);
  }
  return lines;
}
