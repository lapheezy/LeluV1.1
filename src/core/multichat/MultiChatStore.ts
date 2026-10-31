/**
 * ==========================================================
 * LÉLU
 * MULTI-CHAT STORE — persistent conversation workspace
 *
 * The single source of truth for the Multi-Chat Workspace. Each
 * conversation is an isolated slice of the ONE LÉLU cognition:
 * its own id, title, message history, topic, local context,
 * timestamps, unread/processing state, and links to related
 * conversations / projects / tags.
 *
 * Persistence goes through the existing KvStore (localStorage +
 * fallbacks) — the same layer used by AgentStore, ProjectStore
 * and AvatarStore. It never duplicates the Brain's memory:
 * conversation *history* lives here; durable *knowledge* still
 * lives in the Brain, promoted through the existing memory path.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { ChatActivity } from "./TurnActivity";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  source: "ai" | "local";
  provider?: string;
  confidence?: number;
  reasoning?: unknown;
  plan?: unknown;
  /** What LÉLU did for this reply (tools, pages, sources), from real events. */
  activity?: ChatActivity;
  /**
   * The conversation this message was first written in, when it was
   * carried into a merged chat. LÉLU and the transcript use it to keep
   * the merged sources apart.
   */
  origin?: { conversationId: string; title: string };
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  linkedIds: string[];
  projectId: string | null;
  tags: string[];
  topic: string;
  unread: number;
  processing: boolean;
}

export type ConversationSearchScope =
  | "current"
  | "all"
  | "linked"
  | "project"
  | "archived";

export interface ConversationSearchHit {
  conversationId: string;
  title: string;
  messageId: string;
  text: string;
  timestamp: number;
  projectId: string | null;
}

type Listener = (conversations: ChatConversation[]) => void;

const KEY = "multichat.workspace.v1";
const MAX_MESSAGES = 600;
/**
 * How long a write may wait for the writes behind it.
 *
 * Long enough that a token stream (tens of deltas a second) collapses
 * into one write, short enough that an ordinary action is on disk before
 * anyone could act on having done it.
 */
const COALESCE_MS = 250;
/** Practically unlimited — archived conversations don't count against active slots. */
const MAX_ACTIVE = 200;
const DEFAULT_TITLE = "New chat";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "always", "been", "before", "being",
  "could", "does", "doing", "from", "have", "having", "into", "just",
  "know", "like", "make", "more", "much", "never", "please", "really",
  "should", "some", "that", "them", "then", "there", "these", "they",
  "this", "those", "want", "what", "when", "where", "which", "will",
  "with", "would", "your", "yours", "youre", "tell", "keep", "update",
]);

/** Shared tokenizer for conversation search + cross-chat relevance. */
export function tokenizeText(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (word.length < 3 || STOP_WORDS.has(word)) {
      continue;
    }
    if (!seen.has(word)) {
      seen.add(word);
      tokens.push(word);
    }
  }
  return tokens;
}

interface StoredWorkspace {
  conversations: ChatConversation[];
  activeId: string;
}

export default class MultiChatStore {
  private static instance: MultiChatStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();
  private activeId: string;

  /**
   * The conversations, in memory, as the single read path.
   *
   * Every read used to go to KvStore and JSON.parse the whole workspace,
   * and every write used to JSON.stringify it to two backends. Both
   * happened once per streamed token, because GenesisBridge upserts the
   * assistant message on every SSE delta. Measured on one short turn:
   * 384 Storage.setItem calls and 670KB written, with the main thread
   * blocked for 34.9 of the turn's 36.8 seconds.
   *
   * This store is the only writer, so a cache it maintains itself is
   * authoritative — not an optimisation that can disagree with the
   * truth.
   */
  private cache: ChatConversation[] | null = null;
  /** A coalesced write that has not landed yet. */
  private pendingWrite: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  private constructor() {
    const stored = this.kv.get<StoredWorkspace>(KEY);
    const conversations = this.readAll();
    this.activeId =
      stored?.activeId && conversations.some((conversation) => conversation.id === stored.activeId)
        ? stored.activeId
        : conversations[0]?.id ?? "";
    if (!this.activeId) {
      this.ensureSeeded();
    }
    this.installLifecycleFlush();
  }

