/**
 * ==========================================================
 * LÉLU — THREAD OBJECTS (Mission 44.9)
 *
 * What lives IN a conversation thread besides the words: her Neural Maps,
 * a YouTube player, web pages, research cards, and — by reference, never
 * copied — the images and 3D models already in the messages and the spatial
 * surfaces already summoned (Mission 5.7, SpatialSummon). Same pattern as
 * SpatialSummon: per conversation, persisted locally, summoned by LÉLU's
 * tools into the chat that is open.
 *
 * An object holds only what identifies its content (a map aspect and view,
 * a video id, a URL) and its place in the thread: its transform per layout
 * variant (offset, size, rotation, stacking, group) and its liquid style.
 * The content itself is always read from its authority when rendered: the
 * map from the Neural Map aspects, the video from YouTube, the image from
 * the message. Nothing here is a second store of any of those.
 * ==========================================================
 */

import { summonsFor } from "../asre/SpatialSummon";

export type ThreadObjectKind = "neural-map" | "youtube" | "web" | "research" | "image" | "model3d" | "spatial" | "diagnostics";

export interface NeuralMapRef {
  aspect: "v1" | "v2" | "v3";
  /** A shared 2D layout id, or a V2 3D view id when `dim` is "3d". */
  view: string;
  dim: "2d" | "3d";
  /** Node ids highlighted by LÉLU or the person. */
  highlight: string[];
  /** The node selected for details. */
  selected: string | null;
}

export interface Transform {
  /** Offset from the variant's own placement, px. */
  dx: number;
  dy: number;
  /** Size override, px (null = the variant's size). */
  w: number | null;
  h: number | null;
  /** Degrees. */
  rot: number;
  z: number;
  /** Set when the person or LÉLU placed it: automatic layout no longer moves it. */
  manual: boolean;
}

export interface LiquidStyle {
  shape: "droplet" | "ribbon" | "pane" | "capsule" | "orb";
  /** 0 – 1 */
  transparency: number;
  /** 0 – 1, gradient strength */
  gradient: number;
  /** hue in degrees for the glow */
  hue: number;
  collapsed: boolean;
}

export interface ThreadObject {
  id: string;
  conversationId: string;
  kind: ThreadObjectKind;
  title: string;
  createdAt: number;
  /** Who put it there. */
  by: "lelu" | "user";
  /** Kind-specific identity of the content. */
  map?: NeuralMapRef;
  video?: { id: string; title: string; channel?: string; query?: string };
  web?: { url: string; title: string; snippet?: string };
  research?: { query: string; sources: Array<{ title: string; url: string; domain?: string }> };
  /** image / model3d: which message and which attachment. */
  ref?: { messageId: string; index: number; src?: string; name?: string; format?: string };
  spatialId?: string;
  /** diagnostics: the run this surface shows (the run itself lives in the diagnostics store). */
  diagnostics?: { runId: string; suite: string };
  /** youtube: the last position the player reported, so a reload can offer to resume there. */
  lastTime?: number;
  group: string | null;
  style: LiquidStyle;
  /** Transform per layout variant id. */
  transforms: Record<string, Transform>;
}

export const DEFAULT_STYLE: LiquidStyle = { shape: "pane", transparency: 0.18, gradient: 0.6, hue: 275, collapsed: false };
export const IDENTITY: Transform = { dx: 0, dy: 0, w: null, h: null, rot: 0, z: 0, manual: false };

const KEY = "lelu.thread.objects.v1";
const MAX_PER_CHAT = 40;
export const THREAD_OBJECT_EVENT = "lelu-thread-object";

type Listener = () => void;
const listeners = new Set<Listener>();
let objects: ThreadObject[] | null = null;
let resolveConversation: (() => string | null) | null = null;
/** Per-conversation layout variant (and the person's default). */
let variants: Record<string, string> | null = null;

interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
let storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage;
/** Tests use an in-memory storage. */
export function setThreadStorage(s: Storage | null): void {
  storage = s;
  objects = null;
  variants = null;
  feed = null;
}

