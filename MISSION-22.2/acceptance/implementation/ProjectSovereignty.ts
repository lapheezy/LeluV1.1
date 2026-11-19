/**
 * ==========================================================
 * LÉLU — PROJECT SOVEREIGNTY
 *
 * M22 gave memories provenance. Projects were the next unscoped
 * pathway: `ProjectStore` had no owner, no originating
 * conversation and no scope, and `MemoryBridge.formatProjects()`
 * rendered every active project into every turn's context.
 *
 * A project being relevant to a prompt is not permission to
 * describe it. This module gives a project the same questions a
 * memory gets — whose is it, where was it started, which session
 * may see it — and answers them deterministically.
 *
 * It does not replace the registry. ProjectStore stays the one
 * store; this is the boundary applied when its contents are
 * considered for context.
 * ==========================================================
 */

import type { LeluProject } from "./ProjectStore";
import type { MemoryScopeContext } from "../memory/MemorySovereignty";

/**
 * What kind of project this is.
 *
 * - user-persistent    durable work owned by the user; visible across chats
 * - conversation-local belongs to the chat that created it
 * - session-local      temporary; dies with the runtime session
 * - shared             explicitly authorized for more than one conversation
 * - historical         imported/archived; visible with its origin stated
 */
export type ProjectScope =
  | "user-persistent"
  | "conversation-local"
  | "session-local"
  | "shared"
  | "historical";

export interface ProjectOrigin {
  ownerId: string | null;
  originatingConversationId: string | null;
  originatingSessionId: string | null;
  originatingConversationTitle: string | null;
  scope: ProjectScope;
}

export interface ProjectAccess {
  userId: string | null;
  conversationId: string | null;
  sessionId: string | null;
}

export type ProjectDecision = "INJECT" | "INJECT_WITH_LABEL" | "DEFER" | "REJECT";

export interface ProjectDecisionRecord {
  projectId: string;
  decision: ProjectDecision;
  reason: string;
  scope: ProjectScope;
  relation: "this-conversation" | "other-conversation" | "no-conversation";
}

/** Provenance of a project, conservative for records written before 2.2.1. */
export function projectOriginOf(project: LeluProject): ProjectOrigin {
  return {
    ownerId: project.ownerId ?? null,
    originatingConversationId: project.originConversationId ?? null,
    originatingSessionId: project.originSessionId ?? null,
    originatingConversationTitle: project.originConversationTitle ?? null,
    // Existing projects are the user's durable work — that is what they were
    // used as. They are never treated as belonging to one conversation.
    scope: project.scope ?? "user-persistent",
  };
}

export function projectAccessFor(scope: MemoryScopeContext): ProjectAccess {
  return {
    userId: scope.userId,
    conversationId: scope.conversationId,
    sessionId: scope.sessionId,
  };
}

function relationOf(origin: ProjectOrigin, access: ProjectAccess): ProjectDecisionRecord["relation"] {
  if (!origin.originatingConversationId) return "no-conversation";
  return origin.originatingConversationId === access.conversationId
    ? "this-conversation"
    : "other-conversation";
}

/**
 * The hard boundary: may this project be *considered* for this turn at all?
 *
 * Ownership and session isolation are refusals, not labels. A project whose
 * scope is conversation-local is never shown outside its conversation.
 */
export function isProjectVisible(project: LeluProject, access: ProjectAccess): boolean {
  const origin = projectOriginOf(project);

  // A recorded owner requires a matching identity. A turn with no user
  // identity cannot claim someone's project merely because it asks.
  if (origin.ownerId && origin.ownerId !== access.userId) return false;

  if (origin.scope === "session-local") {
    if (!origin.originatingSessionId) return false;
    if (origin.originatingSessionId !== access.sessionId) return false;
  }

  if (origin.scope === "conversation-local") {
    if (!origin.originatingConversationId) return false;
    if (origin.originatingConversationId !== access.conversationId) return false;
  }

  return true;
}

/** The decision, including whether its origin must be stated. */
export function decideProject(project: LeluProject, access: ProjectAccess): ProjectDecisionRecord {
  const origin = projectOriginOf(project);
  const relation = relationOf(origin, access);

  if (origin.ownerId && origin.ownerId !== access.userId) {
    return { projectId: project.id, decision: "REJECT", reason: "project belongs to another user", scope: origin.scope, relation };
  }

  if (origin.scope === "session-local") {
    if (!origin.originatingSessionId || origin.originatingSessionId !== access.sessionId) {
      return { projectId: project.id, decision: "REJECT", reason: "session-local project from another session", scope: origin.scope, relation };
    }
  }

  if (origin.scope === "conversation-local") {
    if (!origin.originatingConversationId || origin.originatingConversationId !== access.conversationId) {
      return { projectId: project.id, decision: "REJECT", reason: "conversation-local project outside its conversation", scope: origin.scope, relation };
    }
  }

  if (origin.scope === "historical") {
    return { projectId: project.id, decision: "INJECT_WITH_LABEL", reason: "historical project", scope: origin.scope, relation };
  }

  if (relation === "other-conversation") {
    return {
      projectId: project.id,
      decision: "INJECT_WITH_LABEL",
      reason: "durable project started in another conversation — say where it came from",
      scope: origin.scope,
      relation,
    };
  }

  return { projectId: project.id, decision: "INJECT", reason: "project belongs to this turn's scope", scope: origin.scope, relation };
}

/** Prefix for a project line, or "" when no origin needs stating. */
export function projectLabel(project: LeluProject, conversationId?: string | null): string {
  const origin = projectOriginOf(project);
  if (origin.scope === "historical") return "[historical project]";
  if (!origin.originatingConversationId) return "";
  if (!conversationId || origin.originatingConversationId === conversationId) return "";
  return origin.originatingConversationTitle
    ? `[started in the chat “${origin.originatingConversationTitle}”]`
    : "[started in another conversation]";
}

/** One instruction block, only when a labelled project is actually present. */
export function projectContextNote(decisions: ProjectDecisionRecord[]): string {
  if (!decisions.some((decision) => decision.decision === "INJECT_WITH_LABEL")) return "";
  return [
    "## Project provenance",
    "- A project marked [started in the chat “…\"] or [historical project] is real work, but it did not begin in this conversation. Do not describe it as something agreed here; name where it was started if you use it.",
  ].join("\n");
}
