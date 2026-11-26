/**
 * ==========================================================
 * LÉLU — IMPROVEMENT LIFECYCLE
 *
 * The improvement queue used to have one axis: workflow status. A
 * proposal could be "Integrated" and still sit in the active list,
 * and a recommendation whose limitation had already been removed
 * could be recommended forever. Neither is a lifecycle.
 *
 * This module owns the second, reconciling axis:
 *
 *   Identified → Planned → InProgress → Implemented →
 *   VerificationPending → VerifiedComplete
 *   (+ Blocked, Superseded, Reopened)
 *
 * It is a PURE function of the proposal plus real state (the
 * capability registry and the recorded evidence), so:
 *
 *   · a recommendation whose capability is available and verified
 *     is SUPERSEDED, not re-recommended;
 *   · duplicate recommendations collapse to the oldest one, the
 *     others keep their record as Superseded;
 *   · a completed improvement stays complete unless new evidence
 *     (a broken capability, a failed execution AFTER verification)
 *     reopens it;
 *   · nothing is deleted — every transition is appended to the
 *     proposal's own history.
 * ==========================================================
 */

import type { ImprovementProposal, ImprovementStatus } from "./ImprovementQueue";
import CapabilityRegistry from "./CapabilityRegistry";
import { isVerified, RESOLVED_LIMITATIONS } from "./CapabilityEvidence";

export type ImprovementLifecycle =
  | "Identified"
  | "Planned"
  | "InProgress"
  | "Implemented"
  | "VerificationPending"
  | "VerifiedComplete"
  | "Blocked"
  | "Superseded"
  | "Reopened";

export const LIFECYCLE_LABELS: Record<ImprovementLifecycle, string> = {
  Identified: "Identified",
  Planned: "Planned",
  InProgress: "In progress",
  Implemented: "Implemented — verification pending",
  VerificationPending: "Verification pending",
  VerifiedComplete: "Verified complete",
  Blocked: "Blocked",
  Superseded: "Superseded",
  Reopened: "Reopened",
};

/** Lifecycles that still describe work worth doing. */
export const ACTIVE_LIFECYCLES: ImprovementLifecycle[] = [
  "Identified",
  "Planned",
  "InProgress",
  "Implemented",
  "VerificationPending",
  "Blocked",
  "Reopened",
];

export function isActiveLifecycle(state: ImprovementLifecycle | undefined): boolean {
  return state === undefined || ACTIVE_LIFECYCLES.includes(state);
}

/** One recorded transition. History is append-only. */
export interface LifecycleEvent {
  at: number;
  from: ImprovementLifecycle | "None";
  to: ImprovementLifecycle;
  reason: string;
  evidence?: string;
}

export interface LifecycleDecision {
  proposalId: string;
  lifecycle: ImprovementLifecycle;
  reason: string;
  evidence?: string;
  supersededBy?: string;
  verifiedAt?: number;
  /** True when this decision changes the stored lifecycle. */
  changed: boolean;
}

export interface ReconciliationResult {
  decisions: LifecycleDecision[];
  patches: Array<{ id: string; patch: Partial<ImprovementProposal> }>;
  superseded: LifecycleDecision[];
  reopened: LifecycleDecision[];
  verified: LifecycleDecision[];
  duplicates: LifecycleDecision[];
}

/** Workflow status → the lifecycle it means, before reconciliation. */
export function lifecycleFromStatus(status: ImprovementStatus): ImprovementLifecycle {
  switch (status) {
    case "Detected":
    case "Analyzing":
    case "Proposed":
    case "Failed":
      return "Identified";
    case "Approved":
      return "Planned";
    case "In Development":
    case "Testing":
    case "Evaluation":
    case "Applying":
      return "InProgress";
    case "Ready":
    case "Recorded":
      return "VerificationPending";
    case "Integrated":
      return "VerifiedComplete";
    case "Blocked":
      return "Blocked";
    case "Rolled Back":
      return "Reopened";
    case "Rejected":
      return "Superseded";
    default:
      return "Identified";
  }
}

