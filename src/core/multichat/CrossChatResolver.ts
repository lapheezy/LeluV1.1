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
 *
 * AUTHORIZATION. Another chat's CONTENT is used only when the user
 * authorized it: they linked the two chats, or put both in the same
 * project. A chat that merely looks related (shared words) is never
 * read — it is named to LÉLU so she can offer to use it, and the user
 * decides (link it, or merge the two). Everything used is labelled by
 * the chat it came from, and kept apart from the current chat's own
 * history (that is AIService.priorTurnsFor), so she can always say
 * which chat a point came from.
 * ==========================================================
 */

import MultiChatStore, { tokenizeText, type ChatConversation, type ConversationSearchHit } from "./MultiChatStore";
import { CHAT_WORDS, readAuthorization } from "./ChatConsent";

export interface CrossChatHit extends ConversationSearchHit {
  score: number;
  linked: boolean;
  sameProject: boolean;
}

/** One chat whose research was handed to this turn. */
export interface CrossChatSource {
  conversationId: string;
  title: string;
  /** Why it was allowed: linked, same project, or the user brought it up / agreed in this chat. */
  authorization: "linked" | "project" | "asked";
  messageIds: string[];
}

export interface CrossChatReference {
  /** The labelled block for the request ("" when nothing applies). */
  context: string;
  /** Chats whose content was used — all of them authorized. */
  used: CrossChatSource[];
  /** Related chats that were NOT read, offered to the user instead. */
  suggested: Array<{ conversationId: string; title: string }>;
}

