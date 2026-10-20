/**
 * ==========================================================
 * LÉLU — WHICH CONVERSATION OWNS A REPLY
 *
 * A reply belongs to the conversation it was ASKED IN, not to
 * whichever tab happens to be selected when it arrives.
 *
 * Measured in a real browser: send a message in chat A, open
 * chat B before the reply lands, and A's reply was written into
 * B. A then held the question with no answer, B held an answer
 * to a question it never asked, and the reply the user was
 * waiting for appeared under the wrong heading. The user's own
 * message was routed correctly the whole time — it is written
 * synchronously, while the right conversation is still active.
 * Only the reply, which comes back seconds later, went astray.
 *
 * The reply arrives through a single global subscription
 * (GenesisBridge → AIService.subscribeMessages/subscribeStream)
 * that carries no conversation of its own, so the routing has
 * to be remembered here. A conversation CLAIMS the turn when it
 * sends; the first chunk of a reply records the claim against
 * its own message id; and every later chunk of that same
 * message follows the recorded id — so a reply still streaming
 * when the user starts a new turn elsewhere continues to land
 * where it was asked, rather than following the claim.
 *
 * With no claim active there is no owner, and the caller falls
 * back to the active conversation. That is the right answer for
 * a message LÉLU raises on her own — a proactive suggestion
 * belongs in the conversation the user is actually looking at.
 * ==========================================================
 */

/**
 * Enough streamed replies to cover any plausible overlap, bounded so a long
 * session cannot grow this without limit. Oldest entries are dropped first;
 * a dropped entry falls back to the active conversation, which is the same
 * behaviour as before this module existed.
 */
const MAX_TRACKED_MESSAGES = 200;

let claim: string | null = null;
const ownerByMessage = new Map<string, string>();

/** This conversation is sending. Replies to this turn belong to it. */
export function claimTurn(conversationId: string): void {
  if (!conversationId) return;
  claim = conversationId;
}

/**
 * This conversation's turn is over.
 *
 * Scoped to the claimant so a turn that finishes late cannot release
 * another conversation's claim: with two sends overlapping, the second
 * holds the claim and the first finishing must not clear it.
 */
export function releaseTurn(conversationId: string): void {
  if (claim === conversationId) claim = null;
}

/** The conversation currently sending, if any. */
export function currentTurnOwner(): string | null {
  return claim;
}

/**
 * Which conversation this reply belongs to, or null if nothing claimed it.
 *
 * The first call for a message id binds it to the current claim; later
 * calls for the same id return that same conversation whatever the claim
 * has become since.
 */
export function ownerForMessage(messageId: string): string | null {
  if (!messageId) return claim;
  const known = ownerByMessage.get(messageId);
  if (known) return known;
  if (!claim) return null;
  ownerByMessage.set(messageId, claim);
  if (ownerByMessage.size > MAX_TRACKED_MESSAGES) {
    const oldest = ownerByMessage.keys().next();
    if (!oldest.done) ownerByMessage.delete(oldest.value);
  }
  return claim;
}

/** Test seam: forget every claim and binding. */
export function resetTurnOwnership(): void {
  claim = null;
  ownerByMessage.clear();
}
