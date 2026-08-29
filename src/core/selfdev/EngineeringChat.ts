/**
 * ==========================================================
 * LÉLU
 * ENGINEERING CHAT — the secondary conversation for engineering,
 * cognition, debugging and self-improvement.
 *
 * This is NOT a second chat engine. It is ONE persistent
 * MultiChatStore conversation (tagged "engineering") whose
 * messages are produced by the SAME AIService.chat() pipeline
 * every other message goes through — routed with an explicit
 * forceIntent so it always lands in EngineeringResolver instead
 * of depending on keyword-guessing.
 *
 * Two ways this thread gets messages:
 *   1. The user types into it (send()) — a real chat() round trip.
 *   2. LÉLU's own cognition posts into it when SelfDevelopmentEngine
 *      detects a REAL opportunity (recordObservation()) — always
 *      built from the same real finding/evidence text already
 *      computed for the ImprovementQueue entry, never invented.
 * ==========================================================
 */

import MultiChatStore, { type ChatConversation, type ChatMessage } from "../multichat/MultiChatStore";
import AIService from "../AIService";

const ENGINEERING_TAG = "engineering";
const ENGINEERING_TITLE = "Engineering";

export default class EngineeringChat {
  private static instance: EngineeringChat | null = null;

  private readonly store = MultiChatStore.getInstance();
  private threadId: string | null = null;

  private constructor() {}

  public static getInstance(): EngineeringChat {
    if (!EngineeringChat.instance) {
      EngineeringChat.instance = new EngineeringChat();
    }
    return EngineeringChat.instance;
  }

  /** Find the ONE persistent engineering conversation, or create it once. */
  public getOrCreateThread(): ChatConversation {
    if (this.threadId) {
      const cached = this.store.get(this.threadId);
      if (cached) return cached;
    }

    const existing =
      this.store.list().find((conversation) => conversation.tags.includes(ENGINEERING_TAG)) ??
      this.store.listArchived().find((conversation) => conversation.tags.includes(ENGINEERING_TAG));

    if (existing) {
      this.threadId = existing.id;
      if (existing.archived) {
        this.store.unarchive(existing.id);
      }
      return this.store.get(existing.id) ?? existing;
    }

    const created = this.store.create(ENGINEERING_TITLE);
    this.store.addTag(created.id, ENGINEERING_TAG);
    this.threadId = created.id;
    return this.store.get(created.id) ?? created;
  }

  public getThreadId(): string {
    return this.getOrCreateThread().id;
  }

  public getMessages(): ChatMessage[] {
    return this.getOrCreateThread().messages;
  }

  public subscribe(listener: (conversations: ChatConversation[]) => void): () => void {
    return this.store.subscribe(listener);
  }

  /**
   * The user sends a message into the engineering thread. Goes through
   * the SAME AIService.chat() every message in the app uses — the only
   * difference is forceIntent, so this thread is never at the mercy of
   * keyword detection missing an engineering-flavored message that
   * didn't happen to use one of EngineeringResolver's trigger words.
   */
  public async send(message: string): Promise<ChatMessage> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error("Empty message.");
    }
    const thread = this.getOrCreateThread();

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      timestamp: Date.now(),
      source: "local",
    };
    this.store.addMessage(thread.id, userMessage);

    const ai = AIService.getInstance();
    const response = await ai.chat(trimmed, undefined, undefined, { forceIntent: "engineering" });

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: response.text,
      timestamp: Date.now(),
      source: "ai",
      provider: response.provider,
    };
    this.store.addMessage(thread.id, assistantMessage);
    return assistantMessage;
  }

  /**
   * LÉLU posts a real observation into the thread on her own —
   * "she should be able to initiate an engineering conversation from
   * a cognitive observation." The caller (SelfDevelopmentEngine) must
   * pass text built ONLY from real diagnostic/proposal data; this
   * method does not itself generate or embellish anything.
   */
  public recordObservation(text: string): ChatMessage {
    const thread = this.getOrCreateThread();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text,
      timestamp: Date.now(),
      source: "local",
    };
    this.store.addMessage(thread.id, message);
    return message;
  }
}
