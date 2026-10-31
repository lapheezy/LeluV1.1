/**
 * ==========================================================
 * LÉLUVERSE — WORLD ENGINE (server)
 *
 * One connected universe of persistent environments, kept in
 * the same Cosmos store as the Forge placements (one world
 * state, not two):
 *
 *   cosmos/world.json          environments + the current one
 *   cosmos/placements.json     every object (Forge asset or
 *                              built-in shape), tagged with its
 *                              environment; wearables travel
 *                              with LÉLU
 *   cosmos/history/<env>/…     a snapshot after every change —
 *                              any version can be restored
 *   cosmos/improvements.ndjson DISCOVER → … → REMEMBER log
 *   cosmos/avatar.json         where LÉLU stands in each
 *                              environment, which way she
 *                              faces, and her resting mood
 *
 * Rooms can also be generated from a description
 * (src/core/world/RoomGenerator.ts): kind, colours, lighting
 * and furniture made of built-in shapes, as one version.
 *
 * "home" — LÉLU's circular room — always exists. Sandboxes are
 * copies of an environment to try changes in; promoting one
 * back over its source needs an explicit approval and is
 * itself a new version, so it can be rolled back.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CosmosPlacement, ForgeStore, PhysicsSpec, PrimitiveShape, PrimitiveSpec } from "./forgeStore.ts";
import { ForgeError } from "./meshyForge.ts";
import { generateRoom, type RoomRequest } from "../src/core/world/RoomGenerator.ts";

export type EnvironmentKind = "room" | "lab" | "studio" | "garden" | "observatory" | "open";

export interface EnvironmentSettings {
  radius: number;
  floorColor: string;
  wallColor: string;
  accent: string;
  wallHeight: number;
  ambient: number;
  keyLight: number;
  keyColor: string;
  fogColor: string;
  fogDensity: number;
  gravity: number;
}

export interface Environment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  description: string;
  settings: EnvironmentSettings;
  sandbox: boolean;
  sandboxOf: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface WorldFile {
  current: string;
  environments: Environment[];
}

export interface Improvement {
  at: string;
  stage: "discover" | "design" | "generate" | "test" | "evaluate" | "integrate" | "remember";
  subject: string;
  what: string;
  why: string;
  tests: string;
  passed: boolean | null;
  environmentId: string | null;
}

export const MOODS = ["neutral", "happy", "focused", "concerned", "surprised", "attentive"] as const;
export type Mood = (typeof MOODS)[number];

/** LÉLU's own persistent state in the world (her look and wearables live in the Forge manifest and placements). */
export interface AvatarState {
  character: string;
  environmentId: string;
  /** Where she stands in that environment: [x, floor y, z]. */
  position: [number, number, number];
  /** Rotation about Y in radians; 0 faces +z (towards the camera). */
  facing: number;
  /** Resting expression when she is not busy listening, thinking or speaking. */
  mood: Mood;
  revision: number;
  updatedAt: number;
}

interface AvatarFile {
  [character: string]: {
    mood: Mood;
    revision: number;
    updatedAt: number;
    spots: Record<string, { position: [number, number, number]; facing: number }>;
  };
}

/** Where LÉLU stands until she is moved: in front of her room's centre, facing the camera. */
export const LELU_SPOT = { position: [0, -2.55, 3.3] as [number, number, number], facing: 0 };

/** Where LÉLU's room sits in the Gen V2 world: her floor (y −2.55), around her (x 0, z 3.3). */
export const ROOM_ORIGIN = { centre: [0, 2.2] as [number, number], floorY: -2.55 };

