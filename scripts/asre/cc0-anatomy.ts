/**
 * ==========================================================
 * LÉLU ASRE — CC0 REFERENCE ANATOMY LOADER (Node)
 *
 * Reads the MakeHuman CC0 library from resources/cc0, fits a body from morph
 * targets, resolves its rig and places the proxies (eyes, teeth, hair) with
 * their own `.mhclo` mappings, and installs the result into the provider that
 * LÉLU's components build against.
 *
 * Everything here is deterministic: the digest of the selection is part of
 * every affected component's content key, so the same options rebuild the
 * same component and a changed option regenerates exactly what it touches.
 * ==========================================================
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../../src/core/asre/nre/hash.ts";
import { parseMhclo, parseObj, parseTarget, parseWeights, applyTarget } from "../../src/core/asre/reference/parser.ts";
import type { RefMesh } from "../../src/core/asre/reference/parser.ts";
import { installReference } from "../../src/core/asre/reference/provider.ts";
import type { ReferenceData, RefProxy } from "../../src/core/asre/reference/provider.ts";
import type { Rig } from "../../src/core/asre/reference/skin.ts";
import type { V3 } from "../../src/core/asre/character/sdf.ts";

export const REF_ROOT = "resources/cc0/makehuman";
const CORE = join(REF_ROOT, "mh-core/makehuman/data");
const SYS = join(REF_ROOT, "makehuman_system_assets");
const HAIR01 = join(REF_ROOT, "hair01/hair");

/** Hairstyles that exist as CC0 meshes, keyed by LÉLU's style ids. */
export const HAIR_ASSETS: Record<string, string> = {
  buzz: "short01",
  pixie: "short02",
  bob: "bob01",
  lob: "bob02",
  "long-straight": "long01",
  "long-wavy": "long01",
  ponytail: "ponytail01",
  "high-ponytail": "ponytail01",
  afro: "afro01",
  braids: "braid01",
  bun: "bun-brown",
  "top-knot": "short03",
  "double-buns": "short04",
};

const HAIR_PATHS: Record<string, string> = {
  "bun-brown": join(HAIR01, "rehmanpolanski_hair_bun_brown"),
};

/** Sensible anatomical starting points from the CC0 macrodetails library. */
export const BODY_TARGETS = {
  femaleYoung: "targets/macrodetails/universal-female-young-average-1.target",
  femaleSlim: "targets/macrodetails/universal-female-young-minweight-minmuscle-1.target",
  femaleFull: "targets/macrodetails/universal-female-young-maxweight-average-1.target",
  maleYoung: "targets/macrodetails/universal-male-young-average-1.target",
  africanFemale: "targets/macrodetails/universal-female-young-african-average-1.target",
  asianFemale: "targets/macrodetails/universal-female-young-asian-average-1.target",
} as const;

const read = (p: string) => readFileSync(p, "utf8");
const exists = (p: string) => existsSync(p);

let cachedBase: { mesh: RefMesh; text: string } | null = null;
function baseMesh(): { mesh: RefMesh; text: string } {
  if (!cachedBase) {
    const text = read(join(CORE, "3dobjs/base.obj"));
    cachedBase = { mesh: parseObj(text), text };
  }
  return cachedBase;
}

/** Find a proxy's .obj next to its .mhclo (they share a basename). */
function findProxy(dir: string, name?: string): { obj: string; mhclo: string } | null {
  if (!exists(dir)) return null;
  const candidates = name ? [name] : [];
  if (!candidates.length) return null;
  for (const c of candidates) {
    const obj = join(dir, `${c}.obj`);
    const mhclo = join(dir, `${c}.mhclo`);
    if (exists(obj) && exists(mhclo)) return { obj, mhclo };
  }
  return null;
}

export interface LoadOptions {
  /** Finished height in metres. */
  height?: number;
  /** Target files relative to the MakeHuman data root. */
  targets?: string[];
  /** Hairstyle ids to make available (LÉLU style ids). */
  hairStyles?: string[];
  /** Include the visible teeth proxy. */
  teeth?: boolean;
  /** Include eyes. */
  eyes?: boolean;
}

export interface LoadedReference extends ReferenceData {
  /** Body vertices in mesh units, for cataloguing. */
  stats: { vertices: number; triangles: number; targets: string[]; proxies: string[] };
}