/** “A”, “B” and “C”. */
function listTitles(titles: string[]): string {
  const quoted = titles.map((title) => `“${title}”`);
  return quoted.length <= 1 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/** Per authorized chat, at most this many messages and characters. */
const MAX_MESSAGES_PER_CHAT = 3;
const MAX_CHARS_PER_CHAT = 1400;

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
  public buildContext(currentConversationId: string, query: string, limit = 5): string {
    return this.reference(currentConversationId, query, limit).context;
  }

  /**
   * What this turn may use from other chats, and what it may only offer.
   * See AUTHORIZATION above.
   */
  public reference(currentConversationId: string, query: string, limit = 5): CrossChatReference {
    const empty: CrossChatReference = { context: "", used: [], suggested: [] };
    const store = MultiChatStore.getInstance();
    const current = store.get(currentConversationId);
    if (!current) return empty;
    const effectiveQuery = query?.trim() || this.currentTopic(currentConversationId);
    // Words about chats themselves say nothing about what is in them.
    const qTokens = new Set(tokenizeText(effectiveQuery).filter((token) => !CHAT_WORDS.has(token)));
    // A merged chat already carries its sources' messages in its own
    // history; reading those chats again would show them twice.
    const carriedFrom = new Set(current.messages.map((message) => message.origin?.conversationId).filter(Boolean));

    const used: CrossChatSource[] = [];
    const blocks: string[] = [];
    const related: Array<{ conversationId: string; title: string; overlap: number }> = [];

    // Who may be read this turn: linked / same project, or what the USER
    // said here — they named the chat, or said yes to LÉLU asking about
    // it (multichat/ChatConsent, the same rule as the chats.* tools).
    // "My other chat" with no name allows only the best-matching one.
    const scoreOf = (conversation: ChatConversation) =>
      conversation.messages
        .filter((message) => message.text.trim().length > 0)
        .map((message) => ({
          message,
          overlap: tokenizeText(message.text).filter((token) => qTokens.has(token)).length,
        }));
    const others = store.list().filter((conversation) => conversation.id !== current.id && !carriedFrom.has(conversation.id));
    const generic = others
      .filter((conversation) => readAuthorization(query ?? "", current, conversation) === "generic")
      .map((conversation) => ({ conversation, best: Math.max(0, ...scoreOf(conversation).map((item) => item.overlap)) }))
      .filter((item) => item.best > 0)
      .sort((a, b) => b.best - a.best)[0]?.conversation.id;

    // When the message contains one chat's FULL title, that is the chat
    // meant; others that only share some of its words are not.
    // The longest such title wins: "Research" is inside "Video research".
    const contained = others.filter(
      (conversation) => conversation.title.trim().length >= 4 && (query ?? "").toLowerCase().includes(conversation.title.trim().toLowerCase()),
    );
    const fullyNamed = new Set(
      contained
        .filter((conversation) => !contained.some((other) => other !== conversation && other.title.length > conversation.title.length && other.title.toLowerCase().includes(conversation.title.trim().toLowerCase())))
        .map((conversation) => conversation.id),
    );

    for (const conversation of others) {
      let why = readAuthorization(query ?? "", current, conversation);
      if (why === "named" && fullyNamed.size > 0 && !fullyNamed.has(conversation.id)) why = null;
      const linked = why === "linked";
      const authorized = why === "linked" || why === "project" || why === "named" || why === "agreed" || (why === "generic" && conversation.id === generic);
      const scored = scoreOf(conversation);
      const best = Math.max(0, ...scored.map((item) => item.overlap));

      if (!authorized) {
        if (best >= 2) related.push({ conversationId: conversation.id, title: conversation.title, overlap: best });
        continue;
      }
      if (used.length >= limit) continue;

      // The messages that bear on the question; when none share a word,
      // the latest answer (the user linked this chat on purpose).
      let picked = scored
        .filter((item) => item.overlap > 0)
        .sort((x, y) => y.overlap - x.overlap || (y.message.role === "assistant" ? 1 : 0) - (x.message.role === "assistant" ? 1 : 0) || y.message.timestamp - x.message.timestamp)
        .slice(0, MAX_MESSAGES_PER_CHAT)
        .map((item) => item.message);
      if (picked.length === 0) {
        const latest = [...conversation.messages].reverse().find((message) => message.role === "assistant" && message.text.trim().length > 40);
        picked = latest ? [latest] : [];
      }
      if (picked.length === 0) continue;
      picked.sort((x, y) => x.timestamp - y.timestamp);

      let budget = MAX_CHARS_PER_CHAT;
      const lines: string[] = [];
      for (const message of picked) {
        if (budget <= 0) break;
        const text = message.text.replace(/\s+/g, " ").trim().slice(0, Math.min(budget, 700));
        budget -= text.length;
        lines.push(`  - ${message.role === "assistant" ? "LÉLU" : "User"}: ${text}`);
      }
      const authorization = linked ? "linked" : why === "project" ? "project" : "asked";
      used.push({ conversationId: conversation.id, title: conversation.title, authorization, messageIds: picked.map((message) => message.id) });
      const because = linked ? "linked by the user" : why === "project" ? "same project" : "the user brought it up";
      blocks.push(`From the chat “${conversation.title}” (${because}):\n${lines.join("\n")}`);
    }

    const suggested = related
      .sort((x, y) => y.overlap - x.overlap)
      .slice(0, 2)
      .map(({ conversationId, title }) => ({ conversationId, title }));

    const parts: string[] = [];
    const mergedFrom = [...new Set(current.messages.map((message) => message.origin?.title).filter(Boolean))];
    if (mergedFrom.length > 0) {
      parts.push(
        "## THIS IS A MERGED CHAT\n" +
          `It was made from ${listTitles(mergedFrom as string[])}; each earlier message is labelled with the chat it came from. ` +
          "Keep them apart, and when you use one, say which chat it came from. The original chats still exist unchanged.",
      );
    }
    if (blocks.length > 0) {
      parts.push(
        "## RESEARCH FROM OTHER CHATS (authorized)\n" +
          "The user allowed this chat to use the research below (linked, or they brought it up). Use it where it helps answer THIS chat's question. " +
          "It is not part of this conversation: keep it apart from what was said here, say which chat each point comes " +
          "from — e.g. (from “Title”) — and never attribute one chat's content to another or invent what a chat said.\n" +
          blocks.join("\n"),
      );
    }
    if (suggested.length > 0) {
      parts.push(
        "## RELATED CHATS (not authorized)\n" +
          `These chats look related but the user has not allowed this chat to use them: ${suggested.map((item) => `“${item.title}”`).join(", ")}. ` +
          "Do not use, quote or guess their contents. Decide whether the connection is worth raising; if it is, ASK the user " +
          "whether to use that chat or merge it with this one. If they agree (or bring it up themselves), you can: read it with " +
          "chats_read, link it with chats_link, or create a merged chat with chats_merge — then say which chat each point came from.",
      );
    }
    return { context: parts.join("\n\n"), used, suggested };
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
