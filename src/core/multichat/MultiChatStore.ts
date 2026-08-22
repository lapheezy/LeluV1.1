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
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
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
const MAX_CONVERSATIONS = 40;
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
  }

  public static getInstance(): MultiChatStore {
    if (!MultiChatStore.instance) {
      MultiChatStore.instance = new MultiChatStore();
    }
    return MultiChatStore.instance;
  }

  /* ------------------------------ persistence ------------------------------ */

  private readAll(): ChatConversation[] {
    const stored = this.kv.get<StoredWorkspace>(KEY);
    if (!stored || !Array.isArray(stored.conversations) || stored.conversations.length === 0) {
      return [];
    }
    return stored.conversations;
  }

  /** Guarantee at least one conversation exists (LÉLU never boots empty). */
  private ensureSeeded(): ChatConversation[] {
    const existing = this.readAll();
    if (existing.length > 0) {
      return existing;
    }
    const conversation = this.makeConversation(DEFAULT_TITLE);
    this.activeId = conversation.id;
    this.kv.set(KEY, { conversations: [conversation], activeId: conversation.id });
    return [conversation];
  }

  private persist(conversations: ChatConversation[], activeId?: string): void {
    this.kv.set(KEY, {
      conversations,
      activeId: activeId ?? this.activeId,
    });
    this.notify();
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
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
      linkedIds: [],
      projectId: null,
      tags: [],
      topic: "",
      unread: 0,
      processing: false,
    };
  }

  /* --------------------------------- read ---------------------------------- */

  public list(): ChatConversation[] {
    return this.ensureSeeded();
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
    const next = [conversation, ...conversations].slice(0, MAX_CONVERSATIONS);
    this.activeId = conversation.id;
    this.persist(next, conversation.id);
    return conversation;
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

  /** Remove a conversation; returns the new active id (never zero chats). */
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
    this.persist([copy, ...conversations].slice(0, MAX_CONVERSATIONS), copy.id);
    return copy;
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
