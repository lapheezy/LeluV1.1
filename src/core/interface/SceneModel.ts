/**
 * ==========================================================
 * LÉLU — COSMOS SCENE MODEL
 *
 * The 3D objects LÉLU composes into the live Cosmos canvas:
 * planets (with rings, atmospheres, moons), nebulae, crystals,
 * botanical forms, orbs, rivers, particle fields, artboards,
 * lights and imported glTF models — each with material,
 * animation and an optional LINK to something real (a
 * conversation, a module window, a project), which is what
 * makes an object interactive: selecting a workspace planet
 * opens that workspace.
 *
 * Pure data + validation. The Genesis canvas renders it
 * (InterfaceSceneLayer); nothing here imports three.js.
 * ==========================================================
 */

import { isHexColor } from "./DesignTokens";

export type Vec3 = [number, number, number];

export const SCENE_KINDS = [
  "planet",
  "moon",
  "star",
  "nebula",
  "crystal",
  "flora",
  "orb",
  "river",
  "particles",
  "artboard",
  "model",
  "light",
] as const;
export type SceneObjectKind = (typeof SCENE_KINDS)[number];

export type SceneAnimation = "none" | "spin" | "orbit" | "bob" | "pulse" | "sway" | "drift";

export interface SceneMaterial {
  roughness: number;
  metalness: number;
  emissiveIntensity: number;
  opacity: number;
  wireframe: boolean;
}

export interface SceneLink {
  kind: "conversation" | "module" | "project";
  id: string;
  label?: string;
}

export interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  label?: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  color: string;
  secondaryColor?: string;
  material: SceneMaterial;
  animation: { type: SceneAnimation; speed: number };
  features: { rings?: boolean; atmosphere?: boolean; moons?: number; petals?: number; count?: number };
  link?: SceneLink;
  /** https .glb/.gltf for kind "model". */
  url?: string;
  /** Who composed it: "preset:<id>" for environment decorations, else LÉLU/user. */
  source?: string;
}

export interface SceneCamera {
  position: Vec3;
  target: Vec3;
}

export interface SceneState {
  objects: SceneObject[];
  camera?: SceneCamera;
}

export interface WorkspaceRef {
  kind: "conversation" | "module" | "project";
  id: string;
  title: string;
  active?: boolean;
}

/** A loose description of an object: every nested field optional. */
export type SceneObjectInput = Omit<Partial<SceneObject>, "material" | "animation"> & {
  material?: Partial<SceneMaterial>;
  animation?: Partial<SceneObject["animation"]>;
};

export type SceneOp =
  | { op: "add"; object: SceneObjectInput & { kind: SceneObjectKind } }
  | { op: "update"; id: string; changes: SceneObjectInput }
  | { op: "remove"; id: string }
  | { op: "clear" }
  | { op: "camera"; position: Vec3; target?: Vec3 }
  | { op: "populate"; from: "workspaces"; kind?: SceneObjectKind; limit?: number; radius?: number };

export const MAX_SCENE_OBJECTS = 60;
const LIMIT = 40;

export const EMPTY_SCENE: SceneState = { objects: [] };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

function vec(v: unknown, fallback: Vec3, bound = LIMIT): Vec3 {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [clamp(v[0], -bound, bound), clamp(v[1], -bound, bound), clamp(v[2], -bound, bound)];
  }
  if (v && typeof v === "object" && "x" in v) {
    const o = v as { x?: unknown; y?: unknown; z?: unknown };
    return vec([o.x, o.y, o.z], fallback, bound);
  }
  return fallback;
}

const KIND_DEFAULTS: Record<SceneObjectKind, { color: string; scale: number; animation: SceneAnimation }> = {
  planet: { color: "#60a5fa", scale: 0.55, animation: "spin" },
  moon: { color: "#cbd5e1", scale: 0.18, animation: "orbit" },
  star: { color: "#fde68a", scale: 0.35, animation: "pulse" },
  nebula: { color: "#f9a8d4", scale: 3, animation: "drift" },
  crystal: { color: "#a5f3fc", scale: 0.45, animation: "spin" },
  flora: { color: "#86efac", scale: 0.6, animation: "sway" },
  orb: { color: "#c4b5fd", scale: 0.35, animation: "bob" },
  river: { color: "#7dd3fc", scale: 4, animation: "drift" },
  particles: { color: "#e0f2fe", scale: 6, animation: "drift" },
  artboard: { color: "#f8fafc", scale: 1.2, animation: "bob" },
  model: { color: "#ffffff", scale: 1, animation: "none" },
  light: { color: "#ffffff", scale: 1, animation: "none" },
};