const PRESETS: Record<EnvironmentKind, Partial<EnvironmentSettings>> = {
  room: { floorColor: "#1c1526", wallColor: "#2a1f38", accent: "#f0abfc", keyColor: "#ffd9b0", ambient: 0.55, keyLight: 1.4, fogColor: "#0d0a14", fogDensity: 0.02 },
  lab: { floorColor: "#11181f", wallColor: "#1d2a35", accent: "#38bdf8", keyColor: "#e0f2fe", ambient: 0.7, keyLight: 1.8, fogColor: "#071018", fogDensity: 0.015 },
  studio: { floorColor: "#1f1a1a", wallColor: "#3a2b2b", accent: "#fb923c", keyColor: "#fff1e6", ambient: 0.8, keyLight: 2, fogColor: "#120c0c", fogDensity: 0.01 },
  garden: { floorColor: "#13261a", wallColor: "#1f3b26", accent: "#4ade80", keyColor: "#fef9c3", ambient: 0.75, keyLight: 1.6, fogColor: "#0a140c", fogDensity: 0.02 },
  observatory: { floorColor: "#0c0f1f", wallColor: "#161c3a", accent: "#a78bfa", keyColor: "#c7d2fe", ambient: 0.4, keyLight: 1.1, fogColor: "#05060f", fogDensity: 0.025 },
  open: { floorColor: "#1a1a1a", wallColor: "#1a1a1a", accent: "#e5e7eb", keyColor: "#ffffff", ambient: 0.7, keyLight: 1.5, fogColor: "#0b0b0b", fogDensity: 0.01, wallHeight: 0 },
};

const BASE_SETTINGS: EnvironmentSettings = {
  radius: 6.5,
  floorColor: "#1c1526",
  wallColor: "#2a1f38",
  accent: "#f0abfc",
  wallHeight: 1.4,
  ambient: 0.55,
  keyLight: 1.4,
  keyColor: "#ffd9b0",
  fogColor: "#0d0a14",
  fogDensity: 0.02,
  gravity: 9.81,
};

const SHAPES: ReadonlySet<PrimitiveShape> = new Set(["box", "sphere", "cylinder", "cone", "torus", "plane"]);
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

