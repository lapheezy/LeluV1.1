/**
 * ==========================================================
 * LÉLU — SHARED WINDOW ADAPTER
 *
 * The brain keeps one rolling conversation window. It holds every
 * chat's turns interleaved, so reading it for a turn that belongs
 * to a specific conversation is how chat A's unanswered question
 * became chat B's context.
 *
 * 2.2 stopped that for callers that supplied an id, but the
 * fallback itself stayed implicit: `perChatTurns ?? modelMessages()`
 * with a condition beside it. An implicit fallback is one edit
 * away from coming back.
 *
 * This module makes the compatibility path explicit and total.
 * There is exactly one place that may return the shared window,
 * it says so in its result, and every caller can record why.
 * ==========================================================
 */

import type { AIMessage } from "../../providers/AIProvider";

export type HistorySource = "conversation" | "shared-legacy" | "none";

export interface TurnHistory {
  turns: AIMessage[];
  source: HistorySource;
  /** Why this source, in words, for the cognitive trace. */
  reason: string;
}

export interface TurnHistoryInput {
  /** The id the caller supplied, if any. */
  conversationId?: string | null;
  /** Turns read from that conversation; null when the store has no such chat. */
  perChatTurns: AIMessage[] | null;
  /** Whether the multi-chat store holds any conversation at all. */
  storeHasChats: boolean;
  /** The brain's shared rolling window — read only by this adapter. */
  sharedWindow: () => AIMessage[];
}

/**
 * Resolve the history for one turn.
 *
 * - known conversation  → that conversation's turns
 * - unknown id          → NO history (never another chat's)
 * - no id, chats exist  → NO history (never the last speaker's)
 * - no id, first run    → shared window, explicitly, as bootstrap
 */
export function resolveTurnHistory(input: TurnHistoryInput): TurnHistory {
  const { conversationId, perChatTurns, storeHasChats, sharedWindow } = input;

  if (conversationId) {
    if (perChatTurns) {
      return {
        turns: perChatTurns,
        source: "conversation",
        reason: `history is conversation ${conversationId}`,
      };
    }
    if (storeHasChats) {
      return {
        turns: [],
        source: "none",
        reason: `conversation ${conversationId} is not in this store — no history rather than another chat's`,
      };
    }
    return {
      turns: sharedWindow(),
      source: "shared-legacy",
      reason: "first run: no chats exist yet, shared window is the bootstrap history",
    };
  }

  if (storeHasChats) {
    return {
      turns: [],
      source: "none",
      reason: "no conversation identity supplied — not using another chat's window",
    };
  }

  return {
    turns: sharedWindow(),
    source: "shared-legacy",
    reason: "no conversation identity and no chats: explicit legacy bootstrap",
  };
}
