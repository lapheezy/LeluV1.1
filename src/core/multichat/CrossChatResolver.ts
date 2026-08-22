/**
 * ==========================================================
 * LÉLU
 * CROSS-CHAT CONTEXT RESOLVER
 *
 * Intentional cross-reference between conversations — NOT a
 * context dump. Each chat keeps its own local context; LÉLU
 * retrieves another conversation only when it is actually
 * relevant to the current task.
 *
 * Relevance is scored by:
 *   - keyword overlap with the current query / topic
 *   - explicit links (user linked the two chats)
 *   - shared project
 *   - shared tags
 *
 * The result is a compact, traceable context block (with real
 * conversation + message ids) that can be folded into the ONE
 * AIService request. No second brain, no second memory.
 * ==========================================================
 */

import MultiChatStore, { tokenizeText, type ConversationSearchHit } from "./MultiChatStore";

export interface CrossChatHit extends ConversationSearchHit {
  score: number;
  linked: boolean;
  sameProject: boolean;
}

export default class CrossChatResolver {
  private static instance: CrossChatResolver | null = null;

  public static getInstance(): CrossChatResolver {
    if (!CrossChatResolver.instance) {
      CrossChatResolver.instance = new CrossChatResolver();
    }
    return CrossChatResolver.instance;
  }

  /**
   * Rank relevant hits from OTHER conversations, best-first. The
   * current conversation is always excluded; explicit links, a shared
   * project, and shared tags all boost a conversation's relevance.
   */
  public relevant(currentConversationId: string, query: string, limit = 4): CrossChatHit[] {
    const store = MultiChatStore.getInstance();
    const current = store.get(currentConversationId);
    const qTokens = new Set(tokenizeText(query));
    const hits: CrossChatHit[] = [];

    for (const conversation of store.list()) {
      if (conversation.id === currentConversationId) {
        continue;
      }
      const linked =
        Boolean(current?.linkedIds.includes(conversation.id)) ||
        Boolean(conversation.linkedIds.includes(currentConversationId));
      const sameProject =
        current?.projectId != null && conversation.projectId === current.projectId;
      const shareTags =
        Boolean(current) &&
        conversation.tags.some((tag) => current?.tags.includes(tag));

      for (const message of conversation.messages) {
        const tokens = tokenizeText(message.text);
        if (tokens.length === 0) {
          continue;
        }
        const overlap = tokens.filter((token) => qTokens.has(token)).length;
        if (overlap === 0) {
          continue;
        }
        // Base score from keyword overlap; relationships add intentionality.
        const score =
          overlap +
          (linked ? 4 : 0) +
          (sameProject ? 3 : 0) +
          (shareTags ? 2 : 0);
        hits.push({
          conversationId: conversation.id,
          title: conversation.title,
          messageId: message.id,
          text: message.text.slice(0, 240),
          timestamp: message.timestamp,
          projectId: conversation.projectId,
          score,
          linked,
          sameProject,
        });
      }
    }

    // One best hit per conversation, then top-N overall.
    const bestPerConversation = new Map<string, CrossChatHit>();
    for (const hit of hits) {
      const previous = bestPerConversation.get(hit.conversationId);
      if (!previous || hit.score > previous.score || (hit.score === previous.score && hit.timestamp > previous.timestamp)) {
        bestPerConversation.set(hit.conversationId, hit);
      }
    }

    return [...bestPerConversation.values()]
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Build a compact context block for the current request. Returns an
   * empty string when nothing is relevant (silence over noise).
   */
  public buildContext(currentConversationId: string, query: string, limit = 3): string {
    const effectiveQuery = query?.trim() || this.currentTopic(currentConversationId);
    if (!effectiveQuery) {
      return "";
    }
    const hits = this.relevant(currentConversationId, effectiveQuery, limit);
    if (hits.length === 0) {
      return "";
    }
    const lines = hits.map((hit) => {
      const kind = hit.linked ? "linked" : hit.sameProject ? "same project" : "related";
      return `- "${hit.title}" [${kind}]: ${hit.text}`;
    });
    return (
      "[Relevant prior conversations — reference only if helpful; never fabricate these]\n" +
      lines.join("\n")
    );
  }

  private currentTopic(currentConversationId: string): string {
    const conversation = MultiChatStore.getInstance().get(currentConversationId);
    if (!conversation) {
      return "";
    }
    if (conversation.topic) {
      return conversation.topic;
    }
    const lastUser = [...conversation.messages].reverse().find((message) => message.role === "user");
    return lastUser?.text ?? conversation.title ?? "";
  }
}
