/**
 * ==========================================================
 * LÉLU — ROOM BUILDER
 *
 * Spec → buildable room. Pure, deterministic, renderer-agnostic.
 *
 * The builder is what stops the renderer from being the only
 * definition of a room: it resolves what every object occupies,
 * what the avatar can walk through, what can be interacted with,
 * and how much the room costs to draw — all of which the 3D view
 * and the mobile budget check both need, and which the Blender
 * exporter must agree with.
 *
 * No three.js import lives here on purpose: the output is data, so
 * it can be asserted in a test without a GPU.
 * ==========================================================
 */

import type { Vec3, WorldMaterial, WorldNode, WorldPrimitiveKind, WorldRole, WorldSpec } from "./WorldSpec";

export type Footprint =
  /** Round footprint, used by the radial room furniture. */
  | { kind: "circle"; x: number; z: number; radius: number }
  | { kind: "rect"; x: number; z: number; halfWidth: number; halfDepth: number; rotationY: number };

export type BuiltObject = {
  id: string;
  name: string;
  role: WorldRole;
  primitive: WorldPrimitiveKind;
  position: Vec3;
  rotationY: number;
  scale: Vec3;
  materialId: string;
  material: WorldMaterial;
  footprint: Footprint;
  /** Objects that block the avatar (floor/ceiling/plants do not). */
  blocksMovement: boolean;
  /** Height the top of the object reaches, for camera/aim use. */
  top: number;
};

export type BuiltLight = {
  id: string;
  kind: WorldSpec["lights"][number]["kind"];
  color: Vec3;
  intensity: number;
  position: Vec3;
  target?: Vec3;
  distance?: number;
};

export type InteractionPoint = {
  objectId: string;
  prompt: string;
  kind: NonNullable<WorldNode["interaction"]>["kind"];
  position: Vec3;
  /** Where the avatar should stand to use it. */
  standAt: [number, number];
};

export type RoomStats = {
  objects: number;
  lights: number;
  /** Meshes grouped by material — the minimum draw calls a renderer needs. */
  drawCalls: number;
  /** Rough triangle budget, to catch a room that cannot run on a phone. */
  triangles: number;
  interactives: number;
};

export type RoomModel = {
  specId: string;
  name: string;
  objects: BuiltObject[];
  lights: BuiltLight[];
  interactions: InteractionPoint[];
  /** Walkable area, already clear of the permanent furniture. */
  nav: WorldSpec["nav"];
  bounds: { min: Vec3; max: Vec3; centre: Vec3; radius: number };
  stats: RoomStats;
  problems: string[];
};

/** Rough triangle cost per primitive at scale 1 — good enough to budget. */
const BASE_TRIANGLES: Record<WorldPrimitiveKind, number> = {
  box: 12,
  cylinder: 96,
  sphere: 320,
  torus: 384,
  cone: 48,
  ring: 384,
};

/** Roles the avatar may pass through. Everything else is solid. */
const PASSABLE_ROLES: ReadonlySet<WorldRole> = new Set<WorldRole>(["floor", "ceiling", "plant", "light-fixture", "ring"]);

