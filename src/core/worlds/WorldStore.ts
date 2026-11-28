/**
 * ==========================================================
 * LÉLU — WORLD STORE (WP21 · WP05)
 *
 * Saved worlds and which one is active. Worlds are the user's own
 * configurations (composed from families, then edited); they persist
 * across reloads, can be duplicated, renamed, reset to their families,
 * exported as JSON and imported back (validated).
 *
 * The active world is a surface-independent choice: the Thread reads it
 * today; the Cosmos can host the same world later (WP07) because the world
 * is plain data with its own id.
 * ==========================================================
 */

import { composeWorld } from "./ThemeFamilies";
import { editWorld, validateWorld, type WorldConfig, type WorldEdit } from "./WorldSchema";

const KEY = "lelu.worlds.v1";

interface Saved {
  worlds: WorldConfig[];
  active: string | null;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
let storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null;
let state: Saved | null = null;
const listeners = new Set<() => void>();

export function setWorldStorage(s: Storage | null): void {
  storage = s;
  state = null;
}

function load(): Saved {
  if (state) return state;
  let raw: Partial<Saved> = {};
  try {
    raw = JSON.parse(storage?.getItem(KEY) ?? "{}");
  } catch {
    raw = {};
  }
  const worlds = (Array.isArray(raw.worlds) ? raw.worlds : []).map((w) => validateWorld(w).world).filter((w): w is WorldConfig => !!w);
  state = { worlds, active: typeof raw.active === "string" && worlds.some((w) => w.id === raw.active) ? raw.active : null };
  return state;
}

function save(next: Saved): void {
  state = next;
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota: kept in memory */
  }
  listeners.forEach((l) => l());
}

export function subscribeWorlds(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function savedWorlds(): WorldConfig[] {
  return load().worlds;
}

export function activeWorld(): WorldConfig | null {
  const s = load();
  return s.worlds.find((w) => w.id === s.active) ?? null;
}

const uniqueId = (base: string, worlds: WorldConfig[]) => {
  let id = base.replace(/[^a-z0-9+-]/gi, "-").toLowerCase().slice(0, 50) || "world";
  let n = 2;
  const b = id;
  while (worlds.some((w) => w.id === id)) id = `${b}-${n++}`;
  return id;
};

/** Creates (and activates) a world composed from families. */
export function createWorld(families: string[], name?: string, now = Date.now()): WorldConfig {
  const s = load();
  const w = composeWorld(families, { name, now });
  w.id = uniqueId(w.id, s.worlds);
  save({ worlds: [...s.worlds, w], active: w.id });
  return w;
}

export function activate(id: string | null): void {
  const s = load();
  if (id !== null && !s.worlds.some((w) => w.id === id)) return;
  save({ ...s, active: id });
}

export function applyEdit(id: string, edit: WorldEdit, now = Date.now()): { world: WorldConfig | null; issues: string[] } {
  const s = load();
  const w = s.worlds.find((x) => x.id === id);
  if (!w) return { world: null, issues: [`no world ${id}`] };
  const r = editWorld(w, edit, now);
  save({ ...s, worlds: s.worlds.map((x) => (x.id === id ? r.world : x)) });
  return r;
}

export function duplicateWorld(id: string, now = Date.now()): WorldConfig | null {
  const s = load();
  const w = s.worlds.find((x) => x.id === id);
  if (!w) return null;
  const copy: WorldConfig = { ...structuredClone(w), id: uniqueId(`${w.id}-copy`, s.worlds), name: `${w.name} (copy)`, updatedAt: now };
  save({ worlds: [...s.worlds, copy], active: copy.id });
  return copy;
}

export function renameWorld(id: string, name: string): void {
  applyEdit(id, { op: "world", changes: { name } });
}

/** Back to what its families compose, keeping its id and name. */
export function resetWorld(id: string, now = Date.now()): void {
  const s = load();
  const w = s.worlds.find((x) => x.id === id);
  if (!w) return;
  const fresh = { ...composeWorld(w.families, { now }), id: w.id, name: w.name, place: w.place };
  save({ ...s, worlds: s.worlds.map((x) => (x.id === id ? fresh : x)) });
}

/** Adds another family's layers to an existing world. */
export function combineInto(id: string, familyId: string, now = Date.now()): WorldConfig | null {
  const s = load();
  const w = s.worlds.find((x) => x.id === id);
  if (!w || w.families.includes(familyId)) return w ?? null;
  const extra = composeWorld([...w.families, familyId]).layers.filter((l) => l.family === familyId);
  const next = validateWorld({ ...w, families: [...w.families, familyId], layers: [...w.layers, ...extra], updatedAt: now }).world!;
  save({ ...s, worlds: s.worlds.map((x) => (x.id === id ? next : x)) });
  return next;
}

export function deleteWorld(id: string): void {
  const s = load();
  save({ worlds: s.worlds.filter((w) => w.id !== id), active: s.active === id ? null : s.active });
}

export function exportWorld(id: string): string | null {
  const w = load().worlds.find((x) => x.id === id);
  return w ? JSON.stringify({ format: "lelu-world", version: 1, world: w }, null, 1) : null;
}

export function importWorld(json: string, now = Date.now()): { world: WorldConfig | null; issues: string[] } {
  let parsed: { format?: string; world?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return { world: null, issues: ["not JSON"] };
  }
  if (parsed.format !== "lelu-world") return { world: null, issues: ["not a LÉLU world export"] };
  const { world, issues } = validateWorld(parsed.world);
  if (!world) return { world, issues };
  const s = load();
  world.id = uniqueId(world.id, s.worlds);
  world.updatedAt = now;
  save({ worlds: [...s.worlds, world], active: world.id });
  return { world, issues };
}

/** Adds a world built elsewhere (Time & Place) and activates it. */
export function addWorld(w: WorldConfig): WorldConfig {
  const s = load();
  const v = validateWorld(w).world!;
  v.id = uniqueId(v.id, s.worlds);
  save({ worlds: [...s.worlds, v], active: v.id });
  return v;
}
