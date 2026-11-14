/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: 3D SCENES → three.js → GLB / glTF
 *
 * A scene is a compact program — primitives and procedural
 * compound objects (terrain, trees, rocks, buildings, crystals,
 * garment forms), arrays of them, materials, lights, camera and
 * keyframe animation. It is built into a real three.js scene
 * (MIT, already the 3D engine of the app) and exported with
 * three's GLTFExporter, so the file opens in Blender, any glTF
 * viewer, or back in LÉLU.
 *
 * buildScene takes the three namespace as a parameter, so the
 * same program builds against the WebGL build ("three") or the
 * WebGPU build ("three/webgpu") without mixing class instances.
 *
 * Babylon.js was evaluated: it would be a second, competing 3D
 * engine with its own scene graph. three.js already covers every
 * operation here, so it was not added.
 * ==========================================================
 */

import type * as ThreeNS from "three";
import { clamp, fbm, noise2D, rng, seedFrom } from "./Rng";

type THREE = typeof ThreeNS;
type Vec3 = [number, number, number];

export const PRIMITIVES = ["box", "sphere", "cylinder", "cone", "torus", "torusKnot", "plane", "capsule", "icosahedron", "dodecahedron", "octahedron", "ring"] as const;
export const COMPOUNDS = ["terrain", "tree", "rock", "building", "crystal", "garment", "water", "stars", "text-pillar"] as const;
export type Shape = (typeof PRIMITIVES)[number] | (typeof COMPOUNDS)[number];

export interface SceneObject {
  id: string;
  shape: Shape;
  position: Vec3;
  /** Degrees. */
  rotation: Vec3;
  scale: Vec3;
  color: string;
  metalness: number;
  roughness: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity: number;
  wireframe?: boolean;
  flat?: boolean;
  /** Size parameters (width/height/depth/radius/tube/segments/detail…), by shape. */
  size: Record<string, number>;
  /** Copies of this object in a pattern. */
  repeat?: { count: number; pattern: "ring" | "grid" | "line" | "scatter" | "spiral"; radius: number; spacing: number; jitter: number; seed: number };
  animate?: { type: "spin" | "bob" | "orbit" | "pulse"; speed: number; amount: number };
}

export interface SceneLight { type: "ambient" | "hemisphere" | "directional" | "point" | "spot"; color: string; intensity: number; position: Vec3; ground?: string }