  public static getInstance(): MultiChatStore {
    if (!MultiChatStore.instance) {
      MultiChatStore.instance = new MultiChatStore();
    }
    return MultiChatStore.instance;
  }

  /* ------------------------------ persistence ------------------------------ */

  private readAll(): ChatConversation[] {
    if (this.cache !== null) return this.cache;
    const stored = this.kv.get<StoredWorkspace>(KEY);
    if (!stored || !Array.isArray(stored.conversations) || stored.conversations.length === 0) {
      return [];
    }
    this.cache = stored.conversations;
    return this.cache;
  }

  /** Guarantee at least one conversation exists (LÉLU never boots empty). */
  private ensureSeeded(): ChatConversation[] {
    const existing = this.readAll();
    if (existing.length > 0) {
      return existing;
    }
    const conversation = this.makeConversation(DEFAULT_TITLE);
    this.activeId = conversation.id;
    this.cache = [conversation];
    this.dirty = true;
    // The first conversation of a session is durable immediately: there
    // is nothing to coalesce with, and losing it would mean booting
    // empty.
    this.flush();
    return this.cache;
  }

  /**
   * Record a change: in memory and on screen immediately, on disk soon.
   *
   * The cache and the subscribers are updated synchronously, so nothing
   * about the UI or about what any reader sees becomes eventual. Only
   * the serialisation is deferred, and only by COALESCE_MS, so a burst
   * of streamed deltas costs one write instead of one per token.
   */
  private persist(conversations: ChatConversation[], activeId?: string): void {
    this.cache = conversations;
    if (activeId !== undefined) this.activeId = activeId;
    this.dirty = true;
    this.scheduleWrite();
    this.notify();
  }

  /**
   * Write now.
   *
   * Called where the deferral would be a risk rather than a saving: when
   * a turn finishes, and when the page is going away. Also safe to call
   * at any time — it is a no-op when nothing is dirty.
   */
  public flush(): void {
    if (this.pendingWrite !== null) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.kv.set(KEY, {
      conversations: this.cache ?? this.readAll(),
      activeId: this.activeId,
    });
  }

  private scheduleWrite(): void {
    if (this.pendingWrite !== null) return;
    this.pendingWrite = setTimeout(() => {
      this.pendingWrite = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.kv.set(KEY, {
        conversations: this.cache ?? this.readAll(),
        activeId: this.activeId,
      });
    }, COALESCE_MS);
    // A pending save must not be the reason a process refuses to end;
    // the lifecycle listeners below are what guarantee it lands.
    (this.pendingWrite as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Nothing in flight may be lost to a closing tab.
   *
   * pagehide and visibilitychange are the two that actually fire on
   * mobile Safari, where beforeunload does not; all three are cheap and
   * flush() is a no-op when there is nothing to write.
   */
  private installLifecycleFlush(): void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const flush = () => this.flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }
  }

