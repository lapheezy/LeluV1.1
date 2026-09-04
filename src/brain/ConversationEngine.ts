/**
 * ==========================================================
 * LÉLU
 * CONVERSATION ENGINE — the SHORT-TERM conversation memory
 *
 * This is the authoritative record of the turns in the current
 * conversation. It is what makes the next response aware of the
 * last one.
 *
 * It previously stored user messages ONLY, as bare strings with no
 * role and no persistence. Nothing recorded what LÉLU herself said,
 * so she could not see her own previous turn — which is why she
 * re-asked questions the user had already answered — and nothing
 * survived a reload.
 *
 * It now records BOTH sides as role-tagged turns and persists them
 * through the existing KvStore. There is no second memory system:
 * long-term memory remains the Brain/PatternMemory path, and this
 * remains the short-term window that feeds it.
 * ==========================================================
 */

import Brain from "./Brain";
import KvStore from "../core/storage/KvStore";
import type ResponsePattern from "./ResponsePattern";

export type ConversationRole = "user" | "assistant";

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
  timestamp: number;
}

export interface ConversationState {
  lastMessage: string;
  lastTopic: string;
  activeMemories: ResponsePattern[];
  /** User-authored messages only — preserved for existing consumers. */
  recentMessages: string[];
  /** The real dialogue, both sides, oldest first. */
  recentTurns: ConversationTurn[];
  messageCount: number;
  lastInteraction: number;
}

/** How many turns of dialogue are carried as short-term context. */
const MAX_TURNS = 40;
/** How many of those are handed to the model on a normal turn. */
const MODEL_TURN_WINDOW = 16;
const KEY = "lelu.conversation.v1";

interface PersistedConversation {
  turns: ConversationTurn[];
  lastTopic: string;
  messageCount: number;
  lastInteraction: number;
}

export default class ConversationEngine {
  private state: ConversationState = {
    lastMessage: "",
    lastTopic: "",
    activeMemories: [],
    recentMessages: [],
    recentTurns: [],
    messageCount: 0,
    lastInteraction: 0,
  };

  private loaded = false;

  constructor(private readonly brain: Brain) {}

  /** Restore the conversation window once, lazily. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stored = KvStore.getInstance().get<PersistedConversation>(KEY);
      if (stored?.turns?.length) {
        this.state = {
          ...this.state,
          recentTurns: stored.turns.slice(-MAX_TURNS),
          recentMessages: stored.turns
            .filter((turn) => turn.role === "user")
            .map((turn) => turn.text)
            .slice(-20),
          lastMessage:
            [...stored.turns].reverse().find((turn) => turn.role === "user")?.text ?? "",
          lastTopic: stored.lastTopic ?? "",
          messageCount: stored.messageCount ?? stored.turns.length,
          lastInteraction: stored.lastInteraction ?? 0,
        };
      }
    } catch {
      // A conversation that cannot be restored must never block a new one.
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, {
        turns: this.state.recentTurns,
        lastTopic: this.state.lastTopic,
        messageCount: this.state.messageCount,
        lastInteraction: this.state.lastInteraction,
      } satisfies PersistedConversation);
    } catch {
      // best-effort; the in-memory window still works
    }
  }

  /**
   * Record one turn of the dialogue. BOTH roles must be recorded — a
   * conversation with only one side in it cannot inform the next reply.
   */
  public record(role: ConversationRole, text: string): void {
    this.ensureLoaded();
    const clean = (text ?? "").trim();
    if (!clean) return;

    const turn: ConversationTurn = { role, text: clean, timestamp: Date.now() };
    const recentTurns = [...this.state.recentTurns, turn].slice(-MAX_TURNS);

    this.state = {
      ...this.state,
      recentTurns,
      lastMessage: role === "user" ? clean : this.state.lastMessage,
      lastTopic: role === "user" ? this.detectTopic(clean) : this.state.lastTopic,
      recentMessages:
        role === "user"
          ? [...this.state.recentMessages, clean].slice(-20)
          : this.state.recentMessages,
      messageCount: this.state.messageCount + 1,
      lastInteraction: Date.now(),
    };
    this.persist();
  }

  /**
   * Record a user turn and refresh the active memories for it.
   * Kept as the existing entry point; `record` is the primitive.
   */
  public async update(message: string): Promise<void> {
    this.ensureLoaded();
    this.record("user", message);
    await this.refresh(message);
  }

  /**
   * Refresh the active memories for a turn that is ALREADY recorded.
   * Callers that record the turn themselves (so it is in the active
   * conversation before generation) use this instead of `update`, which
   * would otherwise record the same turn twice.
   */
  public async refresh(message: string): Promise<void> {
    this.ensureLoaded();
    try {
      const memories = await this.brain.recall(message);
      this.state = { ...this.state, activeMemories: memories.slice(0, 10) };
    } catch {
      // recall failure must not lose the turn we just recorded
    }
  }

  /**
   * The dialogue window handed to the model as prior context.
   *
   * Providers assemble `[...context, ...request.messages, {user, prompt}]`,
   * so this returns the turns BEFORE the current one — the current user
   * message travels as `prompt` and must not be duplicated here.
   */
  public modelMessages(limit = MODEL_TURN_WINDOW): { role: ConversationRole; content: string }[] {
    this.ensureLoaded();
    return this.state.recentTurns
      .slice(-limit)
      .map((turn) => ({ role: turn.role, content: turn.text }));
  }

  /** Role-tagged transcript, oldest first. */
  public turns(): ConversationTurn[] {
    this.ensureLoaded();
    return [...this.state.recentTurns];
  }

  private detectTopic(message: string): string {
    const words = message
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 4);
    return words[0] ?? "general";
  }

  public async starters(): Promise<string[]> {
    const reflection = await this.brain.reflect();
    if (reflection.memories.length === 0) {
      return ["What would you like to explore?", "What are you building?"];
    }
    return [
      "I remember what we have been building together.",
      "I can help organize the next step.",
      "Would you like to continue one of your active projects?",
    ];
  }

  public context(): ConversationState {
    this.ensureLoaded();
    return {
      ...this.state,
      activeMemories: [...this.state.activeMemories],
      recentMessages: [...this.state.recentMessages],
      recentTurns: [...this.state.recentTurns],
    };
  }

  public clear(): void {
    this.loaded = true;
    this.state = {
      lastMessage: "",
      lastTopic: "",
      activeMemories: [],
      recentMessages: [],
      recentTurns: [],
      messageCount: 0,
      lastInteraction: 0,
    };
    this.persist();
  }
}
