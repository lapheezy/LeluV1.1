/**
 * ==========================================================
 * LÉLU — THE QUESTION ON SCREEN (pure)
 *
 * ProactiveCore owns the questions; the chat only decides which
 * ONE of them it is allowed to show. Both rules live here so
 * they can be tested without a browser:
 *
 *   - only a pending question is ever shown. A resolved or
 *     dismissed one is history, and painting it again is what
 *     made a dismissed card stay on screen;
 *   - a question belongs to the conversation that asked it. One
 *     that belongs to another chat (or to none) waits in
 *     notifications until the user opens it from there — it
 *     never appears under an unrelated conversation;
 *   - a draft belongs to the question it was typed for.
 *     Carrying it to the next question would submit an answer
 *     to the wrong one.
 * ==========================================================
 */

import type { ProactiveQuestion } from "../../../../core/proactive/ProactiveCore";

export interface QuestionScope {
  activeConversationId: string;
  /** A question the user opened from notifications, if any. */
  openedQuestionId?: string | null;
}

/** The question this conversation may show, or null. */
export function questionOnScreen(
  question: ProactiveQuestion | null | undefined,
  scope: QuestionScope,
): ProactiveQuestion | null {
  if (!question || question.status !== "pending") return null;
  if (scope.openedQuestionId && scope.openedQuestionId === question.id) return question;
  if (question.conversationId !== undefined && question.conversationId === scope.activeConversationId) {
    return question;
  }
  return null;
}

/** Keep a draft only while the same question is on screen. */
export function nextAnswerDraft(
  previousQuestionId: string | null,
  question: ProactiveQuestion | null,
  draft: string,
): string {
  return question && question.id === previousQuestionId ? draft : "";
}

/** The answer to send, or null when nothing was actually typed. */
export function answerToSubmit(draft: string): string | null {
  const answer = draft.trim();
  return answer.length === 0 ? null : answer;
}