  /* --------------------------------- events -------------------------------- */

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const list = this.list();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (error) {
        console.error("[Lélu MultiChatStore] listener threw (contained)", error);
      }
    }
  }

  private makeConversation(title: string): ChatConversation {
    return {
      id: crypto.randomUUID(),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
      linkedIds: [],
      projectId: null,
      tags: [],
      topic: "",
      unread: 0,
      processing: false,
    };
  }

  /* --------------------------------- read ---------------------------------- */

  /** Active conversations only — archived ones are excluded. */
  public list(): ChatConversation[] {
    return this.ensureSeeded().filter((conv) => !conv.archived);
  }

  /** All conversations including archived. */
  public listAll(): ChatConversation[] {
    return this.ensureSeeded();
  }

  /** Archived conversations for restoration. */
  public listArchived(): ChatConversation[] {
    return this.ensureSeeded().filter((conv) => conv.archived);
  }


  /** Merge remote conversations and retain the local active chat. */
  public mergeRemote(conversations: ChatConversation[]): void {
    const local = this.list();
    const byId = new Map(local.map((conversation) => [conversation.id, conversation]));
    for (const remote of conversations) {
      const current = byId.get(remote.id);
      if (!current || remote.updatedAt > current.updatedAt) {
        byId.set(remote.id, remote);
      }
    }
    this.persist([...byId.values()]);
  }

  public get(id: string): ChatConversation | undefined {
    return this.ensureSeeded().find((conversation) => conversation.id === id);
  }

  public getActiveId(): string {
    return this.activeId;
  }

  public getActive(): ChatConversation | undefined {
    return this.get(this.activeId);
  }

  /** Restore the full workspace snapshot used to seed React state on boot. */
  public restoreWorkspace(): { conversations: ChatConversation[]; activeId: string; messages: ChatMessage[] } {
    const conversations = this.ensureSeeded();
    const active = conversations.find((conversation) => conversation.id === this.activeId) ?? conversations[0];
    this.activeId = active.id;
    return {
      conversations,
      activeId: active.id,
      messages: active.messages,
    };
  }

  /* -------------------------------- mutation -------------------------------- */

  public create(title = DEFAULT_TITLE): ChatConversation {
    const conversations = this.ensureSeeded();
    const conversation = this.makeConversation(title);
    const next = [conversation, ...conversations].slice(0, MAX_ACTIVE);
    this.activeId = conversation.id;
    this.persist(next, conversation.id);
    return conversation;
  }

  /**
   * Create a conversation WITHOUT selecting it.
   *
   * `create()` makes the new conversation active, which is right when a
   * person asked for a new chat and wrong for every other caller. The
   * difference was measured, not theorised: cognition's 10-second tick
   * reaches SelfDevelopmentEngine.announce(), which calls
   * EngineeringChat.getOrCreateThread(), which called create() — so the
   * first self-development observation of the session silently moved the
   * user into the engineering thread. A person who had just asked a
   * question watched an unrelated observation appear in its place while
   * their own answer landed, correctly, in a conversation they were no
   * longer looking at.
   *
   * Tags are applied here rather than through addTag() afterwards so the
   * conversation is persisted once, complete, instead of twice.
   */
  public createBackground(title = DEFAULT_TITLE, tags: string[] = []): ChatConversation {
    const conversations = this.ensureSeeded();
    const conversation = this.makeConversation(title);
    if (tags.length > 0) {
      conversation.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    }
    // Appended, not prepended: create() puts a user's new chat at the top
    // of their list, and a conversation nobody asked for has not earned
    // that place.
    //
    // At capacity, the oldest conversation is dropped rather than the new
    // one — a plain slice() would silently discard the conversation this
    // call just returned — and never the one the user is looking at.
    let next = [...conversations, conversation];
    while (next.length > MAX_ACTIVE) {
      const victim = next.findIndex(
        (item) => item.id !== this.activeId && item.id !== conversation.id,
      );
      if (victim < 0) break;
      next = [...next.slice(0, victim), ...next.slice(victim + 1)];
    }
    // activeId is deliberately untouched.
    this.persist(next);
    return conversation;
  }

  /** Archive a conversation — hides from active list, preserves state. */
  public archive(id: string): string {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((conv) => conv.id === id);
    if (!conversation || conversations.length <= 1) {
      return this.activeId;
    }
    conversation.archived = true;
    conversation.updatedAt = Date.now();
    if (this.activeId === id) {
      const active = conversations.find((conv) => !conv.archived) ?? conversations[0];
      active.unread = 0;
      this.activeId = active.id;
      this.persist(conversations, active.id);
      return active.id;
    }
    this.persist(conversations);
    return this.activeId;
  }

  /** Restore an archived conversation. */
  public unarchive(id: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((conv) => conv.id === id);
    if (!conversation) return;
    conversation.archived = false;
    conversation.updatedAt = Date.now();
    this.persist(conversations);
  }

  public switchActive(id: string): ChatConversation | undefined {
    const conversations = this.ensureSeeded();
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) {
      return undefined;
    }
    target.unread = 0;
    this.activeId = id;
    this.persist(conversations, id);
    return target;
  }

  public addMessage(id: string, message: ChatMessage): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.messages = [...conversation.messages, message].slice(-MAX_MESSAGES);
    conversation.updatedAt = message.timestamp || Date.now();
    if (message.role === "user" && message.text.trim()) {
      conversation.topic = this.detectTopic(message.text);
      conversation.title = this.deriveTitle(conversation, message.text);
    }
    if (id !== this.activeId) {
      conversation.unread += 1;
    }
    this.persist(conversations);
  }

  /**
   * Replace an existing message by id, or append when new. Streaming
   * updates and final completions share one id, so progressive text
   * renders in place instead of duplicating bubbles.
   */
  public upsertMessage(id: string, message: ChatMessage): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    const index = conversation.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      const next = [...conversation.messages];
      next[index] = { ...next[index], ...message };
      conversation.messages = next;
    } else {
      conversation.messages = [...conversation.messages, message].slice(-MAX_MESSAGES);
      if (id !== this.activeId) {
        conversation.unread += 1;
      }
    }
    conversation.updatedAt = message.timestamp || Date.now();
    if (message.role === "user" && message.text.trim()) {
      conversation.topic = this.detectTopic(message.text);
      conversation.title = this.deriveTitle(conversation, message.text);
    }
    this.persist(conversations);
  }

  public clear(id: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.messages = [];
    conversation.topic = "";
    conversation.updatedAt = Date.now();
    this.persist(conversations);
  }

  public rename(id: string, title: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.title = title.trim() || DEFAULT_TITLE;
    conversation.updatedAt = Date.now();
    this.persist(conversations);
  }

  public remove(id: string): string {
    const conversations = this.ensureSeeded();
    if (conversations.length <= 1) {
      return this.activeId;
    }
    const next = conversations.filter((conversation) => conversation.id !== id);
    if (this.activeId === id) {
      const active = next[0];
      active.unread = 0;
      this.activeId = active.id;
      this.persist(next, active.id);
      return active.id;
    }
    this.persist(next);
    return this.activeId;
  }

  public duplicate(id: string): ChatConversation | undefined {
    const source = this.get(id);
    if (!source) {
      return undefined;
    }
    const now = Date.now();
    const copy: ChatConversation = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      title: `${source.title} (copy)`,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      unread: 0,
      processing: false,
    };
    const conversations = this.ensureSeeded();
    this.activeId = copy.id;
    this.persist([copy, ...conversations].slice(0, MAX_ACTIVE), copy.id);
    return copy;
  }

  /**
   * A NEW conversation holding the histories of two or more chats, in
   * time order, with every message labelled by the chat it came from.
   * The originals are left exactly as they were (only linked to the
   * merge), so nothing any of them said is lost or rewritten. The merge
   * becomes active. Undefined when fewer than two distinct chats exist.
   */
  public merge(ids: string[], title?: string, options: { activate?: boolean } = {}): ChatConversation | undefined {
    const sources = [...new Set(ids)]
      .map((id) => this.get(id))
      .filter((conversation): conversation is ChatConversation => Boolean(conversation));
    if (sources.length < 2) return undefined;
    const carry = (source: ChatConversation): ChatMessage[] =>
      source.messages.map((message) => ({
        ...structuredClone(message),
        id: crypto.randomUUID(),
        // A message already carried from elsewhere keeps its first source.
        origin: message.origin ?? { conversationId: source.id, title: source.title },
      }));
    const names = sources.map((source) => source.title);
    const fallbackTitle =
      names.length <= 3 ? `Merged: ${names.join(" + ")}` : `Merged: ${names.slice(0, 2).join(" + ")} + ${names.length - 2} more`;
    const now = Date.now();
    const merged: ChatConversation = {
      ...this.makeConversation(title?.trim() || fallbackTitle),
      messages: sources
        .flatMap(carry)
        .sort((x, y) => x.timestamp - y.timestamp)
        .slice(-MAX_MESSAGES),
      linkedIds: sources.map((source) => source.id),
      projectId: sources.find((source) => source.projectId)?.projectId ?? null,
      tags: [...new Set(sources.flatMap((source) => source.tags))],
      createdAt: now,
      updatedAt: now,
    };
    const sourceIds = new Set(merged.linkedIds);
    const conversations = this.ensureSeeded();
    for (const conversation of conversations) {
      if (sourceIds.has(conversation.id) && !conversation.linkedIds.includes(merged.id)) {
        conversation.linkedIds = [...conversation.linkedIds, merged.id];
      }
    }
    // LÉLU merging from inside a reply does not pull the user away from
    // the conversation they are reading; a merge they start does.
    const activate = options.activate ?? true;
    if (activate) this.activeId = merged.id;
    this.persist([merged, ...conversations].slice(0, MAX_ACTIVE), activate ? merged.id : undefined);
    return merged;
  }

  public pin(id: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.pinned = !conversation.pinned;
    this.persist(conversations);
  }

  public reorder(ids: string[]): void {
    const conversations = this.ensureSeeded();
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((conversation): conversation is ChatConversation => Boolean(conversation));
    // Preserve any conversations not present in the requested order.
    for (const conversation of conversations) {
      if (!ordered.some((item) => item.id === conversation.id)) {
        ordered.push(conversation);
      }
    }
    this.persist(ordered);
  }

  public link(a: string, b: string): void {
    if (a === b) {
      return;
    }
    const conversations = this.ensureSeeded();
    for (const conversation of conversations) {
      if (conversation.id === a && !conversation.linkedIds.includes(b)) {
        conversation.linkedIds.push(b);
      }
      if (conversation.id === b && !conversation.linkedIds.includes(a)) {
        conversation.linkedIds.push(a);
      }
    }
    this.persist(conversations);
  }

  public unlink(a: string, b: string): void {
    const conversations = this.ensureSeeded();
    for (const conversation of conversations) {
      if (conversation.id === a) {
        conversation.linkedIds = conversation.linkedIds.filter((id) => id !== b);
      }
      if (conversation.id === b) {
        conversation.linkedIds = conversation.linkedIds.filter((id) => id !== a);
      }
    }
    this.persist(conversations);
  }

  public setProject(id: string, projectId: string | null): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.projectId = projectId;
    conversation.updatedAt = Date.now();
    this.persist(conversations);
  }

  public addTag(id: string, tag: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation || !tag.trim()) {
      return;
    }
    const clean = tag.trim().toLowerCase();
    if (!conversation.tags.includes(clean)) {
      conversation.tags = [...conversation.tags, clean];
      this.persist(conversations);
    }
  }

  public setProcessing(id: string, processing: boolean): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.processing = processing;
    this.persist(conversations);
  }

  public markRead(id: string): void {
    const conversations = this.ensureSeeded();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.unread = 0;
    this.persist(conversations);
  }

  /* -------------------------------- search --------------------------------- */

  public search(query: string, scope: ConversationSearchScope = "all"): ConversationSearchHit[] {
    const conversations = this.ensureSeeded();
    const current = this.get(this.activeId);
    const qTokens = new Set(tokenizeText(query));
    if (qTokens.size === 0) {
      return [];
    }

    const scoped = conversations.filter((conversation) => {
      switch (scope) {
        case "current":
          return conversation.id === this.activeId;
        case "linked":
          return (
            conversation.id === this.activeId ||
            current?.linkedIds.includes(conversation.id) ||
            conversation.linkedIds.includes(this.activeId)
          );
        case "project":
          return current?.projectId != null && conversation.projectId === current.projectId;
        default:
          return true;
      }
    });

    const hits: ConversationSearchHit[] = [];
    for (const conversation of scoped) {
      for (const message of conversation.messages) {
        const tokens = tokenizeText(message.text);
        const overlap = tokens.filter((token) => qTokens.has(token)).length;
        if (overlap > 0) {
          hits.push({
            conversationId: conversation.id,
            title: conversation.title,
            messageId: message.id,
            text: message.text.slice(0, 240),
            timestamp: message.timestamp,
            projectId: conversation.projectId,
          });
        }
      }
    }
    return hits.sort((a, b) => b.timestamp - a.timestamp);
  }

  /* ------------------------------- utilities ------------------------------- */

  private detectTopic(text: string): string {
    const words = text
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 4);
    return words.slice(0, 3).join(" ") || "general";
  }

  private deriveTitle(conversation: ChatConversation, text: string): string {
    const userCount = conversation.messages.filter((message) => message.role === "user").length;
    if (conversation.title === DEFAULT_TITLE && userCount <= 1) {
      const trimmed = text.trim();
      return trimmed.slice(0, 36) || DEFAULT_TITLE;
    }
    return conversation.title;
  }
}
