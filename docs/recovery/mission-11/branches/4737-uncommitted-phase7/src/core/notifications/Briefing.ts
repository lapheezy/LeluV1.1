/**
 * ==========================================================
 * LÉLU — BRIEFING / NOTIFICATION READ STATE
 *
 * One question: has the user seen what arrived since they
 * last opened the briefing?
 *
 * The app already has the two real sources — `state.notifications`
 * (what LÉLU announced) and ImprovementQueue (what she wants a
 * decision on). What it did not have was any memory of the user
 * having READ them, so a badge could only ever mean "toasts are
 * currently on screen", which is a different thing.
 *
 * This is not a second notification system: it stores a
 * timestamp, nothing else. Both surfaces read the same arrays
 * they always read.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

const SEEN_KEY = "lelu.briefing.seen.v1";

function readSeen(): number {
  try {
    const stored = KvStore.getInstance().get<{ at: number }>(SEEN_KEY);
    return typeof stored?.at === "number" ? stored.at : 0;
  } catch {
    return 0;
  }
}

let seenAt = readSeen();
const listeners = new Set<() => void>();

export function getBriefingSeenAt(): number {
  return seenAt;
}

/** Record that the briefing is being looked at right now. */
export function markBriefingSeen(at: number = Date.now()): void {
  if (at <= seenAt) return;
  seenAt = at;
  try {
    KvStore.getInstance().set(SEEN_KEY, { at });
  } catch {
    // persistence is best-effort; the in-memory value still works
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // a listener must never break the notification path
    }
  }
}

export function subscribeBriefing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many announcements arrived since the briefing was last opened. */
export function unseenBriefingCount(
  notifications: ReadonlyArray<{ created: number }>,
): number {
  if (notifications.length === 0) return 0;
  return notifications.reduce(
    (count, notification) => count + (notification.created > seenAt ? 1 : 0),
    0,
  );
}