const clamp = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export class WorldEngine {
  private readonly store: ForgeStore;
  private readonly dir: string;

  constructor(store: ForgeStore) {
    this.store = store;
    this.dir = path.join(store.root, "cosmos");
    mkdirSync(path.join(this.dir, "history"), { recursive: true });
  }

  /* ---------------------------- environments --------------------------- */

  private file(): WorldFile {
    const f = path.join(this.dir, "world.json");
    const world: WorldFile = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { current: "home", environments: [] };
    if (!world.environments.some((e) => e.id === "home")) {
      const now = Date.now();
      world.environments.unshift({
        id: "home",
        name: "LÉLU's room",
        kind: "room",
        description: "LÉLU's circular room — the home environment and shared conversational workspace.",
        settings: { ...BASE_SETTINGS },
        sandbox: false,
        sandboxOf: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
      // First sight of the universe: save it and record the empty room as version 1, so it can always be returned to.
      this.save(world);
      this.snapshot("home", "created");
      return this.file();
    }
    return world;
  }

  private save(world: WorldFile): void {
    writeJsonAtomic(path.join(this.dir, "world.json"), world);
  }

  state() {
    const world = this.file();
    const current = world.environments.find((e) => e.id === world.current) ?? world.environments[0];
    return {
      current: current.id,
      environment: current,
      environments: world.environments.map(({ id, name, kind, sandbox, sandboxOf, version }) => ({ id, name, kind, sandbox, sandboxOf, version })),
      objects: this.objectsIn(current.id),
      origin: ROOM_ORIGIN,
      avatar: this.avatar("lelu_character", current.id),
    };
  }

  environment(id: string): Environment {
    const env = this.file().environments.find((e) => e.id === id);
    if (!env) throw new ForgeError(`No environment "${id}".`, 404);
    return env;
  }

  private settingsPatch(base: EnvironmentSettings, patch: unknown): EnvironmentSettings {
    const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    const color = (k: keyof EnvironmentSettings) => (typeof p[k] === "string" && COLOR.test(p[k] as string) ? (p[k] as string) : (base[k] as string));
    return {
      radius: clamp(p.radius, base.radius, 2, 30),
      floorColor: color("floorColor"),
      wallColor: color("wallColor"),
      accent: color("accent"),
      wallHeight: clamp(p.wallHeight, base.wallHeight, 0, 8),
      ambient: clamp(p.ambient, base.ambient, 0, 3),
      keyLight: clamp(p.keyLight, base.keyLight, 0, 6),
      keyColor: color("keyColor"),
      fogColor: color("fogColor"),
      fogDensity: clamp(p.fogDensity, base.fogDensity, 0, 0.2),
      gravity: clamp(p.gravity, base.gravity, 0, 30),
    };
  }

  createEnvironment(input: { id?: unknown; name?: unknown; kind?: unknown; description?: unknown; settings?: unknown; sandboxOf?: unknown }): Environment {
    const world = this.file();
    const source = typeof input.sandboxOf === "string" && input.sandboxOf ? this.environment(input.sandboxOf) : null;
    const kind = (source?.kind ?? (typeof input.kind === "string" && input.kind in PRESETS ? input.kind : "room")) as EnvironmentKind;
    const name = String(input.name ?? (source ? `${source.name} (sandbox)` : kind)).slice(0, 80);
    let id = typeof input.id === "string" && input.id ? input.id : `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || kind}${source ? "-sandbox" : ""}`;
    if (!ID.test(id)) throw new ForgeError("Environment id must be lowercase letters, digits, _ or -.");
    while (world.environments.some((e) => e.id === id)) id = `${id}-${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 3)}`;
    const now = Date.now();
    const env: Environment = {
      id,
      name,
      kind,
      description: String(input.description ?? source?.description ?? "").slice(0, 400),
      settings: this.settingsPatch(source ? source.settings : { ...BASE_SETTINGS, ...PRESETS[kind] }, input.settings),
      sandbox: Boolean(source),
      sandboxOf: source?.id ?? null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    world.environments.push(env);
    this.save(world);
    if (source) {
      // A sandbox starts as a copy of the source's objects (new ids; the assets are shared, never copied).
      const placements = this.store.placements();
      const copies = this.objectsIn(source.id).map((o) => ({ ...o, id: this.newId(), environmentId: env.id, createdAt: now }));
      this.store.savePlacements([...placements, ...copies]);
    }
    this.snapshot(env.id, source ? `sandbox of ${source.id}` : "created");
    return this.environment(env.id);
  }

  updateEnvironment(id: string, patch: { name?: unknown; description?: unknown; settings?: unknown }): Environment {
    const world = this.file();
    const env = world.environments.find((e) => e.id === id);
    if (!env) throw new ForgeError(`No environment "${id}".`, 404);
    if (typeof patch.name === "string" && patch.name.trim()) env.name = patch.name.trim().slice(0, 80);
    if (typeof patch.description === "string") env.description = patch.description.slice(0, 400);
    env.settings = this.settingsPatch(env.settings, patch.settings);
    env.updatedAt = Date.now();
    this.save(world);
    this.snapshot(id, "settings changed");
    return this.environment(id);
  }

  enter(id: string): ReturnType<WorldEngine["state"]> {
    const world = this.file();
    this.environment(id);
    world.current = id;
    this.save(world);
    return this.state();
  }

  /* ------------------------------- objects ------------------------------ */

  private newId(): string {
    return `pl_${Date.now().toString(36)}_${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 4)}`;
  }

  /** Objects standing in an environment (wearables are on LÉLU, not in a room). */
  objectsIn(envId: string): CosmosPlacement[] {
    return this.store.placements().filter((p) => !p.attach && (p.environmentId ?? "home") === envId);
  }

  primitiveSpec(value: unknown, base?: PrimitiveSpec | null): PrimitiveSpec {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const shape = (typeof v.shape === "string" ? v.shape : base?.shape ?? "box") as PrimitiveShape;
    if (!SHAPES.has(shape)) throw new ForgeError(`shape must be one of ${[...SHAPES].join(", ")}.`);
    return {
      shape,
      color: typeof v.color === "string" && COLOR.test(v.color) ? v.color : (base?.color ?? "#c4b5fd"),
      metalness: clamp(v.metalness, base?.metalness ?? 0.1, 0, 1),
      roughness: clamp(v.roughness, base?.roughness ?? 0.5, 0, 1),
      emissive: typeof v.emissive === "string" && COLOR.test(v.emissive) ? v.emissive : v.emissive === null ? null : (base?.emissive ?? null),
      opacity: clamp(v.opacity, base?.opacity ?? 1, 0.05, 1),
      ...(Array.isArray(v.proportions) || base?.proportions
        ? { proportions: [0, 1, 2].map((i) => clamp((v.proportions as unknown[] | undefined)?.[i], base?.proportions?.[i] ?? 1, 0.005, 1)) as [number, number, number] }
        : {}),
    };
  }

  physicsSpec(value: unknown, base?: PhysicsSpec | null): PhysicsSpec | null {
    if (value === null || value === false) return null;
    if (!value || typeof value !== "object") return base ?? null;
    const v = value as Record<string, unknown>;
    const vel = Array.isArray(v.velocity) ? v.velocity : [];
    return {
      dynamic: v.dynamic !== false,
      mass: clamp(v.mass, base?.mass ?? 1, 0.01, 1000),
      restitution: clamp(v.restitution, base?.restitution ?? 0.4, 0, 1),
      friction: clamp(v.friction, base?.friction ?? 0.5, 0, 2),
      velocity: [0, 1, 2].map((i) => clamp(vel[i], 0, -50, 50)) as [number, number, number],
    };
  }

  /** A built-in shape in an environment (the current one by default). Spends nothing. */
  createObject(input: Record<string, unknown>): CosmosPlacement {
    const envId = typeof input.environmentId === "string" && input.environmentId ? input.environmentId : this.file().current;
    const env = this.environment(envId);
    const p = Array.isArray(input.position) ? input.position : [];
    const count = this.objectsIn(envId).length;
    const angle = 0.6 + count * 0.9;
    const r = env.settings.radius * 0.55;
    const object: CosmosPlacement = {
      id: this.newId(),
      jobId: "",
      character: "world",
      label: String(input.label ?? input.shape ?? "object").slice(0, 80),
      file: "",
      position: [
        clamp(p[0], ROOM_ORIGIN.centre[0] + Math.sin(angle) * r, -60, 60),
        clamp(p[1], ROOM_ORIGIN.floorY + 0.5, -40, 40),
        clamp(p[2], ROOM_ORIGIN.centre[1] + Math.cos(angle) * r * 0.6, -60, 60),
      ],
      rotationY: clamp(input.rotationY, 0, -Math.PI * 2, Math.PI * 2),
      height: clamp(input.height, 1, 0.02, 20),
      environmentId: envId,
      primitive: this.primitiveSpec(input),
      physics: this.physicsSpec(input.physics),
      createdAt: Date.now(),
    };
    this.store.savePlacements([...this.store.placements(), object]);
    this.snapshot(envId, `added ${object.label}`);
    return object;
  }

  /** Re-colour / re-shape / change physics of a built-in shape (moves go through the shared placement update). */
  modifyObject(id: string, patch: Record<string, unknown>): CosmosPlacement {
    const placements = this.store.placements();
    const object = placements.find((p) => p.id === id);
    if (!object) throw new ForgeError(`No object ${id}.`, 404);
    if ("primitive" in patch) {
      if (!object.primitive) throw new ForgeError("Only built-in shapes can be re-shaped or re-coloured.", 409);
      object.primitive = this.primitiveSpec(patch.primitive, object.primitive);
    }
    if ("physics" in patch) object.physics = this.physicsSpec(patch.physics, object.physics);
    if (typeof patch.environmentId === "string") {
      this.environment(patch.environmentId);
      object.environmentId = patch.environmentId;
    }
    this.store.savePlacements(placements);
    this.snapshot(object.environmentId ?? "home", `modified ${object.label}`);
    return object;
  }

  /** Record that objects in an environment changed through another route (moves, removals, physics settling). */
  touched(envId: string | undefined, reason: string): void {
    this.snapshot(envId ?? "home", reason);
  }

  /* ---------------------------- generation ---------------------------- */

  /**
   * Build a furnished environment from a description (src/core/world/RoomGenerator.ts):
   * a new environment with the description's kind, colours and lighting, and
   * furniture made of built-in shapes, saved as one version so it can be
   * restored or regenerated. With environmentId it furnishes that environment
   * instead (replace: true clears its objects first). Spends nothing.
   */
  generateEnvironment(input: Partial<RoomRequest> & { environmentId?: unknown; replace?: unknown; enter?: unknown }) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const items = Array.isArray(input.items) ? input.items : undefined;
    if (!description && !items?.length) throw new ForgeError("Describe the room, or list the pieces to put in it.");
    const into = typeof input.environmentId === "string" && input.environmentId ? this.environment(input.environmentId) : null;
    const spot = this.avatar("lelu_character", into?.id ?? "home");
    const plan = generateRoom(
      {
        description,
        name: typeof input.name === "string" ? input.name : undefined,
        kind: into?.kind ?? (typeof input.kind === "string" ? input.kind : undefined),
        items,
        seed: typeof input.seed === "number" && Number.isFinite(input.seed) ? input.seed : undefined,
        radius: into?.settings.radius ?? (typeof input.radius === "number" ? input.radius : undefined),
      },
      { centre: ROOM_ORIGIN.centre, floorY: ROOM_ORIGIN.floorY, lelu: [spot.position[0], spot.position[2]] },
    );
    let env: Environment;
    if (into) {
      env = into;
    } else {
      const world = this.file();
      const now = Date.now();
      let id = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || plan.kind;
      while (world.environments.some((e) => e.id === id)) id = `${id}-${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 3)}`;
      env = {
        id,
        name: plan.name,
        kind: plan.kind,
        description: plan.description,
        settings: this.settingsPatch({ ...BASE_SETTINGS, ...PRESETS[plan.kind] }, plan.settings),
        sandbox: false,
        sandboxOf: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      world.environments.push(env);
      this.save(world);
    }
    const now = Date.now();
    const objects: CosmosPlacement[] = plan.parts.map((part) => ({
      id: this.newId(),
      jobId: "",
      character: "world",
      label: part.label,
      file: "",
      position: part.position,
      rotationY: part.rotationY,
      height: part.height,
      environmentId: env.id,
      group: part.group,
      primitive: this.primitiveSpec(part),
      physics: null,
      createdAt: now,
    }));
    const clearing = into && input.replace === true;
    const keep = this.store.placements().filter((p) => !(clearing && !p.attach && (p.environmentId ?? "home") === env.id));
    this.store.savePlacements([...keep, ...objects]);
    this.snapshot(env.id, `generated ${plan.pieces.length} pieces from "${(description || plan.name).slice(0, 60)}"`);
    if (input.enter !== false) this.enter(env.id);
    return {
      environment: this.environment(env.id),
      plan: { kind: plan.kind, pieces: plan.pieces, skipped: plan.skipped, seed: plan.seed, settings: plan.settings },
      objects,
    };
  }

  /** Remove a whole generated piece (every part in its group). */
  removeGroup(envId: string, group: string): CosmosPlacement[] {
    const placements = this.store.placements();
    const gone = placements.filter((p) => !p.attach && (p.environmentId ?? "home") === envId && p.group === group);
    if (!gone.length) throw new ForgeError(`No piece "${group}" in ${envId}.`, 404);
    this.store.savePlacements(placements.filter((p) => !gone.includes(p)));
    this.snapshot(envId, `removed ${group}`);
    return gone;
  }

  /* ------------------------------- avatar ------------------------------- */

  private avatarFile(): AvatarFile {
    const f = path.join(this.dir, "avatar.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as AvatarFile) : {};
  }

  /** LÉLU's state in an environment (the current one by default): where she stands, facing, mood. */
  avatar(character = "lelu_character", envId?: string): AvatarState {
    const environmentId = envId ?? this.file().current;
    const entry = this.avatarFile()[character];
    const spot = entry?.spots[environmentId] ?? LELU_SPOT;
    return {
      character,
      environmentId,
      position: [...spot.position] as [number, number, number],
      facing: spot.facing,
      mood: entry?.mood ?? "neutral",
      revision: entry?.revision ?? 0,
      updatedAt: entry?.updatedAt ?? 0,
    };
  }

  /**
   * Move or turn LÉLU, or set her resting mood. She stays on the floor and
   * inside the wall; "towards" turns her to an object (id or piece group) or
   * to "user". Persists across reloads and devices; each environment
   * remembers its own spot for her.
   */
  setAvatar(character: string, patch: { environmentId?: unknown; position?: unknown; facing?: unknown; mood?: unknown; towards?: unknown }): AvatarState {
    const environmentId = typeof patch.environmentId === "string" && patch.environmentId ? patch.environmentId : this.file().current;
    const env = this.environment(environmentId);
    const all = this.avatarFile();
    const entry = all[character] ?? { mood: "neutral" as Mood, revision: 0, updatedAt: 0, spots: {} };
    const spot = { ...(entry.spots[environmentId] ?? LELU_SPOT) };
    if (Array.isArray(patch.position)) {
      const [cx, cz] = ROOM_ORIGIN.centre;
      let x = clamp(patch.position[0], spot.position[0], -60, 60);
      let z = clamp(patch.position[patch.position.length === 2 ? 1 : 2], spot.position[2], -60, 60);
      const limit = env.settings.wallHeight > 0 ? env.settings.radius - 0.4 : 60;
      const d = Math.hypot(x - cx, z - cz);
      if (d > limit) {
        x = cx + ((x - cx) / d) * limit;
        z = cz + ((z - cz) / d) * limit;
      }
      spot.position = [x, ROOM_ORIGIN.floorY, z];
    }
    if (typeof patch.facing === "number" && Number.isFinite(patch.facing)) spot.facing = Math.atan2(Math.sin(patch.facing), Math.cos(patch.facing));
    if (typeof patch.towards === "string" && patch.towards) {
      let target: [number, number];
      if (patch.towards === "user") target = [spot.position[0], spot.position[2] + 10];
      else {
        const hits = this.objectsIn(environmentId).filter((o) => o.id === patch.towards || o.group === patch.towards);
        if (!hits.length) throw new ForgeError(`No object or piece "${patch.towards}" in ${environmentId}.`, 404);
        target = [hits.reduce((s, o) => s + o.position[0], 0) / hits.length, hits.reduce((s, o) => s + o.position[2], 0) / hits.length];
      }
      spot.facing = Math.atan2(target[0] - spot.position[0], target[1] - spot.position[2]);
    }
    if (patch.mood !== undefined) {
      if (!MOODS.includes(patch.mood as Mood)) throw new ForgeError(`mood must be one of ${MOODS.join(", ")}.`);
      entry.mood = patch.mood as Mood;
    }
    entry.spots[environmentId] = spot;
    entry.revision += 1;
    entry.updatedAt = Date.now();
    all[character] = entry;
    writeJsonAtomic(path.join(this.dir, "avatar.json"), all);
    return this.avatar(character, environmentId);
  }

  /* ------------------------------ versions ----------------------------- */

  private historyDir(envId: string): string {
    const dir = path.join(this.dir, "history", envId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private snapshot(envId: string, reason: string): number {
    const world = this.file();
    const env = world.environments.find((e) => e.id === envId);
    if (!env) return 0;
    env.version += 1;
    env.updatedAt = Date.now();
    this.save(world);
    writeJsonAtomic(path.join(this.historyDir(envId), `v${String(env.version).padStart(5, "0")}.json`), {
      version: env.version,
      at: new Date().toISOString(),
      reason,
      environment: env,
      objects: this.objectsIn(envId),
    });
    return env.version;
  }

  history(envId: string) {
    this.environment(envId);
    return readdirSync(this.historyDir(envId))
      .filter((f) => /^v\d{5}\.json$/.test(f))
      .sort()
      .map((f) => {
        const snap = JSON.parse(readFileSync(path.join(this.historyDir(envId), f), "utf8"));
        return { version: snap.version as number, at: snap.at as string, reason: snap.reason as string, objects: (snap.objects as unknown[]).length };
      });
  }

  /** Put an environment back exactly as it was at a version. The restore is itself a new version. */
  restore(envId: string, version: number): Environment {
    const file = path.join(this.historyDir(envId), `v${String(version).padStart(5, "0")}.json`);
    if (!existsSync(file)) throw new ForgeError(`${envId} has no version ${version}.`, 404);
    const snap = JSON.parse(readFileSync(file, "utf8")) as { environment: Environment; objects: CosmosPlacement[] };
    this.replaceContents(envId, snap.environment, snap.objects);
    this.snapshot(envId, `restored v${version}`);
    return this.environment(envId);
  }

  private replaceContents(envId: string, from: Environment, objects: CosmosPlacement[]): void {
    const world = this.file();
    const env = world.environments.find((e) => e.id === envId)!;
    env.settings = { ...from.settings };
    env.description = from.description;
    this.save(world);
    const others = this.store.placements().filter((p) => p.attach || (p.environmentId ?? "home") !== envId);
    this.store.savePlacements([...others, ...objects.map((o) => ({ ...o, environmentId: envId }))]);
  }

  /**
   * Promote a tested sandbox over the environment it was copied from.
   * Consequential (it replaces a working environment), so it needs
   * approve: true; the source's previous state stays restorable.
   */
  promote(sandboxId: string, approve: boolean): Environment {
    const sandbox = this.environment(sandboxId);
    if (!sandbox.sandbox || !sandbox.sandboxOf) throw new ForgeError(`${sandboxId} is not a sandbox.`, 409);
    if (!approve) throw new ForgeError(`Promoting ${sandboxId} over ${sandbox.sandboxOf} replaces a working environment and needs approval.`, 409);
    const objects = this.objectsIn(sandboxId).map((o) => ({ ...o, id: this.newId() }));
    this.replaceContents(sandbox.sandboxOf, sandbox, objects);
    this.snapshot(sandbox.sandboxOf, `promoted sandbox ${sandboxId}`);
    this.recordImprovement({ stage: "integrate", subject: sandbox.sandboxOf, what: `Promoted sandbox ${sandboxId}`, why: "approved by the user", tests: "", passed: null, environmentId: sandbox.sandboxOf });
    return this.environment(sandbox.sandboxOf);
  }

  /* ---------------------------- improvements ---------------------------- */

  recordImprovement(entry: Omit<Improvement, "at">): Improvement {
    const stages: Improvement["stage"][] = ["discover", "design", "generate", "test", "evaluate", "integrate", "remember"];
    if (!stages.includes(entry.stage)) throw new ForgeError(`stage must be one of ${stages.join(", ")}.`);
    const record: Improvement = {
      at: new Date().toISOString(),
      stage: entry.stage,
      subject: String(entry.subject ?? "").slice(0, 120),
      what: String(entry.what ?? "").slice(0, 1000),
      why: String(entry.why ?? "").slice(0, 1000),
      tests: String(entry.tests ?? "").slice(0, 1000),
      passed: typeof entry.passed === "boolean" ? entry.passed : null,
      environmentId: entry.environmentId ?? null,
    };
    appendFileSync(path.join(this.dir, "improvements.ndjson"), `${JSON.stringify(record)}\n`);
    return record;
  }

  improvements(limit = 100): Improvement[] {
    const f = path.join(this.dir, "improvements.ndjson");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as Improvement);
  }
}