function load(): ThreadObject[] {
  if (objects) return objects;
  objects = [];
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "null") as { objects?: ThreadObject[]; variants?: Record<string, string> } | null;
    if (parsed && Array.isArray(parsed.objects)) objects = parsed.objects.filter((o) => o && typeof o.id === "string" && typeof o.conversationId === "string");
    variants = parsed?.variants && typeof parsed.variants === "object" ? parsed.variants : {};
  } catch {
    objects = [];
  }
  variants ??= {};
  return objects;
}

function commit(): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ objects: load(), variants }));
  } catch {
    /* storage full: objects continue in memory */
  }
  cache.clear();
  for (const l of listeners) l();
}

/** The chat tells this module which conversation is open; tools ask it. */
export function setThreadConversationResolver(fn: (() => string | null) | null): void {
  resolveConversation = fn;
}
export function openConversation(): string | null {
  return resolveConversation?.() ?? null;
}

export function subscribeThread(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const cache = new Map<string, readonly ThreadObject[]>();
/** The summoned objects of one conversation (stable array per change). */
export function objectsFor(conversationId: string | null | undefined): readonly ThreadObject[] {
  if (!conversationId) return [];
  const hit = cache.get(conversationId);
  if (hit) return hit;
  const list = load().filter((o) => o.conversationId === conversationId);
  cache.set(conversationId, list);
  return list;
}

let seq = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Put an object in a conversation. Returns the existing one when the same content is already there (no duplicates). */
export function summon(input: Omit<ThreadObject, "id" | "createdAt" | "group" | "style" | "transforms"> & { style?: Partial<LiquidStyle> }): { object: ThreadObject; existing: boolean } {
  const list = load();
  const same = list.find((o) => o.conversationId === input.conversationId && sameContent(o, input));
  if (same) return { object: same, existing: true };
  const mine = list.filter((o) => o.conversationId === input.conversationId);
  if (mine.length >= MAX_PER_CHAT) list.splice(list.indexOf(mine[0]), 1);
  const object: ThreadObject = { ...input, id: newId(input.kind), createdAt: Date.now(), group: null, style: { ...DEFAULT_STYLE, ...(input.style ?? {}) }, transforms: {} };
  list.push(object);
  commit();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THREAD_OBJECT_EVENT, { detail: { id: object.id, conversationId: object.conversationId } }));
  return { object, existing: false };
}

function sameContent(a: Pick<ThreadObject, "kind" | "map" | "video" | "web" | "ref" | "spatialId">, b: Pick<ThreadObject, "kind" | "map" | "video" | "web" | "ref" | "spatialId">): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "neural-map":
      return a.map?.aspect === b.map?.aspect && a.map?.view === b.map?.view && a.map?.dim === b.map?.dim;
    case "youtube":
      return a.video?.id === b.video?.id;
    case "web":
      return a.web?.url === b.web?.url;
    case "image":
    case "model3d":
      return a.ref?.messageId === b.ref?.messageId && a.ref?.index === b.ref?.index;
    case "spatial":
      return a.spatialId === b.spatialId;
    case "diagnostics":
      // One Diagnostics surface per conversation: a new run is shown in the same surface (its history lists the earlier ones).
      return true;
    default:
      return false;
  }
}

export function getObject(id: string): ThreadObject | undefined {
  return load().find((o) => o.id === id);
}

export function update(id: string, patch: Partial<Omit<ThreadObject, "id" | "conversationId" | "kind">>): ThreadObject | undefined {
  const list = load();
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return undefined;
  list[i] = { ...list[i], ...patch };
  commit();
  return list[i];
}

export function setTransform(id: string, variant: string, patch: Partial<Transform>): Transform | undefined {
  const o = getObject(id);
  if (!o) return undefined;
  const t = { ...IDENTITY, ...(o.transforms[variant] ?? {}), ...patch };
  update(id, { transforms: { ...o.transforms, [variant]: t } });
  return t;
}

export function remove(id: string): boolean {
  const list = load();
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  // No stale group membership survives a deletion.
  for (const o of list) if (o.group && !list.some((x) => x.id !== o.id && x.group === o.group)) o.group = null;
  commit();
  return true;
}

