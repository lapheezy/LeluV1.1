/**
 * ==========================================================
 * LÉLU — PROJECT INTENT RESOLUTION
 *
 * "Can I work out the next step myself, or do I have to ask?"
 *
 * The repeated Fashion card came from asking that question too
 * narrowly. Cognition looked only at a project's `objective`,
 * `originalRequest` and `queries`; when all three were empty it
 * concluded it knew nothing and asked the user — even though the
 * project had a name, a description, prior conversations, memories
 * mentioning it, completed items, and in some cases a previous answer
 * to this very question.
 *
 * So intent is resolved from everything that actually carries it, in
 * descending order of how explicitly the user stated it. Only when
 * every source is empty is asking the right move — and then the
 * question is asked once, not every cycle.
 *
 * This module reads. It never writes, never asks and never queues.
 * ==========================================================
 */

import type { LeluProject } from "../projects/ProjectStore";
import type { ChatConversation } from "../multichat/MultiChatStore";
import type { QueueItem } from "./WorkQueue";

/** Where a derived intent came from, so the work item can say so. */
export type IntentSource =
  | "objective"
  | "original-request"
  | "checkpoint"
  | "queries"
  | "prior-answer"
  | "conversation"
  | "memory"
  | "completed-work"
  | "description";

export interface ResolvedIntent {
  /** The intent, in the user's terms where possible. */
  intent: string;
  source: IntentSource;
  /**
   * How confident this is as a basis for acting without asking.
   * Explicitly stated intent is high; inferred-from-chatter is low.
   */
  confidence: number;
}

export interface IntentInputs {
  project: LeluProject;
  /** Conversations already bound to this project. */
  conversations?: ChatConversation[];
  /** Memory texts that mention the project. */
  memories?: string[];
  /** Work items, open or done, belonging to this project. */
  items?: QueueItem[];
  /** Answers the user previously gave about this project. */
  priorAnswers?: string[];
}

const MIN_USEFUL = 8;

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The most explicit statement of what this project is for.
 *
 * Ordered deliberately. A checkpoint's next action beats an objective
 * because it is more current; a previous answer beats inferred context
 * because the user said it on purpose; a description beats nothing but
 * ranks last, since it is often auto-generated boilerplate.
 */
export function resolveIntent(inputs: IntentInputs): ResolvedIntent | null {
  const { project } = inputs;

  const checkpointAction = clean(project.checkpoint?.nextAction);
  if (checkpointAction.length >= MIN_USEFUL) {
    return { intent: checkpointAction, source: "checkpoint", confidence: 0.95 };
  }

  const objective = clean(project.objective);
  if (objective.length >= MIN_USEFUL) {
    return { intent: objective, source: "objective", confidence: 0.9 };
  }

  const original = clean(project.originalRequest);
  if (original.length >= MIN_USEFUL) {
    return { intent: original, source: "original-request", confidence: 0.9 };
  }

  // Something the user already told LÉLU about this project. Using it is
  // the difference between remembering an answer and asking again.
  const answer = (inputs.priorAnswers ?? []).map(clean).find((value) => value.length >= MIN_USEFUL);
  if (answer) {
    return { intent: answer, source: "prior-answer", confidence: 0.85 };
  }

  if (project.queries?.length) {
    return {
      intent: `Continue the research already started: ${project.queries.slice(0, 4).join(", ")}`,
      source: "queries",
      confidence: 0.75,
    };
  }

  // What the user has actually been saying in this project's own
  // conversation. Their last substantive message is a far better basis
  // for a next step than asking them to summarise it again.
  const fromConversation = latestUserIntent(inputs.conversations ?? []);
  if (fromConversation) {
    return {
      intent: `Follow up on the direction set in conversation: ${fromConversation}`,
      source: "conversation",
      confidence: 0.6,
    };
  }

  // Completed work implies a trajectory worth continuing.
  const done = (inputs.items ?? []).filter((item) => item.status === "done");
  if (done.length > 0) {
    const recent = done.slice(-2).map((item) => item.title).filter(Boolean);
    if (recent.length > 0) {
      return {
        intent: `Build on completed work: ${recent.join("; ")}`,
        source: "completed-work",
        confidence: 0.55,
      };
    }
  }

  const memory = (inputs.memories ?? []).map(clean).find((value) => value.length >= MIN_USEFUL);
  if (memory) {
    return {
      intent: `Act on what I already know about this: ${memory.slice(0, 160)}`,
      source: "memory",
      confidence: 0.5,
    };
  }

  const description = clean(project.description);
  // "Auto-created for …" is LÉLU's own bookkeeping, not the user's
  // intent, and treating it as intent is how she ends up acting on her
  // own filing system.
  if (description.length >= MIN_USEFUL && !description.startsWith("Auto-created for")) {
    return { intent: description, source: "description", confidence: 0.45 };
  }

  return null;
}

/** The last thing the user actually said, long enough to mean something. */
function latestUserIntent(conversations: ChatConversation[]): string | null {
  const messages = conversations
    .flatMap((conversation) => conversation.messages)
    .filter((message) => message.role === "user")
    .sort((a, b) => a.timestamp - b.timestamp);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = clean(messages[index]?.text);
    if (text.length >= 24) return text.slice(0, 200);
  }
  return null;
}

/**
 * Confidence at or above which LÉLU should act rather than ask.
 *
 * Below it she has a hint, not a direction — and acting on a hint
 * produces confidently wrong work, which is worse than one question.
 */
export const ACT_WITHOUT_ASKING = 0.55;

export function canAct(intent: ResolvedIntent | null): boolean {
  return intent !== null && intent.confidence >= ACT_WITHOUT_ASKING;
}

/**
 * A fingerprint of everything that would change the answer.
 *
 * This is what makes a repeated cognitive cycle idempotent: the same
 * situation produces the same string, so an existing question is
 * recognised as already-asked instead of being re-asked. It changes only
 * when something real moves — items, research, conversation length, a
 * stated objective, the project's status.
 */
export function intentEvidence(inputs: IntentInputs): string {
  const { project } = inputs;
  const conversationSize = (inputs.conversations ?? []).reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );
  return [
    `p:${project.id}`,
    `st:${project.status}`,
    `items:${project.items.length}`,
    `q:${project.queries?.length ?? 0}`,
    `obj:${clean(project.objective).length > 0 ? 1 : 0}`,
    `req:${clean(project.originalRequest).length > 0 ? 1 : 0}`,
    `cp:${clean(project.checkpoint?.nextAction).length > 0 ? 1 : 0}`,
    `conv:${conversationSize}`,
    `ans:${(inputs.priorAnswers ?? []).length}`,
  ].join("|");
}
