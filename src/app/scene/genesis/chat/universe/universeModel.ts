/**
 * LÉLU — Multi-Chat Universe: the data model behind the grid, carousel,
 * dock and timeline. Pure functions over MultiChatStore conversations.
 *
 * Rules this file holds:
 * - It never invents organisation: no categories, folders or sorting other
 *   than by the conversation's own stored timestamps / the user's pins.
 * - Every time it reports comes from a stored timestamp (createdAt,
 *   updatedAt, message.timestamp). Nothing is fabricated.
 * - Shared context is described as REFERENCES (ids + tiers), never by
 *   copying one chat's messages into another.
 */
import KvStore from "../../../../../core/storage/KvStore";
import type { ChatConversation } from "../../../../../core/multichat/MultiChatStore";

export type UniverseView = "grid" | "carousel";
export type UniverseFocus = "overview" | "window" | "full";
export type TimelineRange = "24h" | "7d" | "30d" | "all";

export const RANGE_MS: Record<TimelineRange, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  all: 0, // computed from the oldest stored timestamp
};

/* ---------------- previews ---------------- */

export interface ChatPreview {
  id: string;
  title: string;
  lastText: string;
  lastRole: "user" | "assistant" | null;
  lastUsed: number;
  createdAt: number;
  unread: number;
  processing: boolean;
  pinned: boolean;
  archived: boolean;
  /** First image attachment in the latest messages, when one exists. */
  attachment: string | null;
}

const IMG = /(https?:\/\/\S+\.(?:png|jpe?g|webp|gif)|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)/i;

