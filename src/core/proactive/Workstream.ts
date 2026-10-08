/**
 * ==========================================================
 * LÉLU — WORKSTREAMS
 *
 * Turning a suggestion into somewhere the work can actually live.
 *
 * A notification used to be a dead end: a sentence, and a ✕ that did not
 * work. The only thing the user could do with "Fashion has no defined
 * next outcome" was read it again next cycle.
 *
 * A workstream is the other half of that. When the user engages with a
 * suggestion, it becomes a topic-specific conversation bound to its
 * project, seeded with why LÉLU raised it and what she already knows —
 * and from then on that topic's cognition belongs there instead of on
 * the global surface.
 *
 * This uses the EXISTING MultiChatStore and ProjectStore. There is no
 * second conversation store, and a workstream is not a new kind of
 * object: it is a conversation with `projectId` set and a topic tag,
 * which MultiChatStore has always supported and SupabasePersistence
 * already round-trips.
 * ==========================================================
 */

import MultiChatStore, { type ChatConversation } from "../multichat/MultiChatStore";
import ProjectStore from "../projects/ProjectStore";
import WorkQueue from "../cognition/WorkQueue";
import type { ProactiveQuestion } from "./ProactiveCore";

/** Tag that marks a conversation as a cognition-opened workstream. */
export const WORKSTREAM_TAG = "workstream";

export interface WorkstreamContext {
  conversation: ChatConversation;
  /** True when this call created it rather than reopening one. */
  created: boolean;
  /** The opening message, when one was seeded. */
  briefing?: string;
}

/**
 * The conversation that owns a project's topic, if one exists.
 *
 * Matched on projectId rather than on title, so renaming a conversation
 * does not orphan the workstream and two projects that happen to share a
 * name do not collide.
 */
export function findWorkstream(projectId: string): ChatConversation | undefined {
  return MultiChatStore.getInstance()
    .listAll()
    .find((conversation) => conversation.projectId === projectId && !conversation.archived);
}

/**
 * Everything LÉLU already knows about this project, as the opening
 * context for its workstream.
 *
 * This is why the conversation does not start cold: the user should not
 * have to re-explain a project to the system that raised it.
 */
export function buildWorkstreamBriefing(
  projectId: string,
  question?: ProactiveQuestion,
): string {
  const project = ProjectStore.getInstance().get(projectId);
  if (!project) return "";

  const lines: string[] = [];
  if (question) {
    lines.push(`I opened this because: ${question.reason}`);
  }
  lines.push(`Project: ${project.name}${project.status ? ` (${project.status})` : ""}`);
  if (project.description?.trim()) lines.push(`Description: ${project.description.trim()}`);
  if (project.objective?.trim()) lines.push(`Objective: ${project.objective.trim()}`);
  if (project.originalRequest?.trim()) {
    lines.push(`What you originally asked for: ${project.originalRequest.trim()}`);
  }
  if (project.queries?.length) lines.push(`Research so far: ${project.queries.join(", ")}`);

  const open = WorkQueue.getInstance()
    .list()
    .filter((item) => item.status === "open" && item.detail?.includes(`project:${projectId}`));
  if (open.length > 0) {
    lines.push(`Open work items: ${open.map((item) => item.title).join("; ")}`);
  }

  const recentItems = project.items.slice(-3).map((item) => item.title ?? "").filter(Boolean);
  if (recentItems.length > 0) lines.push(`Recent activity: ${recentItems.join("; ")}`);

  if (question) {
    lines.push("");
    lines.push(question.question);
  }
  return lines.join("\n");
}

/**
 * Open the workstream for a project, creating it if there is not one.
 *
 * Reopening is the common case and must not make a second conversation —
 * that is how a "workstream" would quietly become N conversations about
 * one subject. Creation is therefore conditional on `findWorkstream`
 * coming back empty, and the binding is written before anything else.
 */
export function openWorkstream(
  projectId: string,
  options: { question?: ProactiveQuestion; seed?: boolean } = {},
): WorkstreamContext | null {
  const chats = MultiChatStore.getInstance();
  const project = ProjectStore.getInstance().get(projectId);
  if (!project) return null;

  const existing = findWorkstream(projectId);
  if (existing) {
    chats.switchActive(existing.id);
    return { conversation: existing, created: false };
  }

  const conversation = chats.create(project.name);
  chats.setProject(conversation.id, projectId);
  chats.addTag(conversation.id, WORKSTREAM_TAG);
  if (project.name) chats.addTag(conversation.id, project.name.toLowerCase());
  chats.switchActive(conversation.id);

  const briefing = options.seed === false ? undefined : buildWorkstreamBriefing(projectId, options.question);
  if (briefing) {
    chats.addMessage(conversation.id, {
      id: crypto.randomUUID(),
      role: "assistant",
      text: briefing,
      timestamp: Date.now(),
      source: "local",
    });
  }

  return {
    conversation: chats.get(conversation.id) ?? conversation,
    created: true,
    ...(briefing ? { briefing } : {}),
  };
}

/**
 * Is this project's topic already being handled somewhere?
 *
 * Global cognition asks this before raising a project-level question: a
 * topic with an active workstream is not an unresolved global decision,
 * it is work in progress, and surfacing it globally is the spam the
 * brief describes.
 */
export function hasActiveWorkstream(projectId: string): boolean {
  const conversation = findWorkstream(projectId);
  if (!conversation) return false;
  // A conversation created and never used is not "being handled".
  return conversation.messages.length > 0;
}
