/**
 * ==========================================================
 * LÉLU
 * CONTEXT AUTHORIZATION — the one checkpoint
 *
 * M22 authorized memory. M22.1 authorized projects and agent
 * scope. Each boundary was correct, and each was applied
 * separately, which means a new context pathway could be added
 * without any of them noticing.
 *
 * This module is the single place where a piece of context is
 * classified before it can reach a provider payload. It does
 * not decide relevance — the boundaries upstream do — it
 * decides AUTHORIZATION: whose material is this, where was it
 * made, and is the current turn allowed to see it.
 *
 * Every decision keeps its provenance, so a payload can be
 * explained after the fact: RETRIEVE, RETRIEVE_WITH_CONTEXT,
 * DEFER, REJECT.
 * ==========================================================
 */

export type ContextKind =
  | "memory"
  | "cognitive-graph"
  | "workspace"
  | "project"
  | "agent"
  | "session"
  | "tool-result"
  | "background"
  | "operational";

export type ContextDecision = "RETRIEVE" | "RETRIEVE_WITH_CONTEXT" | "DEFER" | "REJECT";

export type ContextRelation =
  | "this-conversation"
  | "other-conversation"
  | "no-conversation"
  | "operational";

export interface ContextSection {
  id: string;
  kind: ContextKind;
  /** The text that would be injected. */
  text: string;
  /** Where it came from, when the producer knows. */
  provenance?: {
    userId?: string | null;
    conversationId?: string | null;
    sessionId?: string | null;
    conversationTitle?: string | null;
    scope?: string;
  };
  /** True when the text already states a foreign origin to the model. */
  labelled?: boolean;
}

export interface ContextAccess {
  userId: string | null;
  conversationId: string | null;
  sessionId: string | null;
}

export interface ContextDecisionRecord {
  id: string;
  kind: ContextKind;
  decision: ContextDecision;
  relation: ContextRelation;
  reason: string;
  labelled: boolean;
  scope: string | null;
}

export interface ContextAuthorization {
  allowed: ContextSection[];
  decisions: ContextDecisionRecord[];
  counts: Record<ContextDecision, number>;
}

function relationOf(section: ContextSection, access: ContextAccess): ContextRelation {
  if (section.kind === "operational") return "operational";
  const conversationId = section.provenance?.conversationId ?? null;
  if (!conversationId) return "no-conversation";
  return conversationId === access.conversationId ? "this-conversation" : "other-conversation";
}

/**
 * Classify every section.
 *
 * - operational state (capabilities, UI, configuration) is shared by design
 *   and always allowed; it carries no user content.
 * - this conversation's material is retrieved.
 * - durable user material from another conversation is retrieved WITH
 *   context — and only if it is labelled, so the model can say where it
 *   came from. Unlabelled foreign text is deferred, never injected.
 * - another user's, another session's, or unattributable conversation
 *   material is rejected.
 */
export function authorizeContextSections(sections: ContextSection[], access: ContextAccess): ContextAuthorization {
  const decisions: ContextDecisionRecord[] = [];
  const allowed: ContextSection[] = [];
  const counts: Record<ContextDecision, number> = {
    RETRIEVE: 0,
    RETRIEVE_WITH_CONTEXT: 0,
    DEFER: 0,
    REJECT: 0,
  };

  for (const section of sections) {
    const provenance = section.provenance ?? {};
    const relation = relationOf(section, access);
    const decision = (value: ContextDecision, reason: string) => {
      counts[value] += 1;
      decisions.push({
        id: section.id,
        kind: section.kind,
        decision: value,
        relation,
        reason,
        labelled: Boolean(section.labelled),
        scope: provenance.scope ?? null,
      });
      if (value === "RETRIEVE" || value === "RETRIEVE_WITH_CONTEXT") allowed.push(section);
    };

    if (section.kind === "operational") {
      decision("RETRIEVE", "shared operational state, no user content");
      continue;
    }

    // A recorded owner requires a matching identity; a turn with none cannot
    // read owned material by omitting who it is.
    if (provenance.userId && provenance.userId !== access.userId) {
      decision("REJECT", "belongs to another user");
      continue;
    }

    if (provenance.scope === "session" || provenance.scope === "session-local") {
      if (!provenance.sessionId || provenance.sessionId !== access.sessionId) {
        decision("REJECT", "session-scoped material from another session");
        continue;
      }
    }

    if (relation === "this-conversation") {
      decision("RETRIEVE", "belongs to this conversation");
      continue;
    }

    if (relation === "no-conversation") {
      if (provenance.scope === "persistent-user" || provenance.scope === "historical" || section.kind === "workspace") {
        decision(
          section.labelled ? "RETRIEVE_WITH_CONTEXT" : "DEFER",
          section.labelled
            ? "durable material with no conversation, labelled"
            : "durable material with no conversation and no label — state the origin before use",
        );
        continue;
      }
      decision("DEFER", "unattributable — cannot be authorized");
      continue;
    }

    // other-conversation
    if (provenance.scope === "derived" || provenance.scope === "inferred") {
      decision("DEFER", "an inference from another conversation is never injected as fact");
      continue;
    }
    decision(
      section.labelled ? "RETRIEVE_WITH_CONTEXT" : "DEFER",
      section.labelled
        ? "durable material from another conversation, labelled"
        : "foreign conversation material without a label",
    );
  }

  return { allowed, decisions, counts };
}

/** One trace-friendly line describing a bundle of decisions. */
export function summarizeContextDecisions(decisions: ContextDecisionRecord[]): string {
  const counts = decisions.reduce(
    (acc, decision) => {
      acc[decision.decision] += 1;
      return acc;
    },
    { RETRIEVE: 0, RETRIEVE_WITH_CONTEXT: 0, DEFER: 0, REJECT: 0 } as Record<ContextDecision, number>,
  );
  return `${counts.RETRIEVE} retrieved, ${counts.RETRIEVE_WITH_CONTEXT} with context, ${counts.DEFER} deferred, ${counts.REJECT} rejected`;
}