export interface Scene3DProgram {
  background: string;
  fog?: { color: string; near: number; far: number };
  camera: { position: Vec3; target: Vec3; fov: number };
  lights: SceneLight[];
  objects: SceneObject[];
  /** Seconds; the length of exported animation clips. */
  duration: number;
  seed: number;
  /** Preset used to start the scene, if any (recorded for revisions). */
  preset?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;
const NAMED: Record<string, string> = { red: "#e4572e", gold: "#d4a94e", white: "#f4f0ff", black: "#111111", blue: "#4ea5e9", green: "#52b788", purple: "#a78bfa", pink: "#f4acb7", silver: "#c0c4cc", teal: "#2fb8ac", orange: "#f2a541", grey: "#8a8f98", gray: "#8a8f98", brown: "#7a5230", sand: "#d8c08c", violet: "#b98cff", cyan: "#22d3ee" };
const color = (v: unknown, fallback: string) => {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (HEX.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return NAMED[s] ?? fallback;
};
const vec = (v: unknown, fallback: Vec3): Vec3 => {
  if (typeof v === "number" && Number.isFinite(v)) return [v, v, v];
  if (!Array.isArray(v) || v.length < 3) return fallback;
  const out = v.slice(0, 3).map(Number);
  return out.every(Number.isFinite) ? (out.map((n) => clamp(n, -10_000, 10_000)) as Vec3) : fallback;
};
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

export const LIMITS3D = { objects: 400, instances: 4000, triangles: 2_000_000 };

/** Accept a loose scene (from a model, a person, or a preset) and return a complete program or a reason. */
export function normalizeScene(input: unknown): Scene3DProgram | string {
  const v = isObj(input) ? input : {};
  const seed = typeof v.seed === "number" ? Math.abs(Math.floor(v.seed)) : seedFrom(String(v.seed ?? v.preset ?? "scene"));
  const base = typeof v.preset === "string" && PRESETS[v.preset] ? PRESETS[v.preset](seed) : null;
  const rawObjects = Array.isArray(v.objects) ? v.objects : [];
  if (!base && rawObjects.length === 0) return `a scene needs objects or a preset (${Object.keys(PRESETS).join(", ")})`;
  const objects: SceneObject[] = base ? [...base.objects] : [];
  const ids = new Set(objects.map((o) => o.id));
  for (const [i, raw] of rawObjects.slice(0, LIMITS3D.objects).entries()) {
    if (!isObj(raw)) return `object ${i + 1} is not an object`;
    const shape = String(raw.shape ?? raw.type ?? "box") as Shape;
    if (![...PRIMITIVES, ...COMPOUNDS].includes(shape as never)) return `object ${i + 1}: unknown shape “${shape}” (use ${[...PRIMITIVES, ...COMPOUNDS].join(", ")})`;
    let id = String(raw.id ?? raw.name ?? `${shape}-${i + 1}`).replace(/[^\w-]/g, "-").slice(0, 60);
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const size: Record<string, number> = {};
    if (isObj(raw.size)) for (const [k, n] of Object.entries(raw.size)) if (typeof n === "number" && Number.isFinite(n)) size[k] = clamp(n, 0.001, 1000);
    for (const k of ["width", "height", "depth", "radius", "tube", "segments", "detail", "floors"]) if (typeof raw[k] === "number") size[k] = clamp(raw[k] as number, 0.001, 1000);
    const rep = isObj(raw.repeat) ? raw.repeat : null;
    const anim = isObj(raw.animate) ? raw.animate : typeof raw.animate === "string" ? { type: raw.animate } : null;
    objects.push({
      id, shape,
      position: vec(raw.position, [0, 0, 0]),
      rotation: vec(raw.rotation, [0, 0, 0]),
      scale: vec(raw.scale, [1, 1, 1]),
      color: color(raw.color, "#b98cff"),
      metalness: num(raw.metalness, 0.1, 0, 1),
      roughness: num(raw.roughness, 0.6, 0, 1),
      emissive: raw.emissive ? color(raw.emissive, "#000000") : undefined,
      emissiveIntensity: num(raw.emissiveIntensity, 1, 0, 20),
      opacity: num(raw.opacity, 1, 0.02, 1),
      wireframe: raw.wireframe === true,
      flat: raw.flat === true,
      size,
      repeat: rep ? {
        count: Math.round(num(rep.count, 6, 1, 500)),
        pattern: (["ring", "grid", "line", "scatter", "spiral"].includes(String(rep.pattern)) ? rep.pattern : "ring") as NonNullable<SceneObject["repeat"]>["pattern"],
        radius: num(rep.radius, 4, 0, 1000), spacing: num(rep.spacing, 2, 0, 1000), jitter: num(rep.jitter, 0, 0, 1),
        seed: typeof rep.seed === "number" ? rep.seed : seed + i,
      } : undefined,
      animate: anim && ["spin", "bob", "orbit", "pulse"].includes(String(anim.type)) ? { type: anim.type as "spin", speed: num(anim.speed, 1, 0.05, 20), amount: num(anim.amount, 0.5, 0, 100) } : undefined,
    });
  }
  const cam = isObj(v.camera) ? v.camera : {};
  const lights = Array.isArray(v.lights) ? v.lights.filter(isObj).slice(0, 16).map((l) => ({
    type: (["ambient", "hemisphere", "directional", "point", "spot"].includes(String(l.type)) ? l.type : "directional") as SceneLight["type"],
    color: color(l.color, "#ffffff"), intensity: num(l.intensity, 1, 0, 200), position: vec(l.position, [5, 10, 5]), ground: l.ground ? color(l.ground, "#222222") : undefined,
  })) : [];
  const fog = isObj(v.fog) ? { color: color(v.fog.color, "#120e24"), near: num(v.fog.near, 10, 0, 1e4), far: num(v.fog.far, 80, 1, 1e5) } : base?.fog;
  return {
    background: color(v.background, base?.background ?? "#120e24"),
    fog,
    camera: { position: vec(cam.position, base?.camera.position ?? [8, 6, 12]), target: vec(cam.target, base?.camera.target ?? [0, 1, 0]), fov: num(cam.fov, base?.camera.fov ?? 50, 10, 120) },
    lights: lights.length ? lights : base?.lights ?? DEFAULT_LIGHTS,
    objects,
    duration: num(v.duration, 6, 1, 120),
    seed,
    preset: base ? String(v.preset) : undefined,
  };
}

const DEFAULT_LIGHTS: SceneLight[] = [
  { type: "hemisphere", color: "#dfe7ff", ground: "#2a2140", intensity: 1.1, position: [0, 20, 0] },
  { type: "directional", color: "#fff1dc", intensity: 2.2, position: [8, 14, 6] },
];

/* ------------------------------------------------------------------ *
 * Presets: complete, detailed environments with no model involved.
 * ------------------------------------------------------------------ */

const obj = (o: Partial<SceneObject> & Pick<SceneObject, "id" | "shape">): SceneObject => ({
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#b98cff", metalness: 0.1, roughness: 0.7, opacity: 1, size: {}, ...o,
});

export const PRESETS: Record<string, (seed: number) => Omit<Scene3DProgram, "duration" | "seed">> = {
  forest: (seed) => ({
    background: "#9cc7e8", fog: { color: "#9cc7e8", near: 25, far: 90 },
    camera: { position: [18, 10, 24], target: [0, 2, 0], fov: 50 },
    lights: [{ type: "hemisphere", color: "#e8f4ff", ground: "#3d5a2a", intensity: 1.2, position: [0, 30, 0] }, { type: "directional", color: "#fff3d6", intensity: 2.4, position: [20, 30, 10] }],
    objects: [
      obj({ id: "ground", shape: "terrain", color: "#4f7a3a", size: { width: 80, depth: 80, height: 3, segments: 96 }, flat: true }),
      obj({ id: "pines", shape: "tree", color: "#2d6a4f", position: [0, 0, 0], size: { height: 6 }, repeat: { count: 46, pattern: "scatter", radius: 30, spacing: 0, jitter: 0.4, seed } }),
      obj({ id: "boulders", shape: "rock", color: "#7d7a74", size: { radius: 1.2 }, repeat: { count: 18, pattern: "scatter", radius: 26, spacing: 0, jitter: 0.6, seed: seed + 7 }, flat: true }),
      obj({ id: "pond", shape: "water", color: "#3b8fc4", position: [-6, 0.35, 5], size: { radius: 5 }, metalness: 0.3, roughness: 0.1, opacity: 0.85 }),
    ],
  }),
  city: (seed) => ({
    background: "#0b1020", fog: { color: "#0b1020", near: 30, far: 120 },
    camera: { position: [34, 26, 40], target: [0, 4, 0], fov: 45 },
    lights: [{ type: "hemisphere", color: "#8fa8ff", ground: "#100818", intensity: 0.6, position: [0, 40, 0] }, { type: "directional", color: "#ffd8a8", intensity: 1.4, position: [-30, 40, 20] }, { type: "point", color: "#ff00e5", intensity: 60, position: [0, 6, 0] }],
    objects: [
      obj({ id: "streets", shape: "plane", color: "#1b1f2e", size: { width: 120, height: 120 }, rotation: [-90, 0, 0], roughness: 0.9 }),
      obj({ id: "towers", shape: "building", color: "#2a3350", emissive: "#ffcf7a", emissiveIntensity: 0.6, size: { width: 3, depth: 3, floors: 14 }, repeat: { count: 64, pattern: "grid", radius: 0, spacing: 6.5, jitter: 0.15, seed } }),
      obj({ id: "beacon", shape: "crystal", color: "#00f0ff", emissive: "#00f0ff", emissiveIntensity: 2, position: [0, 3, 0], size: { radius: 1.2, height: 4 }, animate: { type: "spin", speed: 0.5, amount: 0 } }),
    ],
  }),
  desert: (seed) => ({
    background: "#f3c98b", fog: { color: "#f3c98b", near: 30, far: 110 },
    camera: { position: [26, 9, 30], target: [0, 2, 0], fov: 50 },
    lights: [{ type: "hemisphere", color: "#fff4dc", ground: "#a86b32", intensity: 1.1, position: [0, 30, 0] }, { type: "directional", color: "#fff0d0", intensity: 3, position: [30, 25, -10] }],
    objects: [
      obj({ id: "dunes", shape: "terrain", color: "#d8a65c", size: { width: 120, depth: 120, height: 6, segments: 120, detail: 0.5 } }),
      obj({ id: "mesas", shape: "rock", color: "#a2512b", size: { radius: 3.5 }, scale: [1.6, 1, 1.6], repeat: { count: 8, pattern: "scatter", radius: 45, spacing: 0, jitter: 0.5, seed }, flat: true }),
      obj({ id: "obelisk", shape: "text-pillar", color: "#d4a94e", metalness: 0.8, roughness: 0.25, position: [0, 0, 0], size: { height: 9, width: 1.4 } }),
    ],
  }),
  ocean: () => ({
    background: "#0a2540", fog: { color: "#0a2540", near: 20, far: 100 },
    camera: { position: [0, 8, 30], target: [0, 1, 0], fov: 50 },
    lights: [{ type: "hemisphere", color: "#bde0fe", ground: "#03111f", intensity: 1, position: [0, 30, 0] }, { type: "directional", color: "#ffe6b3", intensity: 2.2, position: [-20, 12, -30] }],
    objects: [
      obj({ id: "sea", shape: "water", color: "#0b6e99", size: { radius: 90 }, metalness: 0.4, roughness: 0.15, opacity: 0.95 }),
      obj({ id: "island", shape: "terrain", color: "#d8c08c", position: [0, -0.4, 0], size: { width: 18, depth: 18, height: 4, segments: 64, island: 1 } }),
      obj({ id: "palms", shape: "tree", color: "#52b788", position: [0, 1.2, 0], size: { height: 5, palm: 1 }, repeat: { count: 5, pattern: "scatter", radius: 5, spacing: 0, jitter: 0.3, seed: 11 } }),
      obj({ id: "buoys", shape: "sphere", color: "#e4572e", size: { radius: 0.5 }, repeat: { count: 10, pattern: "ring", radius: 20, spacing: 0, jitter: 0.1, seed: 3 }, animate: { type: "bob", speed: 1.2, amount: 0.4 } }),
    ],
  }),
  space: (seed) => ({
    background: "#02010a",
    camera: { position: [0, 12, 34], target: [0, 0, 0], fov: 50 },
    lights: [{ type: "ambient", color: "#40406a", intensity: 0.5, position: [0, 0, 0] }, { type: "point", color: "#ffd27a", intensity: 900, position: [0, 0, 0] }],
    objects: [
      obj({ id: "star-field", shape: "stars", color: "#ffffff", size: { radius: 160, count: 1500 } }),
      obj({ id: "sun", shape: "sphere", color: "#ffb347", emissive: "#ffb347", emissiveIntensity: 3, size: { radius: 3 } }),
      obj({ id: "planets", shape: "sphere", color: "#4ea5e9", size: { radius: 0.9 }, repeat: { count: 6, pattern: "spiral", radius: 6, spacing: 3, jitter: 0.2, seed }, animate: { type: "orbit", speed: 0.2, amount: 0 } }),
      obj({ id: "rings", shape: "torus", color: "#d4a94e", rotation: [80, 0, 0], size: { radius: 13, tube: 0.06 }, metalness: 0.8, roughness: 0.3 }),
      obj({ id: "asteroids", shape: "rock", color: "#8a8f98", size: { radius: 0.35 }, repeat: { count: 120, pattern: "ring", radius: 17, spacing: 0, jitter: 0.12, seed: seed + 5 }, flat: true }),
    ],
  }),
  "crystal-cave": (seed) => ({
    background: "#0d0820", fog: { color: "#0d0820", near: 8, far: 45 },
    camera: { position: [10, 5, 14], target: [0, 2, 0], fov: 55 },
    lights: [{ type: "ambient", color: "#3b2a66", intensity: 0.6, position: [0, 0, 0] }, { type: "point", color: "#b98cff", intensity: 120, position: [0, 6, 0] }, { type: "point", color: "#22d3ee", intensity: 80, position: [-6, 2, 4] }],
    objects: [
      obj({ id: "floor", shape: "terrain", color: "#2a2140", size: { width: 50, depth: 50, height: 1.5, segments: 64 }, flat: true }),
      obj({ id: "crystals", shape: "crystal", color: "#b98cff", emissive: "#7c5cff", emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.1, opacity: 0.85, size: { radius: 0.6, height: 3 }, repeat: { count: 40, pattern: "scatter", radius: 14, spacing: 0, jitter: 0.5, seed } }),
      obj({ id: "heart", shape: "icosahedron", color: "#22d3ee", emissive: "#22d3ee", emissiveIntensity: 2, position: [0, 3, 0], size: { radius: 1.2 }, animate: { type: "spin", speed: 0.6, amount: 0 }, flat: true }),
    ],
  }),
  runway: () => ({
    background: "#0e0b14", fog: { color: "#0e0b14", near: 18, far: 60 },
    camera: { position: [10, 4.5, 14], target: [0, 1.6, -2], fov: 45 },
    lights: [{ type: "ambient", color: "#4a3d63", intensity: 0.5, position: [0, 0, 0] }, { type: "spot", color: "#fff4e0", intensity: 260, position: [0, 9, 4] }, { type: "spot", color: "#b98cff", intensity: 160, position: [-6, 7, -6] }],
    objects: [
      obj({ id: "stage", shape: "box", color: "#1d1826", metalness: 0.6, roughness: 0.25, position: [0, 0.15, -4], size: { width: 4, height: 0.3, depth: 24 } }),
      obj({ id: "edge-lights", shape: "sphere", color: "#ffe9b0", emissive: "#ffe9b0", emissiveIntensity: 3, size: { radius: 0.08 }, position: [2.1, 0.32, -4], repeat: { count: 24, pattern: "line", radius: 0, spacing: 1, jitter: 0, seed: 1 } }),
      obj({ id: "look-1", shape: "garment", color: "#d4a94e", metalness: 0.4, roughness: 0.4, position: [0, 0.3, 1], size: { height: 1.7, flare: 1.3 } }),
      obj({ id: "look-2", shape: "garment", color: "#b98cff", position: [0, 0.3, -5], size: { height: 1.75, flare: 0.8 } }),
      obj({ id: "look-3", shape: "garment", color: "#f4f0ff", position: [0, 0.3, -11], size: { height: 1.7, flare: 1.8 } }),
    ],
  }),
};

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

export interface BuiltScene {
  scene: ThreeNS.Scene;
  camera: ThreeNS.PerspectiveCamera;
  clips: ThreeNS.AnimationClip[];
  stats: { meshes: number; triangles: number; lights: number; animated: number };
}

function placements(o: SceneObject): Array<{ p: Vec3; r: number; s: number }> {
  const out: Array<{ p: Vec3; r: number; s: number }> = [];
  const rep = o.repeat;
  if (!rep) return [{ p: o.position, r: 0, s: 1 }];
  const random = rng(rep.seed);
  const n = Math.min(rep.count, LIMITS3D.instances);
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i += 1) {
    let x = 0, z = 0;
    if (rep.pattern === "ring") { const t = (i / n) * Math.PI * 2; x = Math.cos(t) * rep.radius; z = Math.sin(t) * rep.radius; }
    else if (rep.pattern === "grid") { x = ((i % side) - (side - 1) / 2) * rep.spacing; z = (Math.floor(i / side) - (side - 1) / 2) * rep.spacing; }
    else if (rep.pattern === "line") { z = -i * rep.spacing; }
    else if (rep.pattern === "spiral") { const t = i * 2.4; const r = rep.radius + i * rep.spacing; x = Math.cos(t) * r; z = Math.sin(t) * r; }
    else { const t = random() * Math.PI * 2; const r = Math.sqrt(random()) * rep.radius; x = Math.cos(t) * r; z = Math.sin(t) * r; }
    const j = rep.jitter * (rep.spacing || rep.radius * 0.2 || 1);
    x += (random() - 0.5) * j; z += (random() - 0.5) * j;
    out.push({ p: [o.position[0] + x, o.position[1], o.position[2] + z], r: random() * Math.PI * 2, s: 1 - rep.jitter * 0.5 + random() * rep.jitter });
  }
  return out;
}

/** Height of procedural terrain at (x, z), so repeated objects sit on the ground. */
function terrainHeight(o: SceneObject, x: number, z: number): number {
  const noise = noise2D(seedFrom(o.id));
  const h = o.size.height ?? 3;
  const detail = o.size.detail ?? 1;
  let y = fbm(noise, x * 0.05 * detail, z * 0.05 * detail, 4) * h;
  if (o.size.island) {
    const w = (o.size.width ?? 20) / 2;
    const d = Math.hypot(x, z) / w;
    y = (y * 0.4 + h) * Math.max(0, 1 - d * d) - h * 0.3;
  }
  return y + o.position[1];
}

export function buildScene(program: Scene3DProgram, T: THREE): BuiltScene {
  const scene = new T.Scene();
  scene.name = "LELU Scene";
  scene.background = new T.Color(program.background);
  if (program.fog) scene.fog = new T.Fog(program.fog.color, program.fog.near, program.fog.far);
  const stats = { meshes: 0, triangles: 0, lights: 0, animated: 0 };
  const clips: ThreeNS.AnimationClip[] = [];
  const tracks: ThreeNS.KeyframeTrack[] = [];
  const terrain = program.objects.find((o) => o.shape === "terrain" && !o.repeat);

  const material = (o: SceneObject, overrideColor?: string) => new T.MeshStandardMaterial({
    color: overrideColor ?? o.color, metalness: o.metalness, roughness: o.roughness,
    ...(o.emissive ? { emissive: new T.Color(o.emissive), emissiveIntensity: o.emissiveIntensity ?? 1 } : {}),
    transparent: o.opacity < 1, opacity: o.opacity, wireframe: o.wireframe === true, flatShading: o.flat === true,
    side: o.shape === "plane" || o.shape === "garment" ? T.DoubleSide : T.FrontSide,
  });
  const mesh = (geo: ThreeNS.BufferGeometry, mat: ThreeNS.Material, name: string) => {
    const m = new T.Mesh(geo, mat);
    m.name = name;
    stats.meshes += 1;
    stats.triangles += geo.index ? geo.index.count / 3 : (geo.getAttribute("position")?.count ?? 0) / 3;
    return m;
  };

  const primitive = (o: SceneObject): ThreeNS.BufferGeometry => {
    const s = o.size;
    switch (o.shape) {
      case "box": return new T.BoxGeometry(s.width ?? 1, s.height ?? 1, s.depth ?? 1);
      case "sphere": return new T.SphereGeometry(s.radius ?? 0.5, Math.round(s.segments ?? 32), Math.round((s.segments ?? 32) / 2));
      case "cylinder": return new T.CylinderGeometry(s.radiusTop ?? s.radius ?? 0.5, s.radiusBottom ?? s.radius ?? 0.5, s.height ?? 1, Math.round(s.segments ?? 32));
      case "cone": return new T.ConeGeometry(s.radius ?? 0.5, s.height ?? 1, Math.round(s.segments ?? 32));
      case "torus": return new T.TorusGeometry(s.radius ?? 1, s.tube ?? 0.3, 24, Math.round(s.segments ?? 96));
      case "torusKnot": return new T.TorusKnotGeometry(s.radius ?? 1, s.tube ?? 0.3, Math.round(s.segments ?? 160), 20, s.p ?? 2, s.q ?? 3);
      case "plane": return new T.PlaneGeometry(s.width ?? 10, s.height ?? 10);
      case "capsule": return new T.CapsuleGeometry(s.radius ?? 0.4, s.height ?? 1, 8, 16);
      case "icosahedron": return new T.IcosahedronGeometry(s.radius ?? 0.6, Math.round(s.detail ?? 0));
      case "dodecahedron": return new T.DodecahedronGeometry(s.radius ?? 0.6, Math.round(s.detail ?? 0));
      case "octahedron": return new T.OctahedronGeometry(s.radius ?? 0.6, Math.round(s.detail ?? 0));
      case "ring": return new T.RingGeometry(s.inner ?? 0.5, s.radius ?? 1, Math.round(s.segments ?? 64));
      default: return new T.BoxGeometry(1, 1, 1);
    }
  };

  const compound = (o: SceneObject, seed: number): ThreeNS.Object3D => {
    const g = new T.Group();
    const s = o.size;
    const random = rng(seed);
    if (o.shape === "terrain") {
      const segs = Math.round(clamp(s.segments ?? 64, 8, 256));
      const geo = new T.PlaneGeometry(s.width ?? 40, s.depth ?? 40, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i += 1) pos.setY(i, terrainHeight(o, pos.getX(i), pos.getZ(i)) - o.position[1]);
      geo.computeVertexNormals();
      g.add(mesh(geo, material(o), `${o.id}-surface`));
    } else if (o.shape === "tree") {
      const h = s.height ?? 5;
      const trunk = mesh(new T.CylinderGeometry(h * 0.03, h * 0.05, h * 0.45, 7), new T.MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.9 }), `${o.id}-trunk`);
      trunk.position.y = h * 0.225;
      g.add(trunk);
      if (s.palm) {
        for (let k = 0; k < 6; k += 1) {
          const leaf = mesh(new T.ConeGeometry(h * 0.08, h * 0.5, 4), material(o), `${o.id}-frond-${k}`);
          leaf.position.y = h * 0.47;
          leaf.rotation.set(Math.PI / 2.6, (k / 6) * Math.PI * 2, 0, "YXZ");
          leaf.translateY(h * 0.22);
          g.add(leaf);
        }
      } else {
        const tiers = 3 + Math.floor(random() * 2);
        for (let k = 0; k < tiers; k += 1) {
          const r = h * (0.32 - k * 0.06);
          const cone = mesh(new T.ConeGeometry(r, h * 0.38, 9), material(o, k % 2 ? new T.Color(o.color).offsetHSL(0, 0, 0.05).getStyle() : undefined), `${o.id}-crown-${k}`);
          cone.position.y = h * (0.42 + k * 0.17);
          g.add(cone);
        }
      }
    } else if (o.shape === "rock") {
      const geo = new T.IcosahedronGeometry(s.radius ?? 1, 2);
      const pos = geo.getAttribute("position");
      const noise = noise2D(seed);
      for (let i = 0; i < pos.count; i += 1) {
        const k = 1 + fbm(noise, pos.getX(i) * 1.7 + seed % 13, pos.getZ(i) * 1.7 + pos.getY(i), 3) * 0.45;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const m = mesh(geo, material(o), `${o.id}-stone`);
      m.position.y = (s.radius ?? 1) * 0.3;
      g.add(m);
    } else if (o.shape === "building") {
      const floors = Math.round(clamp((s.floors ?? 8) * (0.4 + random() * 1.2), 2, 120));
      const w = s.width ?? 3, d = s.depth ?? 3, fh = 0.9;
      const body = mesh(new T.BoxGeometry(w, floors * fh, d), material(o), `${o.id}-body`);
      body.position.y = (floors * fh) / 2;
      g.add(body);
      const lit = new T.MeshStandardMaterial({ color: o.emissive ?? "#ffcf7a", emissive: new T.Color(o.emissive ?? "#ffcf7a"), emissiveIntensity: o.emissiveIntensity ?? 0.8 });
      for (let f2 = 1; f2 < floors; f2 += 2) {
        if (random() < 0.35) continue;
        const band = mesh(new T.BoxGeometry(w * 1.01, fh * 0.25, d * 1.01), lit, `${o.id}-windows-${f2}`);
        band.position.y = f2 * fh;
        g.add(band);
      }
      if (random() < 0.4) {
        const spire = mesh(new T.ConeGeometry(w * 0.15, floors * fh * 0.25, 6), material(o), `${o.id}-spire`);
        spire.position.y = floors * fh + floors * fh * 0.125;
        g.add(spire);
      }
    } else if (o.shape === "crystal") {
      const h = (s.height ?? 2) * (0.6 + random() * 0.8);
      const geo = new T.OctahedronGeometry(s.radius ?? 0.5, 0);
      geo.scale(1, h / (s.radius ?? 0.5) / 2, 1);
      geo.computeVertexNormals();
      const m = mesh(geo, material(o), `${o.id}-shard`);
      m.position.y = h / 2;
      m.rotation.set((random() - 0.5) * 0.5, random() * Math.PI, (random() - 0.5) * 0.5);
      g.add(m);
    } else if (o.shape === "garment") {
      // A dress form: a lathe silhouette (bodice → waist → flared skirt) on a stand.
      const h = s.height ?? 1.7, flare = s.flare ?? 1;
      const profile = [[0.001, 0], [0.32 * flare, 0.02], [0.3 * flare, 0.18], [0.24 * flare * 0.9 + 0.05, 0.42], [0.13, 0.6], [0.16, 0.72], [0.18, 0.84], [0.1, 0.94], [0.05, 0.97], [0.001, 0.98]]
        .map(([r, y]) => new T.Vector2(r * h * 0.55, y * h * 0.62 + h * 0.36));
      g.add(mesh(new T.LatheGeometry(profile, 48), material(o), `${o.id}-form`));
      const pole = mesh(new T.CylinderGeometry(0.02, 0.02, h * 0.4, 8), new T.MeshStandardMaterial({ color: "#c0c4cc", metalness: 0.9, roughness: 0.2 }), `${o.id}-stand`);
      pole.position.y = h * 0.2;
      g.add(pole);
      const base = mesh(new T.CylinderGeometry(0.22, 0.26, 0.04, 24), new T.MeshStandardMaterial({ color: "#c0c4cc", metalness: 0.9, roughness: 0.2 }), `${o.id}-base`);
      base.position.y = 0.02;
      g.add(base);
    } else if (o.shape === "water") {
      const geo = new T.CircleGeometry(s.radius ?? 10, 96);
      geo.rotateX(-Math.PI / 2);
      g.add(mesh(geo, material(o), `${o.id}-surface`));
    } else if (o.shape === "stars") {
      const count = Math.round(clamp(s.count ?? 1000, 10, 20000));
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        const u = random() * 2 - 1, t = random() * Math.PI * 2, r = (s.radius ?? 100) * (0.6 + random() * 0.4);
        const q = Math.sqrt(1 - u * u);
        arr.set([Math.cos(t) * q * r, u * r, Math.sin(t) * q * r], i * 3);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(arr, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color: o.color, size: 0.6, sizeAttenuation: true }));
      pts.name = `${o.id}-points`;
      g.add(pts);
    } else if (o.shape === "text-pillar") {
      const h = s.height ?? 6, w = s.width ?? 1;
      const m = mesh(new T.CylinderGeometry(w * 0.3, w * 0.6, h, 4), material(o), `${o.id}-shaft`);
      m.position.y = h / 2;
      g.add(m);
      const cap = mesh(new T.OctahedronGeometry(w * 0.45, 0), material(o), `${o.id}-cap`);
      cap.position.y = h + w * 0.3;
      g.add(cap);
    }
    return g;
  };

  for (const o of program.objects) {
    const group = new T.Group();
    group.name = o.id;
    const isCompound = (COMPOUNDS as readonly string[]).includes(o.shape);
    const sharedGeo = isCompound ? null : primitive(o);
    const sharedMat = isCompound ? null : material(o);
    placements(o).forEach((pl, i) => {
      const item: ThreeNS.Object3D = isCompound ? compound(o, (o.repeat?.seed ?? program.seed) + i * 131) : mesh(sharedGeo!, sharedMat!, `${o.id}-mesh`);
      item.name = o.repeat ? `${o.id}-${i + 1}` : `${o.id}-node`;
      const y = terrain && o !== terrain && o.repeat ? terrainHeight(terrain, pl.p[0], pl.p[2]) : pl.p[1];
      item.position.set(pl.p[0], y, pl.p[2]);
      item.rotation.set(T.MathUtils.degToRad(o.rotation[0]), T.MathUtils.degToRad(o.rotation[1]) + (o.repeat && isCompound ? pl.r : 0), T.MathUtils.degToRad(o.rotation[2]));
      item.scale.set(o.scale[0] * pl.s, o.scale[1] * pl.s, o.scale[2] * pl.s);
      group.add(item);
      if (o.animate) {
        stats.animated += 1;
        const period = program.duration;
        const times = [0, period / 4, period / 2, (period * 3) / 4, period];
        const a = o.animate;
        if (a.type === "spin") {
          const q = (t: number) => new T.Quaternion().setFromEuler(new T.Euler(item.rotation.x, item.rotation.y + t * Math.PI * 2 * a.speed, item.rotation.z)).toArray();
          tracks.push(new T.QuaternionKeyframeTrack(`${item.name}.quaternion`, times, times.flatMap((t) => q(t / period))));
        } else if (a.type === "bob") {
          tracks.push(new T.VectorKeyframeTrack(`${item.name}.position`, times, times.flatMap((t) => [item.position.x, item.position.y + Math.sin((t / period) * Math.PI * 2 * Math.max(1, Math.round(a.speed))) * a.amount, item.position.z])));
        } else if (a.type === "pulse") {
          tracks.push(new T.VectorKeyframeTrack(`${item.name}.scale`, times, times.flatMap((t) => { const k = 1 + Math.sin((t / period) * Math.PI * 2) * Math.min(0.9, a.amount); return [item.scale.x * k, item.scale.y * k, item.scale.z * k]; })));
        } else if (a.type === "orbit") {
          const r = Math.hypot(item.position.x, item.position.z), base = Math.atan2(item.position.z, item.position.x);
          const steps = Array.from({ length: 17 }, (_, k) => (k / 16) * period);
          tracks.push(new T.VectorKeyframeTrack(`${item.name}.position`, steps, steps.flatMap((t) => { const ang = base + (t / period) * Math.PI * 2 * Math.max(1, Math.round(a.speed * 5)) / 5; return [Math.cos(ang) * r, item.position.y, Math.sin(ang) * r]; })));
        }
      }
    });
    scene.add(group);
  }
  if (tracks.length) clips.push(new T.AnimationClip("lelu-animation", program.duration, tracks));

  for (const [i, l] of program.lights.entries()) {
    let light: ThreeNS.Light;
    if (l.type === "ambient") light = new T.AmbientLight(l.color, l.intensity);
    else if (l.type === "hemisphere") light = new T.HemisphereLight(l.color, l.ground ?? "#222222", l.intensity);
    else if (l.type === "point") light = new T.PointLight(l.color, l.intensity, 0, 2);
    else if (l.type === "spot") light = new T.SpotLight(l.color, l.intensity, 0, Math.PI / 6, 0.4, 2);
    else light = new T.DirectionalLight(l.color, l.intensity);
    light.name = `light-${i + 1}-${l.type}`;
    light.position.set(...l.position);
    const aimed = light as ThreeNS.DirectionalLight;
    if (aimed.target) {
      // glTF lights shine down their local -Z: aim the light at the scene's
      // centre and keep its target as a child at (0,0,-1), which is what
      // both the renderer and GLTFExporter read.
      light.lookAt(0, 0, 0);
      aimed.target.position.set(0, 0, -1);
      light.add(aimed.target);
    }
    scene.add(light);
    stats.lights += 1;
  }

  const camera = new T.PerspectiveCamera(program.camera.fov, 16 / 9, 0.1, 2000);
  camera.name = "LELU Camera";
  camera.position.set(...program.camera.position);
  camera.lookAt(new T.Vector3(...program.camera.target));
  scene.add(camera);
  stats.triangles = Math.round(stats.triangles);
  return { scene, camera, clips, stats };
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/** GLTFExporter reads Blobs through FileReader; give non-browser runtimes a faithful minimal one. */
function ensureFileReader(): void {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  class MinimalFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onload?.(); this.onloadend?.(); }, (e) => this.onerror?.(e)); }
    readAsDataURL(blob: Blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); this.onloadend?.(); }, (e) => this.onerror?.(e)); }
  }
  g.FileReader = MinimalFileReader;
}