/** A run whose checks all passed — the only shape that counts as verified. */
function executionVerified(proposal: ImprovementProposal): boolean {
  const execution = proposal.lastExecution;
  if (!execution || execution.checks.length === 0) return false;
  return execution.checks.every((check) => check.ok === true);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const STOPWORDS = new Set([
  "add", "a", "an", "the", "for", "to", "of", "and", "with", "in", "on", "new",
  "build", "improve", "complete", "fix", "capability", "implement", "make",
]);

/** The words that identify WHAT a proposal is about, not how it reads. */
export function topicTokens(title: string): string[] {
  return normalise(title)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function sameTopic(a: string, b: string): boolean {
  const left = topicTokens(a);
  const right = topicTokens(b);
  if (left.length === 0 || right.length === 0) return normalise(a) === normalise(b);
  const overlap = left.filter((token) => right.includes(token)).length;
  const union = new Set([...left, ...right]).size;
  return overlap / union >= 0.8;
}

/** A resolved limitation that names this exact proposal title. */
function resolvedByTitle(title: string) {
  const tokens = topicTokens(title);
  return RESOLVED_LIMITATIONS.find((entry) =>
    (entry.proposalTitles ?? []).some((candidate) => {
      if (normalise(candidate) === normalise(title)) return true;
      return tokens.length > 0 && topicTokens(candidate).every((token) => tokens.includes(token));
    }),
  );
}

/**
 * Decide the lifecycle of ONE proposal from real state. Never mutates.
 */
export function decideLifecycle(proposal: ImprovementProposal, now = Date.now()): LifecycleDecision {
  const stored = proposal.lifecycle;
  const fromStatus = lifecycleFromStatus(proposal.status);
  let lifecycle: ImprovementLifecycle = fromStatus;
  let reason = `Workflow status: ${proposal.status}.`;
  let evidence: string | undefined;

  /*
   * FIRST: a completed improvement stays completed unless new evidence
   * reopens it. This has to run before the status mapping, or a stored
   * VerifiedComplete whose capability just broke would be re-derived as
   * VerifiedComplete from its old Integrated status and hide the regression.
   */
  if (stored === "VerifiedComplete" || stored === "Superseded") {
    const capability = proposal.capabilityId ? CapabilityRegistry.getInstance().get(proposal.capabilityId) : undefined;
    const regressed = Boolean(capability && ["broken", "disabled"].includes(capability.status));
    const failedAfterVerification =
      proposal.lastExecution?.outcome === "Failed" &&
      (proposal.lastExecution.started ?? 0) > (proposal.verifiedAt ?? 0);
    if (regressed || failedAfterVerification) {
      return {
        proposalId: proposal.id,
        lifecycle: "Reopened",
        reason: regressed
          ? `Reopened: capability “${capability?.name}” is now ${capability?.status}, so the earlier resolution no longer holds.`
          : "Reopened: a development run failed after the improvement had been verified.",
        evidence: regressed ? `CapabilityRegistry status: ${capability?.status}` : proposal.lastExecution?.error,
        changed: true,
      };
    }
    return {
      proposalId: proposal.id,
      lifecycle: stored,
      reason: proposal.lifecycleReason ?? "Historical record — this improvement is no longer active.",
      evidence: proposal.lastExecution?.checks.map((check) => `${check.name}: ${check.ok === true ? "ok" : "failed"}`).join("; "),
      changed: false,
    };
  }

  /* A finished improvement is verified only when a run's checks passed. */
  if (proposal.status === "Integrated") {
    const verified = executionVerified(proposal);
    lifecycle = verified ? "VerifiedComplete" : "VerificationPending";
    reason = verified
      ? "Applied, and every recorded check of the run passed."
      : "Integrated, but no completed run recorded passing checks — verification is still pending.";
    evidence = proposal.lastExecution?.checks.map((check) => `${check.name}: ${check.ok === true ? "ok" : check.ok === false ? "failed" : "not run"}`).join("; ");
    if (verified) {
      return {
        proposalId: proposal.id,
        lifecycle,
        reason,
        evidence,
        verifiedAt: proposal.verifiedAt ?? proposal.lastExecution?.finished ?? now,
        changed: stored !== lifecycle,
      };
    }
  }

  if (proposal.status === "Ready" && executionVerified(proposal)) {
    lifecycle = "VerificationPending";
    reason = "A generated change passed its checks; it is waiting for the apply/verification step.";
  }

  /* A capability that is available WITH evidence means the limitation is gone. */
  if (proposal.capabilityId && isActiveLifecycle(stored)) {
    const capability = CapabilityRegistry.getInstance().get(proposal.capabilityId);
    if (capability && capability.status === "available" && isVerified(capability.id) && proposal.kind === "New Capability") {
      return {
        proposalId: proposal.id,
        lifecycle: "Superseded",
        reason: `Superseded: capability “${capability.name}” is available and its implementation is verified.`,
        evidence: `CapabilityEvidence for ${capability.id}`,
        changed: true,
      };
    }
  }

  const resolved = resolvedByTitle(proposal.title);
  if (resolved && isActiveLifecycle(stored)) {
    return {
      proposalId: proposal.id,
      lifecycle: "Superseded",
      reason: `Superseded: the limitation was resolved — ${resolved.resolvedBy}`,
      evidence: resolved.tests.join(", "),
      changed: true,
    };
  }

  if (proposal.status === "Blocked") {
    reason = proposal.blocked?.reason ? `Blocked: ${proposal.blocked.reason}` : "Blocked by a prerequisite.";
  }
  if (proposal.status === "Rejected") {
    reason = "Withdrawn — kept as a historical record.";
  }
  if (proposal.status === "Rolled Back") {
    reason = "Rolled back after a failed verification — reopened for a new attempt.";
  }

  return { proposalId: proposal.id, lifecycle, reason, evidence, changed: stored !== lifecycle };
}

/**
 * Reconcile the whole queue: lifecycle, duplicates, retirement, reopen.
 *
 * The oldest active proposal wins a duplicate pair; a proposal that has
 * a recorded implementation run beats an older one that never ran.
 */
export function reconcileImprovements(proposals: ImprovementProposal[], now = Date.now()): ReconciliationResult {
  const decisions = proposals.map((proposal) => decideLifecycle(proposal, now));

  /* Duplicates: same topic AND same capability (or same exact title). */
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const active = decisions.filter((decision) => {
    const proposal = byId.get(decision.proposalId);
    return proposal ? isActiveLifecycle(decision.lifecycle) : false;
  });
  const duplicateIds = new Set<string>();
  const duplicateDecisions: LifecycleDecision[] = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = byId.get(active[i].proposalId);
      const b = byId.get(active[j].proposalId);
      if (!a || !b || duplicateIds.has(b.id)) continue;
      if (!sameTopic(a.title, b.title)) continue;

      const aHasRun = Boolean(a.lastExecution);
      const bHasRun = Boolean(b.lastExecution);
      const keep = aHasRun && !bHasRun ? a : bHasRun && !aHasRun ? b : a.created <= b.created ? a : b;
      const retire = keep.id === a.id ? b : a;
      duplicateIds.add(retire.id);
      duplicateDecisions.push({
        proposalId: retire.id,
        lifecycle: "Superseded",
        reason: `Superseded: this duplicates “${keep.title}”, which already tracks the same work.`,
        evidence: `kept ${keep.id}`,
        supersededBy: keep.id,
        changed: retire.lifecycle !== "Superseded",
      });
    }
  }

  const merged = decisions.map((decision) => duplicateDecisions.find((dup) => dup.proposalId === decision.proposalId) ?? decision);

  const patches: Array<{ id: string; patch: Partial<ImprovementProposal> }> = [];
  for (const decision of merged) {
    const proposal = byId.get(decision.proposalId);
    if (!proposal) continue;
    if (!decision.changed) continue;
    const from = proposal.lifecycle ?? "None";
    const event: LifecycleEvent = {
      at: now,
      from,
      to: decision.lifecycle,
      reason: decision.reason,
      evidence: decision.evidence,
    };
    patches.push({
      id: proposal.id,
      patch: {
        lifecycle: decision.lifecycle,
        lifecycleReason: decision.reason,
        ...(decision.supersededBy ? { supersededBy: decision.supersededBy } : {}),
        ...(decision.lifecycle === "VerifiedComplete" ? { verifiedAt: decision.verifiedAt ?? now } : {}),
        history: [...(proposal.history ?? []), event].slice(-30),
      },
    });
  }

  return {
    decisions: merged,
    patches,
    superseded: merged.filter((decision) => decision.changed && decision.lifecycle === "Superseded"),
    reopened: merged.filter((decision) => decision.changed && decision.lifecycle === "Reopened"),
    verified: merged.filter((decision) => decision.changed && decision.lifecycle === "VerifiedComplete"),
    duplicates: duplicateDecisions.filter((decision) => decision.changed),
  };
}