export function previewOf(conversation: ChatConversation): ChatPreview {
  const last = conversation.messages[conversation.messages.length - 1];
  let attachment: string | null = null;
  for (let i = conversation.messages.length - 1; i >= Math.max(0, conversation.messages.length - 6); i -= 1) {
    const match = conversation.messages[i]?.text.match(IMG);
    if (match) { attachment = match[1]; break; }
  }
  return {
    id: conversation.id,
    title: conversation.title,
    lastText: (last?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
    lastRole: last?.role ?? null,
    lastUsed: Math.max(conversation.updatedAt, last?.timestamp ?? 0),
    createdAt: conversation.createdAt,
    unread: conversation.unread,
    processing: conversation.processing,
    pinned: conversation.pinned,
    archived: conversation.archived,
    attachment,
  };
}

/** The user's own order (pins first, then the store order) — never a topic sort. */
export function gridOrder(conversations: ChatConversation[]): ChatPreview[] {
  const previews = conversations.map(previewOf);
  return [...previews.filter((p) => p.pinned), ...previews.filter((p) => !p.pinned)];
}

/** The dock and carousel: most recently used first. */
export function recentOrder(conversations: ChatConversation[]): ChatPreview[] {
  return conversations.map(previewOf).sort((a, b) => b.lastUsed - a.lastUsed);
}

/* ---------------- timeline ---------------- */

export interface TimelineMarker {
  conversationId: string;
  at: number;
  /** 0..1 along the range, oldest left. */
  position: number;
  kind: "start" | "message";
}

/** Real activity markers inside the range: chat starts and message times. */
export function timelineMarkers(
  conversations: ChatConversation[],
  range: TimelineRange,
  now = Date.now(),
  perChat = 6,
): TimelineMarker[] {
  const oldest = Math.min(now - 3600_000, ...conversations.map((c) => c.createdAt));
  const span = range === "all" ? Math.max(3600_000, now - oldest) : RANGE_MS[range];
  const from = now - span;
  const markers: TimelineMarker[] = [];
  const place = (at: number) => Math.min(1, Math.max(0, (at - from) / span));
  for (const conversation of conversations) {
    if (conversation.createdAt >= from) {
      markers.push({ conversationId: conversation.id, at: conversation.createdAt, position: place(conversation.createdAt), kind: "start" });
    }
    const recent = conversation.messages.filter((m) => m.timestamp >= from).slice(-perChat);
    for (const message of recent) {
      markers.push({ conversationId: conversation.id, at: message.timestamp, position: place(message.timestamp), kind: "message" });
    }
  }
  return markers.sort((a, b) => a.at - b.at);
}

/* ---------------- shared context (integration point) ---------------- */

export type ContextTier = "current" | "today" | "yesterday" | "week" | "older";

export interface ContextReference {
  conversationId: string;
  title: string;
  tier: ContextTier;
  lastUsed: number;
  /** Linked by the user (linkedIds) — a stronger signal than recency alone. */
  linked: boolean;
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Which other conversations are candidates for shared context, tiered by
 * recency (current → today → yesterday → this week → older). References
 * only: the retrieval layer (CrossChatResolver / memory) decides what, if
 * anything, to load from them. Archived chats are "older" at best.
 */
export function contextReferences(conversations: ChatConversation[], activeId: string, now = Date.now()): ContextReference[] {
  const today = startOfDay(now);
  const yesterday = today - 24 * 3600_000;
  const week = today - 6 * 24 * 3600_000;
  const active = conversations.find((c) => c.id === activeId);
  const linked = new Set(active?.linkedIds ?? []);
  const order: ContextTier[] = ["current", "today", "yesterday", "week", "older"];
  return conversations
    .map((c): ContextReference => {
      const lastUsed = previewOf(c).lastUsed;
      const tier: ContextTier =
        c.id === activeId ? "current"
        : c.archived ? "older"
        : lastUsed >= today ? "today"
        : lastUsed >= yesterday ? "yesterday"
        : lastUsed >= week ? "week"
        : "older";
      return { conversationId: c.id, title: c.title, tier, lastUsed, linked: linked.has(c.id) };
    })
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || Number(b.linked) - Number(a.linked) || b.lastUsed - a.lastUsed);
}

/* ---------------- per-chat appearance (user controlled) ---------------- */

export interface ChatAppearance {
  /** A user-chosen image (URL or data URL); null = imagery disabled; undefined = automatic. */
  image?: string | null;
}

const APPEARANCE_KEY = "lelu.universe.appearance.v1";

export function loadAppearance(): Record<string, ChatAppearance> {
  try {
    return KvStore.getInstance().get<Record<string, ChatAppearance>>(APPEARANCE_KEY) ?? {};
  } catch {
    return {};
  }
}

export function saveAppearance(all: Record<string, ChatAppearance>): void {
  try {
    KvStore.getInstance().set(APPEARANCE_KEY, all);
  } catch {
    /* storage unavailable: appearance stays for this session only */
  }
}

/**
 * The automatic visual for a chat when the user set none and the chat has
 * no image of its own: a deterministic cosmic gradient seeded by the id.
 * A placeholder for Freebuff's subject-aware image selection.
 */
export function autoVisual(id: string): { hueA: number; hueB: number; angle: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const n = h >>> 0;
  const hueA = 260 + (n % 70); // violet → magenta
  const hueB = 190 + ((n >>> 8) % 140); // blue → pink
  return { hueA, hueB, angle: (n >>> 16) % 360 };
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (s < 7 * 86400) return new Date(at).toLocaleDateString([], { weekday: "short" });
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

/* ---------------- artwork (visual only, never organisation) ---------------- */

/** The artwork set shipped in public/universe (from the LÉLU design references). */
export const ARTWORK = ["lotus", "rings", "fabric", "crystals", "build", "jellyfish", "forest", "horizon", "galaxy"] as const;
export type Artwork = (typeof ARTWORK)[number];

const ART_HINTS: Array<[RegExp, Artwork]> = [
  [/daily|reflect|cognit|diary|journal|morning|mind/i, "lotus"],
  [/dev|code|engineer|interface|bug|build ui|app|lélu|lelu/i, "rings"],
  [/fashion|design|style|outfit|cloth|brand/i, "fabric"],
  [/research|ai\b|model|science|study|learn/i, "crystals"],
  [/project|build|system|plan|architect/i, "build"],
  [/idea|creative|art|music|visual|concept/i, "jellyfish"],
  [/health|well|sleep|fitness|food|recover/i, "forest"],
  [/travel|trip|route|move|work|job|money|business/i, "horizon"],
];

/**
 * Which artwork represents a chat: chosen from the chat's OWN title/topic
 * and first message (a picture, not a category — nothing is filed), else a
 * stable pick by id so every chat keeps one identity.
 */
export function artFor(conversation: Pick<ChatConversation, "id" | "title" | "topic" | "messages">): Artwork {
  const text = `${conversation.title} ${conversation.topic} ${conversation.messages[0]?.text ?? ""}`;
  for (const [hint, art] of ART_HINTS) if (hint.test(text)) return art;
  let h = 0;
  for (let i = 0; i < conversation.id.length; i += 1) h = (h * 31 + conversation.id.charCodeAt(i)) >>> 0;
  return ARTWORK[h % ARTWORK.length];
}

/* ---------------- Cosmos mode (persisted, one owner) ---------------- */

/**
 * workspace — a clean, solid Workspace Universe; the live Cosmos scene is
 *             paused (SceneRenderBudget occlusion), so it costs no GPU.
 * floating  — the windows float over the live, moving Cosmos.
 */
export type CosmosMode = "workspace" | "floating";
const MODE_KEY = "lelu.universe.cosmosMode.v1";

export function loadCosmosMode(): CosmosMode {
  try {
    return KvStore.getInstance().get<CosmosMode>(MODE_KEY) === "floating" ? "floating" : "workspace";
  } catch {
    return "workspace";
  }
}

export function saveCosmosMode(mode: CosmosMode): void {
  try {
    KvStore.getInstance().set(MODE_KEY, mode);
  } catch {
    /* storage unavailable: the mode lasts for this session */
  }
}
