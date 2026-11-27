/**
 * ==========================================================
 * LÉLU — A TURN THAT CANNOT STILL BE RUNNING
 *
 * Measured on a 390x844 page (Mission 44.6): a turn was streaming when the
 * page was reloaded. Afterwards the question was still in the conversation —
 * and nothing else was. No reply, no failure, no control, no spinner: the
 * turn died with the tab, and the client said nothing at all. The user's only
 * move was to retype the question, without knowing whether it had run.
 *
 * The signal is exact, and needs no new persisted flag:
 *
 *   • the conversation is not processing (nothing is in flight for it), and
 *   • its LAST stored message is the user's own,
 *   • and that message was stored before this page started (so no send() in
 *     this page can be behind it).
 *
 * A message stored at or after this page's start belongs to a turn this page
 * is still setting up, and must not be reported as stopped.
 * ==========================================================
 */

export interface StoredTurnMessage {
  id?: string;
  role: string;
  text?: string;
  timestamp?: number;
}

/**
 * The text of a question that no turn is answering, or null.
 *
 * `pageStartedAt` is when this page's JavaScript began (module scope of the
 * surface rendering it), not when a component mounted: a window opened later
 * must still recognise a question left behind by an earlier page.
 */
export function interruptedTurnText(
  messages: readonly StoredTurnMessage[],
  pageStartedAt: number,
  processing: boolean,
): string | null {
  if (processing) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  if (typeof last.timestamp === "number" && last.timestamp >= pageStartedAt) return null;
  return String(last.text ?? "").trim() || null;
}

/**
 * The stored message a retry should REUSE, or null when it must be a new turn.
 *
 * Measured in Mission 44.7, on the Chat Universe window: pressing "Try again"
 * on the interrupted-turn notice appended the same question a second time and
 * then answered it — the thread read question, question, answer. The retry is
 * that same question asked again, so the stored message is reused.
 *
 * After a VISIBLE failure the last stored message is the failure, not the
 * question, so null is returned and the retry stays a new turn: the failure
 * remains readable above it, which is the honest history.
 */
export function reusableRetryId(messages: readonly StoredTurnMessage[], text: string): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.id) return null;
  return String(last.text ?? "").trim() === text.trim() ? last.id : null;
}
