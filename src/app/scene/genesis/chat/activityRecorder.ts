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
      return activity;
    },
  };
}