const BONE_JOINT: Record<string, string> = {
  "wrist.L": "joint-l-hand", "wrist.R": "joint-r-hand",
  "upperarm01.L": "joint-l-shoulder", "upperarm01.R": "joint-r-shoulder",
  "upperarm02.L": "joint-l-elbow", "upperarm02.R": "joint-r-elbow",
  "lowerarm01.L": "joint-l-elbow", "lowerarm01.R": "joint-r-elbow",
  "lowerarm02.L": "joint-l-wrist", "lowerarm02.R": "joint-r-wrist",
  "upperleg01.L": "joint-l-upper-leg", "upperleg01.R": "joint-r-upper-leg",
  "upperleg02.L": "joint-l-knee", "upperleg02.R": "joint-r-knee",
  "lowerleg01.L": "joint-l-knee", "lowerleg01.R": "joint-r-knee",
  "lowerleg02.L": "joint-l-ankle", "lowerleg02.R": "joint-r-ankle",
  "foot.L": "joint-l-foot-1", "foot.R": "joint-r-foot-1",
  "clavicle.L": "joint-l-clavicle", "clavicle.R": "joint-r-clavicle",
  "shoulder01.L": "joint-l-scapula", "shoulder01.R": "joint-r-scapula",
  head: "joint-head", jaw: "joint-jaw", neck03: "joint-neck",
  spine01: "joint-spine-1", spine02: "joint-spine-2", spine03: "joint-spine-3", spine04: "joint-spine-4",
  "pelvis.L": "joint-pelvis", "pelvis.R": "joint-pelvis",
  "oris01": "joint-mouth", "oris05": "joint-mouth",
  "oculi01.L": "joint-l-eye", "oculi01.R": "joint-r-eye",
  "orbicularis03.L": "joint-l-upperlid", "orbicularis03.R": "joint-r-upperlid",
  "orbicularis04.L": "joint-l-lowerlid", "orbicularis04.R": "joint-r-lowerlid",
};

const BONE_PARENT: Record<string, string> = {
  lowerarm01: "upperarm02", lowerarm02: "lowerarm01",
  upperarm02: "upperarm01", upperarm01: "shoulder01",
  metacarpal1: "wrist", metacarpal2: "wrist", metacarpal3: "wrist", metacarpal4: "wrist",
  wrist: "lowerarm02",
  lowerleg01: "upperleg02", lowerleg02: "lowerleg01", upperleg02: "upperleg01",
  foot: "lowerleg02",
  spine05: "spine04", spine04: "spine03", spine03: "spine02", spine02: "spine01",
  head: "neck03", jaw: "head", neck03: "spine05", neck02: "neck01", neck01: "spine05",
};

function boneParent(bone: string): string | null {
  const m = /^(finger|toe)(\d)-(\d)\.([LR])$/.exec(bone);
  if (m) {
    const seg = +m[3], side = m[4];
    if (seg > 1) return `${m[1]}${m[2]}-${seg - 1}.${side}`;
    return m[1] === "finger" ? `metacarpal${m[2]}.${side}` : `foot.${side}`;
  }
  const base = bone.replace(/\.[LR]$/, "");
  const parent = BONE_PARENT[base];
  if (parent) return bone.includes(".") ? `${parent}.${bone.split(".")[1]}` : parent;
  return null;
}

