/**
 * ==========================================================
 * LÉLU — A SPATIAL SUMMON (Mission 5.7)
 *
 * Spatial Studio is not a destination. When LÉLU (through her asre.* tools)
 * or a control in the conversation needs a spatial surface, it is SUMMONED
 * into the chat that is open at that moment, and the conversation keeps it:
 * reopening the chat brings the same job, character and tab back.
 *
 * What this module owns:
 *   - the summon event the tools dispatch and the chat listens for
 *   - the per-conversation list of open surfaces, persisted locally
 *
 * It holds no geometry and calls no service: the surface component reads the
 * job / character / GLB from the ASRE client exactly as the standalone
 * workspaces do, so there is one implementation, not two.
 * ==========================================================
 */

export type SpatialTab = "model" | "numerical" | "create" | "render";

export interface SpatialSummon {
  id: string;
  at: number;
  /** The conversation this surface belongs to. */
  conversationId: string;
  /** What LÉLU did that put it here ("Reconstructed from chair.png"). */
  title: string;
  /** Which tool produced it, so a surface never claims a step that did not run. */
  source: string;
  tab: SpatialTab;
  jobId?: string;
  characterId?: string;
  /** A GLB the surface can open immediately (reconstruction, version, Forge output). */
  glbUrl?: string;
  /** A one-line fact the surface shows under its title. */
  note?: string;
}

export const SPATIAL_SUMMON_EVENT = "lelu-spatial-summon";
const KEY = "lelu.spatial.surfaces.v1";
const MAX_PER_CHAT = 6;

type Listener = () => void;
const listeners = new Set<Listener>();
let surfaces: SpatialSummon[] | null = null;

let resolveConversation: (() => string) | null = null;

/** The chat tells this module which conversation is open; tools ask it. */
export function setSpatialConversationResolver(fn: (() => string) | null): void {
  resolveConversation = fn;
}

function isSummon(value: unknown): value is SpatialSummon {
  const s = value as SpatialSummon | null;
  return Boolean(s && typeof s.id === "string" && typeof s.conversationId === "string" && typeof s.tab === "string");
}

function all(): SpatialSummon[] {
  if (surfaces) return surfaces;
  surfaces = [];
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) surfaces = parsed.filter(isSummon).slice(-MAX_PER_CHAT * 12);
  } catch {
    surfaces = [];
  }
  return surfaces;
}

function persist(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(all()));
  } catch {
    // Storage is optional: the surfaces still exist for this session.
  }
}

const viewCache = new Map<string, readonly SpatialSummon[]>();

function emit(): void {
  viewCache.clear();
  for (const listener of listeners) listener();
}

function activeConversationId(): string {
  try {
    const id = resolveConversation?.();
    if (id) return id;
  } catch {
    // A broken resolver must not cost the surface.
  }
  return "active";
}

/**
 * Put a spatial surface in the conversation. Called by LÉLU's asre.* tools and
 * by the chat's own controls; a no-op dispatch without a window, so importing
 * it on the server never fires anything.
 */
export function summonSpatial(
  input: Omit<SpatialSummon, "id" | "at" | "conversationId" | "source"> & { conversationId?: string; source?: string },
): SpatialSummon {
  const summon: SpatialSummon = {
    id: `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    conversationId: input.conversationId ?? activeConversationId(),
    title: input.title,
    source: input.source ?? "asre",
    tab: input.tab,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.characterId ? { characterId: input.characterId } : {}),
    ...(input.glbUrl ? { glbUrl: input.glbUrl } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  const list = all();
  // The same object summoned twice is one surface, moved to the end.
  const existing = list.findIndex(
    (s) =>
      s.conversationId === summon.conversationId &&
      Boolean(summon.jobId || summon.characterId) &&
      s.jobId === summon.jobId &&
      s.characterId === summon.characterId,
  );
  if (existing >= 0) list.splice(existing, 1);
  list.push(summon);
  const mine = list.filter((s) => s.conversationId === summon.conversationId);
  if (mine.length > MAX_PER_CHAT) list.splice(list.indexOf(mine[0]), 1);
  persist();
  emit();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SpatialSummon>(SPATIAL_SUMMON_EVENT, { detail: summon }));
  }
  return summon;
}

export function dismissSpatial(id: string): void {
  const list = all();
  const at = list.findIndex((s) => s.id === id);
  if (at < 0) return;
  list.splice(at, 1);
  persist();
  emit();
}

/** Switch which capability a surface shows, without touching its job. */
export function summonTab(id: string, tab: SpatialTab): void {
  const summon = all().find((s) => s.id === id);
  if (!summon || summon.tab === tab) return;
  summon.tab = tab;
  persist();
  emit();
}

/** The surfaces of one conversation, as one stable array per change. */
export function summonsFor(conversationId: string | null | undefined): readonly SpatialSummon[] {
  const key = conversationId || "active";
  const cached = viewCache.get(key);
  if (cached) return cached;
  const mine = all().filter((s) => s.conversationId === key);
  viewCache.set(key, mine);
  return mine;
}

export function subscribeSpatial(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What a surface says it is, for the chat header and for tests. */
export function describeSummon(s: SpatialSummon): string {
  if (s.jobId) return `reconstruction ${s.jobId}`;
  if (s.characterId) return `character ${s.characterId}`;
  return "spatial asset";
}