export async function exportScene(program: Scene3DProgram, format: "glb" | "gltf"): Promise<{ bytes: Uint8Array; stats: BuiltScene["stats"] }> {
  ensureFileReader();
  const T = await import("three");
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const built = buildScene(program, T);
  // glTF (KHR_lights_punctual) has no ambient or hemisphere light: leave them
  // out of the file rather than have the exporter drop them with a warning.
  const ambient: ThreeNS.Object3D[] = [];
  built.scene.traverse((o) => { if ((o as ThreeNS.AmbientLight).isAmbientLight || (o as ThreeNS.HemisphereLight).isHemisphereLight) ambient.push(o); });
  for (const o of ambient) o.removeFromParent();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(built.scene, { binary: format === "glb", animations: built.clips, onlyVisible: true });
  const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : new TextEncoder().encode(JSON.stringify(result, null, 2));
  disposeScene(built.scene);
  return { bytes, stats: built.stats };
}

/** Read back a GLB: magic, version, length and the JSON chunk's node/mesh counts. */
export function inspectGlb(bytes: Uint8Array): { ok: boolean; version?: number; nodes?: number; meshes?: number; animations?: number; reason?: string } {
  if (bytes.byteLength < 20) return { ok: false, reason: "file too small" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return { ok: false, reason: "not a GLB (magic)" };
  const version = view.getUint32(4, true);
  if (view.getUint32(8, true) !== bytes.byteLength) return { ok: false, reason: "declared length differs from file size" };
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) return { ok: false, reason: "first chunk is not JSON" };
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as { nodes?: unknown[]; meshes?: unknown[]; animations?: unknown[] };
  return { ok: true, version, nodes: json.nodes?.length ?? 0, meshes: json.meshes?.length ?? 0, animations: json.animations?.length ?? 0 };
}

export function disposeScene(root: ThreeNS.Object3D): void {
  root.traverse((child) => {
    const m = child as ThreeNS.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
}