function boneJointName(bone: string): string | null {
  if (BONE_JOINT[bone]) return BONE_JOINT[bone];
  const m = /^(finger|toe)(\d)-(\d)\.([LR])$/.exec(bone);
  if (m) return `joint-${m[4].toLowerCase()}-${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Load, fit and install a reference body. */
export function loadReference(opts: LoadOptions = {}): LoadedReference {
  const height = opts.height ?? 1.7;
  const targetPaths = opts.targets ?? [BODY_TARGETS.femaleYoung];
  const { mesh } = baseMesh();
  const positions = mesh.positions.slice();

  // 1. morph targets, in mesh units
  const applied: string[] = [];
  for (const t of targetPaths) {
    const p = join(CORE, t);
    if (!exists(p)) continue;
    applyTarget(positions, parseTarget(read(p)), 1);
    applied.push(t);
  }

  // 2. body faces only: helper surfaces and joint markers are not skin
  const bodyFaces = mesh.groupFaces.get("body");
  if (!bodyFaces || !bodyFaces.length) throw new Error("reference mesh has no `body` group");
  const indices = Uint32Array.from(bodyFaces.map((i) => mesh.indices[i]));

  // 3. bounds and the transform to metres, feet on the ground, +Z front
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  const k = height / (ymax - ymin);
  const toMetres = (p: V3): V3 => [p[0] * k, (p[1] - ymin) * k, p[2] * k];
  const metres = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const m = toMetres([positions[i], positions[i + 1], positions[i + 2]]);
    metres[i] = m[0];
    metres[i + 1] = m[1];
    metres[i + 2] = m[2];
  }

  // 4. joints from the mesh's own marker groups
  const joints = new Map<string, V3>();
  for (const [name, verts] of mesh.groups) {
    if (!name.startsWith("joint-") || !verts.length) continue;
    let sx = 0, sy = 0, sz = 0;
    const uniq = [...new Set(verts)];
    for (const v of uniq) {
      sx += positions[3 * v];
      sy += positions[3 * v + 1];
      sz += positions[3 * v + 2];
    }
    joints.set(name, toMetres([sx / uniq.length, sy / uniq.length, sz / uniq.length]));
  }

  // 5. rig: real per-vertex weights, bone heads from those joints
  const weights = parseWeights(read(join(CORE, "rigs/default_weights.mhw")));
  const heads = new Map<string, V3>();
  const parents = new Map<string, string | null>();
  for (const bone of weights.bones) {
    const jn = boneJointName(bone);
    const h = jn ? joints.get(jn) : undefined;
    if (h) heads.set(bone, h);
    parents.set(bone, boneParent(bone));
  }
  const vertexBones = weights.perVertex.map((list) => list.map(([bi, w]) => [weights.bones[bi], w] as [string, number]));
  const rig: Rig = { heads, parents, vertexBones };

  // 6. proxies, placed by their own mappings
  const proxies: Record<string, RefProxy> = {};
  /** Resolve one proxy: barycentric on the base body plus its own offset, in metres. */
  const addProxyFull = (name: string, objPath: string, mhcloPath: string) => {
    const mh = parseMhclo(read(mhcloPath));
    const obj = parseObj(read(objPath));
    const n = Math.min(mh.verts.length, obj.positions.length / 3);
    const positionsOut = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = mh.verts[i];
      const [a, b, c] = v.tri;
      const p: V3 = [
        v.bary[0] * positions[a * 3] + v.bary[1] * positions[b * 3] + v.bary[2] * positions[c * 3] + v.offset[0],
        v.bary[0] * positions[a * 3 + 1] + v.bary[1] * positions[b * 3 + 1] + v.bary[2] * positions[c * 3 + 1] + v.offset[1],
        v.bary[0] * positions[a * 3 + 2] + v.bary[1] * positions[b * 3 + 2] + v.bary[2] * positions[c * 3 + 2] + v.offset[2],
      ];
      const m = toMetres(p);
      positionsOut[3 * i] = m[0];
      positionsOut[3 * i + 1] = m[1];
      positionsOut[3 * i + 2] = m[2];
    }
    proxies[name] = { positions: positionsOut, indices: obj.indices };
  };

  if (opts.eyes !== false) {
    const p = findProxy(join(SYS, "eyes/high-poly"), "high-poly");
    if (p) addProxyFull("eyes", p.obj, p.mhclo);
  }
  if (opts.teeth) {
    const p = findProxy(join(SYS, "teeth/teeth_base"), "teeth_base");
    if (p) addProxyFull("teeth", p.obj, p.mhclo);
  }
  // whole-outfit and shoe garments, placed by their own .mhclo mappings
  for (const g of ["female_casualsuit01", "female_casualsuit02", "female_sportsuit01", "female_elegantsuit01"]) {
    const p = findProxy(join(SYS, "clothes", g), g);
    if (p) addProxyFull(`outfit:${g.replace("female_", "")}`, p.obj, p.mhclo);
  }
  for (const g of ["shoes01", "shoes02", "shoes03"]) {
    const p = findProxy(join(SYS, "clothes", g), g);
    if (p) addProxyFull(`shoes:${g}`, p.obj, p.mhclo);
  }
  for (const style of opts.hairStyles ?? []) {
    const asset = HAIR_ASSETS[style];
    if (!asset) continue;
    const dir = HAIR_PATHS[asset] ?? join(SYS, "hair", asset);
    const p = findProxy(dir, asset);
    if (p) addProxyFull(`hair:${style}`, p.obj, p.mhclo);
  }

  const digest = sha256Hex(JSON.stringify({ targets: applied, height: Math.round(height * 1e4), proxies: Object.keys(proxies).sort(), rig: weights.bones.length })).slice(0, 16);
  const data: LoadedReference = {
    digest,
    height,
    positions: metres,
    indices,
    rig,
    joints,
    proxies,
    targets: applied,
    stats: { vertices: positions.length / 3, triangles: indices.length / 3, targets: applied, proxies: Object.keys(proxies) },
  };
  installReference(data);
  return data;
}