let counter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Build a validated object from a partial description. */
export function normaliseObject(input: SceneObjectInput & { kind?: string }, issues: string[], existing?: SceneObject): SceneObject | null {
  const kind = (existing?.kind ?? input.kind) as SceneObjectKind;
  if (!(SCENE_KINDS as readonly string[]).includes(kind)) {
    issues.push(`"${String(input.kind)}" is not a scene object kind (${SCENE_KINDS.join(", ")})`);
    return null;
  }
  const d = KIND_DEFAULTS[kind];
  const base: SceneObject = existing ?? {
    id: newId(kind),
    kind,
    position: [0, 0, -3],
    rotation: [0, 0, 0],
    scale: d.scale,
    color: d.color,
    material: { roughness: 0.6, metalness: 0.1, emissiveIntensity: kind === "star" || kind === "orb" ? 0.8 : 0.15, opacity: kind === "nebula" ? 0.35 : 1, wireframe: false },
    animation: { type: d.animation, speed: 1 },
    features: kind === "planet" ? { atmosphere: true } : {},
  };
  const color = input.color === undefined ? base.color : isHexColor(input.color) ? input.color : (issues.push(`${kind}: colour "${input.color}" is not #rrggbb`), base.color);
  const secondary = input.secondaryColor === undefined ? base.secondaryColor : isHexColor(input.secondaryColor) ? input.secondaryColor : base.secondaryColor;
  const m = (input.material ?? {}) as Partial<SceneMaterial>;
  const a = (input.animation ?? {}) as Partial<SceneObject["animation"]>;
  const f = (input.features ?? {}) as SceneObject["features"];
  const animations: SceneAnimation[] = ["none", "spin", "orbit", "bob", "pulse", "sway", "drift"];

  let url = existing?.url;
  if (kind === "model") {
    const candidate = typeof input.url === "string" ? input.url.trim() : url;
    if (!candidate || !/^(https:\/\/|\/)[^\s"'<>]+\.(glb|gltf)(\?[^\s"'<>]*)?$/i.test(candidate)) {
      issues.push("a model needs an https (or same-origin /path) URL to a .glb or .gltf file");
      return null;
    }
    url = candidate;
  }

  let link = existing?.link;
  if (input.link !== undefined) {
    const l = input.link as Partial<SceneLink> | null;
    link = l && (l.kind === "conversation" || l.kind === "module" || l.kind === "project") && typeof l.id === "string" ? { kind: l.kind, id: l.id, ...(l.label ? { label: String(l.label).slice(0, 80) } : {}) } : undefined;
  }

  return {
    ...base,
    id: existing?.id ?? (typeof input.id === "string" && /^[\w-]{1,48}$/.test(input.id) ? input.id : base.id),
    label: typeof input.label === "string" ? input.label.slice(0, 80) : base.label,
    position: vec(input.position, base.position),
    rotation: vec(input.rotation, base.rotation, Math.PI * 2),
    scale: num(input.scale, base.scale, 0.02, 12),
    color,
    ...(secondary ? { secondaryColor: secondary } : {}),
    material: {
      roughness: num(m.roughness, base.material.roughness, 0, 1),
      metalness: num(m.metalness, base.material.metalness, 0, 1),
      emissiveIntensity: num(m.emissiveIntensity, base.material.emissiveIntensity, 0, 4),
      opacity: num(m.opacity, base.material.opacity, 0.05, 1),
      wireframe: typeof m.wireframe === "boolean" ? m.wireframe : base.material.wireframe,
    },
    animation: {
      type: animations.includes(a.type as SceneAnimation) ? (a.type as SceneAnimation) : base.animation.type,
      speed: num(a.speed, base.animation.speed, 0, 5),
    },
    features: {
      ...base.features,
      ...(typeof f.rings === "boolean" ? { rings: f.rings } : {}),
      ...(typeof f.atmosphere === "boolean" ? { atmosphere: f.atmosphere } : {}),
      ...(typeof f.moons === "number" ? { moons: clamp(Math.round(f.moons), 0, 4) } : {}),
      ...(typeof f.petals === "number" ? { petals: clamp(Math.round(f.petals), 3, 12) } : {}),
      ...(typeof f.count === "number" ? { count: clamp(Math.round(f.count), 10, 1500) } : {}),
    },
    ...(link ? { link } : {}),
    ...(url ? { url } : {}),
    ...(typeof input.source === "string" && /^[\w:-]{1,48}$/.test(input.source) ? { source: input.source } : existing?.source ? { source: existing.source } : {}),
  };
}

const WORKSPACE_PALETTE = ["#f9a8d4", "#93c5fd", "#c4b5fd", "#86efac", "#fcd34d", "#fda4af"];

export interface SceneApplyResult {
  scene: SceneState;
  issues: string[];
  changes: string[];
  removed: number;
}

/** Apply scene operations, returning a NEW scene (the input is untouched). */
export function applySceneOps(scene: SceneState, ops: SceneOp[], workspaces: WorkspaceRef[], accents: string[] = WORKSPACE_PALETTE): SceneApplyResult {
  const issues: string[] = [];
  const changes: string[] = [];
  let removed = 0;
  const next: SceneState = { objects: scene.objects.map((o) => structuredClone(o)), ...(scene.camera ? { camera: structuredClone(scene.camera) } : {}) };

  for (const op of ops) {
    switch (op?.op) {
      case "add": {
        if (next.objects.length >= MAX_SCENE_OBJECTS) {
          issues.push(`the scene already holds ${MAX_SCENE_OBJECTS} objects`);
          break;
        }
        const object = normaliseObject(op.object ?? ({} as never), issues);
        if (!object) break;
        if (next.objects.some((o) => o.id === object.id)) object.id = newId(object.kind);
        next.objects.push(object);
        changes.push(`add ${object.kind}${object.label ? ` "${object.label}"` : ""}${object.link ? ` linked to ${object.link.kind} ${object.link.label ?? object.link.id}` : ""}`);
        break;
      }
      case "update": {
        const index = next.objects.findIndex((o) => o.id === op.id);
        if (index < 0) {
          issues.push(`no scene object "${op.id}"`);
          break;
        }
        const object = normaliseObject(op.changes ?? {}, issues, next.objects[index]);
        if (object) {
          next.objects[index] = object;
          changes.push(`update ${object.kind} "${object.label ?? object.id}"`);
        }
        break;
      }
      case "remove": {
        const before = next.objects.length;
        next.objects = next.objects.filter((o) => o.id !== op.id);
        if (next.objects.length === before) issues.push(`no scene object "${op.id}"`);
        else {
          removed += 1;
          changes.push(`remove ${op.id}`);
        }
        break;
      }
      case "clear":
        removed += next.objects.length;
        if (next.objects.length) changes.push(`remove all ${next.objects.length} scene objects`);
        next.objects = [];
        break;
      case "camera":
        next.camera = { position: vec(op.position, [0, 0, 6.8], 60), target: vec(op.target, [0, 0, 0], 60) };
        changes.push(`camera to [${next.camera.position.join(", ")}]`);
        break;
      case "populate": {
        const kind = (op.kind && (SCENE_KINDS as readonly string[]).includes(op.kind) ? op.kind : "planet") as SceneObjectKind;
        const pool = workspaces.slice(0, clamp(op.limit ?? workspaces.length, 1, 12));
        if (!pool.length) {
          issues.push("there are no active workspaces to build objects for");
          break;
        }
        const radius = num(op.radius, 2.6, 1, 12);
        pool.forEach((ws, i) => {
          const angle = (i / pool.length) * Math.PI * 2 - Math.PI / 2;
          const object = normaliseObject(
            {
              kind,
              label: ws.title,
              position: [Math.cos(angle) * radius, Math.sin(i * 1.7) * 0.6 + 0.4, -2.4 + Math.sin(angle) * radius * 0.5],
              scale: ws.active ? 0.62 : 0.5,
              color: accents[i % accents.length],
              features: kind === "planet" ? { atmosphere: true, rings: i % 2 === 1, moons: i % 3 } : {},
              animation: { type: kind === "planet" ? "spin" : "bob", speed: 0.6 + i * 0.15 },
              link: { kind: ws.kind, id: ws.id, label: ws.title },
            },
            issues,
          );
          if (object) {
            next.objects.push(object);
            changes.push(`add ${kind} "${ws.title}" linked to ${ws.kind} ${ws.id}`);
          }
        });
        break;
      }
      default:
        issues.push(`unknown scene operation ${JSON.stringify(op)}`);
    }
  }
  return { scene: next, issues, changes, removed };
}

export function describeScene(scene: SceneState): string {
  if (!scene.objects.length) return "No LÉLU-composed objects in the Cosmos yet (the native Genesis cosmos is unchanged).";
  return scene.objects
    .map((o) => `${o.id}: ${o.kind}${o.label ? ` "${o.label}"` : ""} ${o.color} scale ${o.scale} at [${o.position.map((n) => n.toFixed(1)).join(", ")}], ${o.animation.type}${o.link ? `, opens ${o.link.kind} ${o.link.id}` : ""}`)
    .join("\n");
}
