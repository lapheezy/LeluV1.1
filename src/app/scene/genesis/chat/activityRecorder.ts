/**
 * LÉLU — record one turn's activity from the live event stream.
 *
 * Only events whose task belongs to THIS conversation are kept
 * (TurnOwnership.ownerForTask). A search run for another chat, or by
 * cognition on its own, never appears in this turn's card.
 */
import AgentEventBus from "../../../../core/agent/AgentEvents";
import { ownerForTask } from "../../../../core/multichat/TurnOwnership";
import { emptyActivity, reduceActivity, type ChatActivity } from "../../../../core/multichat/TurnActivity";

export interface ActivityRecording {
  /** Stop listening and return what was recorded. */
  stop: () => ChatActivity;
  current: () => ChatActivity;
}

/* ------------------------------------------------------------------
 * The turn that is happening, by conversation.
 *
 * The chat panel records a turn and keeps the record to itself; the
 * Chat Universe window shows the same turn from outside that component.
 * This is the one place that record is published, so both surfaces read
 * ONE activity built from real AgentEventBus events — nothing is
 * re-derived or invented for the window.
 * ------------------------------------------------------------------ */

const liveActivity = new Map<string, ChatActivity>();
const activityListeners = new Set<() => void>();

function emit(): void {
  for (const listener of activityListeners) listener();
}

/** The current (or most recently finished) turn in a conversation, if any. */
export function currentActivity(conversationId: string | null | undefined): ChatActivity | null {
  if (!conversationId) return null;
  return liveActivity.get(conversationId) ?? null;
}

export function subscribeActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

/** Publish a turn's activity so every surface for that chat shows the same record. */
export function publishActivity(conversationId: string, activity: ChatActivity): void {
  liveActivity.set(conversationId, activity);
  emit();
}

/** Forget a conversation's turn (used when it is deleted). */
export function clearActivity(conversationId: string): void {
  if (liveActivity.delete(conversationId)) emit();
}

/**
 * Start recording. `onChange` is batched (at most every ~80ms) so a burst
 * of events re-renders the chat once, not once per event.
 */
export function recordTurnActivity(
  conversationId: string,
  onChange: (activity: ChatActivity) => void,
): ActivityRecording {
  let activity = emptyActivity();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    // The chat panel and the Universe window both read this record.
    publishActivity(conversationId, activity);
    onChange(activity);
  };
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (ownerForTask(event.taskId) !== conversationId) return;
    const next = reduceActivity(activity, event);
    if (next === activity) return;
    activity = next;
    if (timer === null) timer = setTimeout(flush, 80);
  });
  return {
    current: () => activity,
    stop: () => {
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // The finished record stays visible in its window until the next turn.
      publishActivity(conversationId, activity);
      return activity;
    },
  };
}
