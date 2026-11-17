/**
 * ==========================================================
 * LÉLU ASRE — PERSISTENT CHARACTER IDENTITY (Mission 5, WP04)
 *
 * A character is an identity plus an immutable history of versions.
 * A version records the full spec, the operation that produced it and,
 * per component, the content key, the geometry key and two hashes:
 *
 *   geometrySha  positions + indices + cells, placed in the world
 *   materialSha  vertex colours
 *
 * so "the face did not change" is a byte comparison, not a belief.
 *
 * Impact analysis says, BEFORE anything is built, what an edit will do
 * to each component and why:
 *
 *   keep                  same content key: reuse the cached geometry
 *   recolor               same geometry key, other materials: no resampling
 *   rebuild (params)      its own parameters changed
 *   rebuild (dependency)  a component it is built around changed
 *                         (e.g. trousers after the legs changed)
 *
 * Pure: no Node, no DOM.
 * ==========================================================
 */

import { sha256Hex } from "../nre/hash.ts";
import { canonicalJson } from "../nre/serialize.ts";
import type { CharacterSpec } from "./CharacterSpec.ts";
import { COMPONENTS, COMPONENT_ORDER, type ComponentId } from "./components.ts";
import { plan, placedMesh, type BuildPlan, type BuiltComponent, type Lattice } from "./build.ts";

export type ImpactAction = "keep" | "recolor" | "rebuild";

export interface ComponentImpact {
  id: ComponentId;
  action: ImpactAction;
  /** Why: "unchanged", "materials only", "own parameters", or "depends on <id>". */
  reason: string;
}

/** What an edit from `before` to `after` will do to every component, and why. */
export function impactOf(before: CharacterSpec, after: CharacterSpec, lattice: Lattice): ComponentImpact[] {
  const a = plan(before, lattice), b = plan(after, lattice);
  const out: ComponentImpact[] = [];
  const rebuilt = new Set<ComponentId>();
  for (const id of COMPONENT_ORDER) {
    if (a.keys[id] === b.keys[id]) {
      out.push({ id, action: "keep", reason: "unchanged" });
      continue;
    }
    if (a.geometryKeys[id] === b.geometryKeys[id]) {
      out.push({ id, action: "recolor", reason: "materials only" });
      continue;
    }
    const def = COMPONENTS[id];
    const ownChanged = canonicalJson(neutral(def.params(before, a.sk))) !== canonicalJson(neutral(def.params(after, b.sk)));
    const depsBefore = def.deps(before), depsAfter = def.deps(after);
    const dep = depsAfter.find((d) => rebuilt.has(d)) ?? (canonicalJson(depsBefore) !== canonicalJson(depsAfter) ? depsAfter[0] : undefined);
    out.push({ id, action: "rebuild", reason: ownChanged ? "own parameters" : dep ? `depends on ${dep}` : "own parameters" });
    rebuilt.add(id);
  }
  return out;
}

/** Strip colour-like fields so "own parameters" means geometry parameters. */
function neutral(v: unknown): unknown {
  if (Array.isArray(v)) return v.length === 3 && v.every((x) => typeof x === "number" && x >= 0 && x <= 1) ? "rgb" : v.map(neutral);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, neutral(x)]));
  return v;
}

export interface ComponentRecord {
  key: string;
  geometryKey: string;
  geometrySha: string;
  materialSha: string;
  cells: number;
  triangles: number;
  /** What the build did for this version. */
  action: "regenerated" | "recolored" | "reused";
}

const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Hashes of one placed component (world coordinates, so a move is a change). */
export function componentRecord(c: BuiltComponent, h: number): ComponentRecord {
  const local = c.local!;
  if (!local.mesh.indices.length) {
    return { key: c.key, geometryKey: c.geometryKey, geometrySha: "empty", materialSha: "empty", cells: 0, triangles: 0, action: c.action };
  }
  const m = placedMesh(c, h);
  const anchor = new Int32Array(c.anchor);
  const geo = new Uint8Array(m.positions.byteLength + m.indices.byteLength + local.cells.byteLength + anchor.byteLength);
  let o = 0;
  for (const part of [bytesOf(m.positions), bytesOf(m.indices), bytesOf(local.cells), bytesOf(anchor)]) {
    geo.set(part, o);
    o += part.length;
  }
  return {
    key: c.key,
    geometryKey: c.geometryKey,
    geometrySha: sha256Hex(geo),
    materialSha: m.colors ? sha256Hex(bytesOf(m.colors)) : "none",
    cells: local.cells.length / 3,
    triangles: m.indices.length / 3,
    action: c.action,
  };
}