function footprintOf(node: WorldNode): Footprint {
  const [x, , z] = node.position;
  const [sx, , sz] = node.scale;
  if (node.primitive === "cylinder" || node.primitive === "sphere" || node.primitive === "cone" || node.primitive === "torus" || node.primitive === "ring") {
    return { kind: "circle", x, z, radius: Math.max(sx, sz) };
  }
  return { kind: "rect", x, z, halfWidth: Math.abs(sx) / 2, halfDepth: Math.abs(sz) / 2, rotationY: node.rotationY };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Build the room from its spec. Deterministic: same spec in, same model out,
 * so a saved room reloads identically and a diff of two builds is meaningful.
 */
export function buildRoom(spec: WorldSpec): RoomModel {
  const materials = new Map(spec.materials.map((material) => [material.id, material]));
  const problems: string[] = [];

  const objects: BuiltObject[] = spec.nodes.map((node) => {
    const material = materials.get(node.material);
    if (!material) problems.push(`Node “${node.id}” references missing material “${node.material}”`);
    return {
      id: node.id,
      name: node.name,
      role: node.role,
      primitive: node.primitive,
      position: [round(node.position[0]), round(node.position[1]), round(node.position[2])],
      rotationY: round(node.rotationY),
      scale: [round(node.scale[0]), round(node.scale[1]), round(node.scale[2])],
      materialId: node.material,
      material: material ?? { id: node.material, name: node.material, color: [1, 0, 1], metalness: 0, roughness: 1 },
      footprint: footprintOf(node),
      blocksMovement: !PASSABLE_ROLES.has(node.role),
      top: node.position[1] + Math.abs(node.scale[1]) / 2,
    };
  });

  const interactions: InteractionPoint[] = spec.nodes
    .filter((node): node is WorldNode & { interaction: NonNullable<WorldNode["interaction"]> } => Boolean(node.interaction))
    .map((node) => {
      const [x, , z] = node.position;
      const distance = Math.hypot(x, z) || 1;
      /* Stand on the near side of the object, at a conversational distance. */
      const offset = Math.max(1.6, Math.max(Math.abs(node.scale[0]), Math.abs(node.scale[2])) / 2 + 1.2);
      const reach = Math.min(spec.nav.radius - 0.5, distance + offset);
      return {
        objectId: node.id,
        prompt: node.interaction.prompt,
        kind: node.interaction.kind,
        position: [...node.position] as Vec3,
        standAt: [round((x / distance) * reach), round((z / distance) * reach)] as [number, number],
      };
    });

  const materialIds = new Set(objects.filter((object) => object.role !== "light-fixture").map((object) => object.materialId));
  const triangles = objects.reduce((total, object) => {
    const volume = Math.max(0.05, object.scale[0] * object.scale[1] * object.scale[2]);
    return total + Math.round(BASE_TRIANGLES[object.primitive] * clamp(volume, 0.15, 6));
  }, 0);

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) {
    for (let axis = 0; axis < 3; axis += 1) {
      const reach = Math.abs(object.scale[axis]) / 2;
      min[axis] = Math.min(min[axis], object.position[axis] - reach);
      max[axis] = Math.max(max[axis], object.position[axis] + reach);
    }
  }
  if (!objects.length) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  const centre: Vec3 = [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2), round((min[2] + max[2]) / 2)];
  const radius = Math.max(1, Math.hypot(max[0] - centre[0], max[2] - centre[2]));

  return {
    specId: spec.id,
    name: spec.name,
    objects,
    lights: spec.lights.map((light) => ({
      id: light.id,
      kind: light.kind,
      color: [...light.color] as Vec3,
      intensity: light.intensity,
      position: [...light.position] as Vec3,
      ...(light.target ? { target: [...light.target] as Vec3 } : {}),
      ...(light.distance !== undefined ? { distance: light.distance } : {}),
    })),
    interactions,
    nav: { ...spec.nav, spawn: [...spec.nav.spawn] as [number, number] },
    bounds: {
      min: [round(min[0]), round(min[1]), round(min[2])],
      max: [round(max[0]), round(max[1]), round(max[2])],
      centre,
      radius: round(radius),
    },
    stats: {
      objects: objects.length,
      lights: spec.lights.length,
      drawCalls: materialIds.size,
      triangles,
      interactives: interactions.length,
    },
    problems,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* movement                                                           */
/* ------------------------------------------------------------------ */

export type MoveResult = { x: number; z: number; blocked: boolean };

/**
 * Move the avatar by (dx, dz) inside the room, refusing to walk into solid
 * objects or out of the walkable area. Uses a body radius so the avatar does
 * not clip a pillar edge.
 */
export function moveAvatar(room: RoomModel, from: [number, number], delta: [number, number], bodyRadius = 0.35): MoveResult {
  const [x0, z0] = from;
  const [dx, dz] = delta;
  const wanted: [number, number] = [x0 + dx, z0 + dz];

  const insideNav = (x: number, z: number): boolean => {
    if (room.nav.shape === "circular") return Math.hypot(x, z) <= room.nav.radius - bodyRadius;
    return Math.abs(x) <= room.nav.halfWidth - bodyRadius && Math.abs(z) <= room.nav.halfDepth - bodyRadius;
  };

  const collides = (x: number, z: number): boolean =>
    room.objects.some((object) => {
      if (!object.blocksMovement) return false;
      if (object.role === "chamber" || object.role === "workstation" || object.role === "seat" || object.role === "table") {
        // Low furniture is steppable-adjacent: still solid, but only the
        // footprint matters, not its full height.
      }
      const footprint = object.footprint;
      if (footprint.kind === "circle") {
        return Math.hypot(x - footprint.x, z - footprint.z) <= footprint.radius + bodyRadius;
      }
      const localX = x - footprint.x;
      const localZ = z - footprint.z;
      const cos = Math.cos(-footprint.rotationY);
      const sin = Math.sin(-footprint.rotationY);
      const rotatedX = localX * cos - localZ * sin;
      const rotatedZ = localX * sin + localZ * cos;
      return Math.abs(rotatedX) <= footprint.halfWidth + bodyRadius && Math.abs(rotatedZ) <= footprint.halfDepth + bodyRadius;
    });

  /* Full move, then slide along each axis so a wall does not stop both. */
  if (insideNav(wanted[0], wanted[1]) && !collides(wanted[0], wanted[1])) {
    return { x: round(wanted[0]), z: round(wanted[1]), blocked: false };
  }
  if (insideNav(wanted[0], z0) && !collides(wanted[0], z0)) {
    return { x: round(wanted[0]), z: z0, blocked: true };
  }
  if (insideNav(x0, wanted[1]) && !collides(x0, wanted[1])) {
    return { x: x0, z: round(wanted[1]), blocked: true };
  }
  return { x: x0, z: z0, blocked: true };
}

/** Nearest interaction the avatar can reach from where it stands. */
export function nearestInteraction(room: RoomModel, from: [number, number], reach = 2.4): InteractionPoint | null {
  let best: InteractionPoint | null = null;
  let bestDistance = Infinity;
  for (const interaction of room.interactions) {
    const distance = Math.hypot(interaction.position[0] - from[0], interaction.position[2] - from[1]);
    if (distance <= reach && distance < bestDistance) {
      best = interaction;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A mobile budget check. A room is "phone safe" when it draws in few calls and
 * stays inside a triangle budget — reported, never silently "optimised" by
 * dropping objects the user asked for.
 */
export function budgetCheck(room: RoomModel, limits: { drawCalls: number; triangles: number } = { drawCalls: 24, triangles: 400_000 }): {
  ok: boolean;
  drawCalls: number;
  triangles: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (room.stats.drawCalls > limits.drawCalls) reasons.push(`${room.stats.drawCalls} draw calls (limit ${limits.drawCalls})`);
  if (room.stats.triangles > limits.triangles) reasons.push(`${room.stats.triangles} triangles (limit ${limits.triangles})`);
  return { ok: reasons.length === 0, drawCalls: room.stats.drawCalls, triangles: room.stats.triangles, reasons };
}
