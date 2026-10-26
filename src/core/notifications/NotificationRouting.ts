/**
 * ==========================================================
 * LÉLU — WHAT GOES TO THE NOTIFICATIONS INBOX
 *
 * The Chats panel's NOTIFICATIONS section is the existing
 * NotificationProvider history. This decides what is written
 * there, so nothing that belongs to another conversation is
 * thrown over the one on screen:
 *
 *   - a question LÉLU raises on the side (ProactiveCore) —
 *     inbox, read once answered or dismissed;
 *   - an approval for a task another conversation owns;
 *   - a reply or a failure that finished in a conversation
 *     the user was not looking at.
 *
 * Opening a conversation marks its reply notifications read.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import MultiChatStore from "../multichat/MultiChatStore";
import { ownerForTask } from "../multichat/TurnOwnership";
import ProactiveCore, { type ProactiveQuestion } from "../proactive/ProactiveCore";
import NotificationProvider, { type NotificationRecord } from "./NotificationProvider";

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function conversationTitle(conversationId: string): string {
  try {
    return MultiChatStore.getInstance().get(conversationId)?.title ?? "another chat";
  } catch {
    return "another chat";
  }
}

/** A side question, once — keyed by its id so a re-surface is not a second entry. */
export function notifyQuestion(question: ProactiveQuestion | null): NotificationRecord | null {
  if (!question || question.status !== "pending") return null;
  const provider = NotificationProvider.getInstance();
  if (provider.history().some((record) => record.questionId === question.id)) return null;
  return provider.notify({
    type: "question",
    title: "LÉLU has a question",
    body: excerpt(question.question, 200),
    conversationId: question.conversationId,
    questionId: question.id,
    tag: `question:${question.id}`,
    silent: true,
  });
}

/**
 * A turn finished. Notified only when its conversation is not the one on
 * screen — there the reply (or failure card) is already in front of them.
 */
export function notifyTurnOutcome(outcome: {
  conversationId: string;
  turnId: string;
  ok: boolean;
  text: string;
  taskId?: string;
}): NotificationRecord | null {
  if (MultiChatStore.getInstance().getActiveId() === outcome.conversationId) return null;
  const title = conversationTitle(outcome.conversationId);
  return NotificationProvider.getInstance().notify({
    type: outcome.ok ? "reply" : "failure",
    title: outcome.ok ? `LÉLU replied in “${title}”` : `LÉLU couldn't finish in “${title}”`,
    body: excerpt(outcome.text) || undefined,
    conversationId: outcome.conversationId,
    taskId: outcome.taskId,
    tag: `turn:${outcome.turnId}`,
    silent: true,
  });
}

/** Wire the feeds. Returns a disposer. Safe to call once per runtime. */
export function startNotificationRouting(): () => void {
  const provider = NotificationProvider.getInstance();
  const proactive = ProactiveCore.getInstance();
  const disposers: Array<() => void> = [];

  disposers.push(
    proactive.subscribeQuestions((question) => {
      try {
        notifyQuestion(question);
      } catch {
        // contained — the inbox must never break cognition
      }
    }),
  );
  disposers.push(
    proactive.subscribeQuestionChanges((question) => {
      if (question.status !== "pending") provider.markQuestionRead(question.id);
    }),
  );

  disposers.push(
    AgentEventBus.getInstance().subscribe((event) => {
      if (event.type !== "approval_requested") return;
      const owner = ownerForTask(event.taskId);
      // Unowned approvals show in whichever chat is open; owned by the open
      // chat, they show there. Only another conversation's needs a pointer.
      if (!owner || owner === MultiChatStore.getInstance().getActiveId()) return;
      provider.notify({
        type: "approval",
        title: `Approval needed in “${conversationTitle(owner)}”`,
        body: excerpt(event.title),
        conversationId: owner,
        taskId: event.taskId,
        tag: `approval:${event.approvalId}`,
        silent: true,
      });
    }),
  );

  const store = MultiChatStore.getInstance();
  let lastActive = store.getActiveId();
  provider.markConversationRead(lastActive);
  disposers.push(
    store.subscribe(() => {
      const active = store.getActiveId();
      if (active === lastActive) return;
      lastActive = active;
      provider.markConversationRead(active);
    }),
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // contained
      }
    }
  };
}