export type VersionOperation =
  | { kind: "create" }
  | { kind: "edit"; patch: SpecPatch; label?: string }
  | { kind: "restore"; from: string; components?: RestorableGroup[] };

/** Groups of the spec that can be restored on their own from an earlier version. */
export type RestorableGroup = "hair" | "clothing" | "body" | "face" | "accessories" | "materials" | "pose";

export interface SpecPatch {
  body?: Partial<CharacterSpec["body"]>;
  face?: Partial<CharacterSpec["face"]>;
  hair?: Partial<CharacterSpec["hair"]>;
  clothing?: Partial<CharacterSpec["clothing"]>;
  accessories?: Partial<CharacterSpec["accessories"]>;
  materials?: Partial<CharacterSpec["materials"]>;
  pose?: CharacterSpec["pose"];
}

export interface CharacterVersion {
  id: string;
  characterId: string;
  parentId: string | null;
  createdAt: number;
  label: string;
  operation: VersionOperation;
  spec: CharacterSpec;
  specHash: string;
  builder: string;
  lattice: number;
  impact: ComponentImpact[];
  components: Record<ComponentId, ComponentRecord>;
  build: { ms: number; regenerated: ComponentId[]; recolored: ComponentId[]; reused: ComponentId[] };
  glb: { file: string; sha256: string; bytes: number; triangles: number; meshValid: boolean };
  /** Evidence class of every cell: a procedural character is GENERATED, never observed. */
  evidence: "GENERATED";
  /** SHA-256 of this record without this field: tamper/corruption check. */
  recordHash: string;
}

export function specHash(spec: CharacterSpec): string {
  return sha256Hex(canonicalJson(spec));
}

/** Hash of a version record (everything except recordHash itself). */
export function versionHash(v: Omit<CharacterVersion, "recordHash"> | CharacterVersion): string {
  const { recordHash: _r, ...rest } = v as CharacterVersion;
  return sha256Hex(canonicalJson(rest));
}

/** Copy the named groups of `from` into `into` (a partial restore). */
export function restoreGroups(into: CharacterSpec, from: CharacterSpec, groups: RestorableGroup[]): CharacterSpec {
  const next: CharacterSpec = structuredClone(into);
  for (const g of groups) {
    if (g === "hair") {
      next.hair = structuredClone(from.hair);
      next.materials.hair = [...from.materials.hair];
    } else if (g === "clothing") {
      next.clothing = structuredClone(from.clothing);
      for (const k of ["top", "bottom", "shoes"] as const) next.materials[k] = [...from.materials[k]];
    } else if (g === "body") next.body = structuredClone(from.body);
    else if (g === "face") {
      next.face = structuredClone(from.face);
      next.materials.eyes = [...from.materials.eyes];
    } else if (g === "accessories") {
      next.accessories = structuredClone(from.accessories);
      next.materials.accessory = [...from.materials.accessory];
    } else if (g === "materials") next.materials = structuredClone(from.materials);
    else if (g === "pose") next.pose = from.pose;
  }
  return next;
}

export interface ComponentDiff {
  id: ComponentId;
  change: "same" | "material-only" | "geometry" | "added" | "removed";
  trianglesBefore: number;
  trianglesAfter: number;
}

/** Component-level comparison of two versions, from their recorded hashes. */
export function diffComponents(a: CharacterVersion, b: CharacterVersion): ComponentDiff[] {
  return COMPONENT_ORDER.map((id) => {
    const x = a.components[id], y = b.components[id];
    const empty = (r: ComponentRecord) => r.geometrySha === "empty";
    let change: ComponentDiff["change"] = "same";
    if (empty(x) && !empty(y)) change = "added";
    else if (!empty(x) && empty(y)) change = "removed";
    else if (x.geometrySha !== y.geometrySha) change = "geometry";
    else if (x.materialSha !== y.materialSha) change = "material-only";
    return { id, change, trianglesBefore: x.triangles, trianglesAfter: y.triangles };
  });
}

/** Spec fields that differ between two specs, as dotted paths. */
export function specChanges(a: CharacterSpec, b: CharacterSpec): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, p: string) => {
    if (canonicalJson(x) === canonicalJson(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
    } else out.push(p);
  };
  walk(a, b, "");
  return out;
}

export type { BuildPlan };