/** Return every object of a conversation (in one variant) to its automatic place. */
export function resetLayout(conversationId: string, variant: string): number {
  let n = 0;
  for (const o of load().filter((x) => x.conversationId === conversationId)) {
    if (o.transforms[variant]) {
      const t = { ...o.transforms };
      delete t[variant];
      o.transforms = t;
      n++;
    }
  }
  commit();
  return n;
}

export function group(ids: string[], name = `group-${Date.now().toString(36)}`): string {
  for (const o of load()) if (ids.includes(o.id)) o.group = name;
  commit();
  return name;
}

export function variantFor(conversationId: string | null | undefined): string {
  load();
  return (conversationId && variants![conversationId]) || variants!["*"] || "workspace";
}
export function setVariant(conversationId: string | "*", variant: string): void {
  load();
  variants![conversationId] = variant;
  commit();
}

/**
 * Everything the thread shows, summoned or not: the summoned objects plus the
 * images and 3D models already in the messages and the spatial surfaces
 * already summoned — referenced by id so a layout can hold them too.
 */
export function threadContents(
  conversationId: string,
  messages: ReadonlyArray<{ id: string; role: string; attachments?: string[]; models?: Array<{ name: string; format: string; src: string }> }>,
): ThreadObject[] {
  const own = objectsFor(conversationId);
  const derived: ThreadObject[] = [];
  const persisted = (id: string) => own.find((o) => o.id === id);
  for (const m of messages) {
    (m.attachments ?? []).forEach((src, index) => {
      const id = `img:${m.id}:${index}`;
      derived.push(persisted(id) ?? { id, conversationId, kind: "image", title: m.role === "assistant" ? "Her visual" : "Attached image", createdAt: 0, by: m.role === "assistant" ? "lelu" : "user", ref: { messageId: m.id, index, src }, group: null, style: DEFAULT_STYLE, transforms: {} });
    });
    (m.models ?? []).forEach((model, index) => {
      const id = `m3d:${m.id}:${index}`;
      derived.push(persisted(id) ?? { id, conversationId, kind: "model3d", title: model.name, createdAt: 0, by: "user", ref: { messageId: m.id, index, src: model.src, name: model.name, format: model.format }, group: null, style: DEFAULT_STYLE, transforms: {} });
    });
  }
  for (const s of summonsFor(conversationId)) {
    const id = `spatial:${s.id}`;
    derived.push(persisted(id) ?? { id, conversationId, kind: "spatial", title: "Spatial surface", createdAt: 0, by: "lelu", spatialId: s.id, group: null, style: DEFAULT_STYLE, transforms: {} });
  }
  const derivedIds = new Set(derived.map((d) => d.id));
  return [...derived.map((d) => persisted(d.id) ?? d), ...own.filter((o) => !derivedIds.has(o.id))];
}

/** A derived object (message image, 3D model, spatial surface) gets a record the first time it is moved or styled. */
export function adopt(o: ThreadObject): ThreadObject {
  const existing = getObject(o.id);
  if (existing) return existing;
  load().push({ ...o, createdAt: Date.now() });
  commit();
  return getObject(o.id)!;
}

/* ---------------------------------------------------------- raindrop feed position */

const FEED_KEY = "lelu.thread.feed.v1";
let feed: Record<string, number> | null = null;
function loadFeed(): Record<string, number> {
  if (feed) return feed;
  try {
    feed = JSON.parse(storage?.getItem(FEED_KEY) ?? "{}") ?? {};
  } catch {
    feed = {};
  }
  return feed!;
}
/**
 * Where the person is in a conversation's raindrop feed: the index of the
 * newest drop above the puddle, or null to follow the latest (new drops fall
 * in and push the oldest down into the puddle).
 */
export function feedPosition(conversationId: string): number | null {
  const v = loadFeed()[conversationId];
  return typeof v === "number" ? v : null;
}
export function setFeedPosition(conversationId: string, index: number | null): void {
  const f = loadFeed();
  if (index === null) delete f[conversationId];
  else f[conversationId] = index;
  try {
    storage?.setItem(FEED_KEY, JSON.stringify(f));
  } catch {
    /* memory only */
  }
}
