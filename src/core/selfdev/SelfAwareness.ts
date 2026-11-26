/**
 * ==========================================================
 * LÉLU — SELF-AWARENESS
 *
 * One reconciled view of what LÉLU can actually do, what she has
 * already improved, what is still open, and what her own
 * recommendations no longer describe.
 *
 * The problem this solves was measured, not hypothetical: the
 * self-model's `unavailable` and `limitations` lists were seeded
 * once and never reconciled, so she kept telling people she could
 * not do things that had shipped months of work ago, and the
 * improvement queue kept offering work that was already done.
 *
 * Every answer here is derived from:
 *
 *   CapabilityRegistry  — the claim
 *   CapabilityEvidence  — the implementation + the verification
 *   ImprovementLifecycle— the reconciled state of every proposal
 *   DevelopmentJournal  — what actually happened, with its evidence
 *   SelfModel           — the persisted self, corrected in place
 *
 * A capability is never called operational because it was merged,
 * committed or labelled: it needs an implementation file AND a
 * named check. Everything else is reported as partial, planned,
 * blocked or unverified — including the gaps in this file's own
 * evidence.
 * ==========================================================
 */

import CapabilityRegistry, { type Capability, type CapabilityStatus } from "./CapabilityRegistry";
import {
  allResolvedLimitations,
  describeEvidence,
  evidenceFor,
  isVerified,
  obsoleteSelfModelEntries,
  resolvedLimitationsFor,
  type ResolvedLimitation,
} from "./CapabilityEvidence";
import ImprovementQueue, { type ImprovementProposal } from "./ImprovementQueue";
import {
  isActiveLifecycle,
  LIFECYCLE_LABELS,
  reconcileImprovements,
  type ImprovementLifecycle,
  type LifecycleDecision,
} from "./ImprovementLifecycle";
import DevelopmentJournal, { type JournalEntry } from "./DevelopmentJournal";
import SelfTestRunner from "./SelfTestRunner";
import ImprovementPrioritizer from "./ImprovementPrioritizer";
import EngineeringMemory from "./EngineeringMemory";
import SelfModel from "../cognition/SelfModel";

/** What a capability really is, after the evidence is applied. */
export type CapabilityTruth = "operational" | "partial" | "blocked" | "planned" | "unverified";

export const TRUTH_LABELS: Record<CapabilityTruth, string> = {
  operational: "Operational",
  partial: "Partial",
  blocked: "Blocked",
  planned: "Planned",
  unverified: "Reported, not verified",
};

export interface CapabilityAssessment {
  id: string;
  name: string;
  description: string;
  registryStatus: CapabilityStatus;
  truth: CapabilityTruth;
  /** The implementation files that exist for it. */
  implemented: boolean;
  /** Repository tests that cover it. */
  tested: boolean;
  /** Whether the runtime self-test suite names (and last run passed) its checks. */
  runtimeChecked: boolean | null;
  evidence: string[];
  limitations: string[];
  resolvedLimitations: string[];
  journalEntries: number;
  reason: string;
}

export type SelfQuestion =
  | "capabilities"
  | "recent"
  | "verified"
  | "resolved"
  | "incomplete"
  | "outdated"
  | "next"
  | "evidence";

export const SELF_QUESTIONS: Record<SelfQuestion, string> = {
  capabilities: "What capabilities do I currently have?",
  recent: "What did I improve recently?",
  verified: "Which improvements have been verified?",
  resolved: "Which previous limitations have been resolved?",
  incomplete: "What remains incomplete?",
  outdated: "Which recommendations are outdated?",
  next: "What should I improve next?",
  evidence: "What evidence supports my assessment?",
};

export interface NextImprovement {
  id: string;
  title: string;
  score: number;
  level: string;
  reason: string;
}

export interface ReconciliationSummary {
  at: number;
  changed: boolean;
  retired: string[];
  reopened: string[];
  verified: string[];
  duplicates: string[];
  resolvedLimitations: string[];
  activeRecommendations: number;
  next: NextImprovement | null;
  modelChanges: string[];
}

export interface SelfAwarenessSnapshot {
  updatedAt: number;
  capabilities: CapabilityAssessment[];
  counts: Record<CapabilityTruth, number>;
  operational: CapabilityAssessment[];
  partial: CapabilityAssessment[];
  blocked: CapabilityAssessment[];
  planned: CapabilityAssessment[];
  unverified: CapabilityAssessment[];
  resolvedLimitations: ResolvedLimitation[];
  remainingLimitations: string[];
  improvedRecently: JournalEntry[];
  verifiedImprovements: Array<{ id: string; title: string; reason: string; lifecycle: ImprovementLifecycle }>;
  activeRecommendations: ImprovementProposal[];
  outdatedRecommendations: ImprovementProposal[];
  nextImprovement: NextImprovement | null;
  answers: Record<SelfQuestion, string>;
}

const TRUTH_ORDER: CapabilityTruth[] = ["operational", "partial", "unverified", "blocked", "planned"];

/** The capability's real state, from its claim plus its evidence. */
function assessCapability(capability: Capability, journalCount: number): CapabilityAssessment {
  const evidence = evidenceFor(capability.id);
  const implemented = Boolean(evidence?.sources.length);
  const tested = Boolean(evidence?.tests.length || evidence?.selfTests.length);
  const lastSuite = SelfTestRunner.getInstance().getLastResult();
  const runtimeChecked = lastSuite && evidence?.selfTests.length
    ? evidence.selfTests.every((name) => lastSuite.results.some((result) => result.name === name && result.passed))
    : null;

  let truth: CapabilityTruth;
  let reason: string;
  if (capability.status === "broken" || capability.status === "disabled") {
    truth = "blocked";
    reason = `The registry reports it ${capability.status}.`;
  } else if (capability.status === "planned") {
    truth = "planned";
    reason = "It is planned; no implementation evidence exists.";
  } else if (["partial", "experimental", "offline", "provider-dependent"].includes(capability.status)) {
    truth = "partial";
    reason = `The registry reports it ${capability.status}${runtimeChecked === false ? "; a named runtime check did not pass" : ""}.`;
  } else if (!implemented || !tested) {
    truth = "unverified";
    reason = implemented
      ? "The implementation exists but no check verifies it."
      : "No implementation or verification evidence is recorded.";
  } else {
    truth = "operational";
    reason = runtimeChecked === false
      ? "Implementation and tests exist, but the last runtime check failed."
      : runtimeChecked === true
        ? "Implementation, tests and the last runtime check all hold."
        : "Implementation and tests exist; the runtime check has not been run in this session.";
    if (runtimeChecked === false) truth = "partial";
  }

  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    registryStatus: capability.status,
    truth,
    implemented,
    tested,
    runtimeChecked,
    evidence: evidence?.sources ?? [],
    limitations: capability.limitations,
    resolvedLimitations: resolvedLimitationsFor(capability.id).map((entry) => entry.limitation),
    journalEntries: journalCount,
    reason,
  };
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export default class SelfAwareness {
  private static instance: SelfAwareness | null = null;

  private constructor() {}

  public static getInstance(): SelfAwareness {
    if (!SelfAwareness.instance) SelfAwareness.instance = new SelfAwareness();
    return SelfAwareness.instance;
  }

  /** Build the reconciled picture. Reads state; mutates nothing. */
  public assess(now = Date.now()): SelfAwarenessSnapshot {
    const registry = CapabilityRegistry.getInstance();
    const journal = DevelopmentJournal.getInstance();
    const queue = ImprovementQueue.getInstance();

    const capabilities = registry
      .list()
      .map((capability) => assessCapability(capability, journal.forCapability(capability.id).length));

    const counts: Record<CapabilityTruth, number> = {
      operational: 0,
      partial: 0,
      blocked: 0,
      planned: 0,
      unverified: 0,
    };
    for (const capability of capabilities) counts[capability.truth] += 1;

    const resolvedLimitations = allResolvedLimitations();
    const obsolete = new Set(obsoleteSelfModelEntries());

    const reconciledLimitations = capabilities
      .filter((capability) => capability.truth !== "operational")
      .map((capability) =>
        capability.truth === "unverified"
          ? `${capability.name}: ${capability.reason}`
          : `${capability.name} is ${TRUTH_LABELS[capability.truth].toLowerCase()}${
              capability.limitations.length ? `: ${capability.limitations.join("; ")}` : ""
            }`,
      );
    const legacyRemaining = SelfModel.getInstance()
      .get()
      .limitations.filter((line) => !obsolete.has(line));
    const remainingLimitations = uniqueLines([...reconciledLimitations, ...legacyRemaining]);

    const proposals = queue.list();
    const activeRecommendations = proposals.filter((proposal) => isActiveLifecycle(proposal.lifecycle));
    const outdatedRecommendations = proposals.filter(
      (proposal) => proposal.lifecycle === "VerifiedComplete" || proposal.lifecycle === "Superseded",
    );

    const improvedRecently = journal
      .latest(12)
      .filter((entry) => entry.kind === "mission" || entry.kind === "upgrade" || entry.kind === "verification")
      .slice(0, 6);

    const verifiedImprovements = proposals
      .filter((proposal) => proposal.lifecycle === "VerifiedComplete")
      .map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        reason: proposal.lifecycleReason ?? "Verified complete.",
        lifecycle: "VerifiedComplete" as ImprovementLifecycle,
      }));

    const nextImprovement = this.pickNext(activeRecommendations);

    const snapshot: SelfAwarenessSnapshot = {
      updatedAt: now,
      capabilities,
      counts,
      operational: capabilities.filter((capability) => capability.truth === "operational"),
      partial: capabilities.filter((capability) => capability.truth === "partial"),
      blocked: capabilities.filter((capability) => capability.truth === "blocked"),
      planned: capabilities.filter((capability) => capability.truth === "planned"),
      unverified: capabilities.filter((capability) => capability.truth === "unverified"),
      resolvedLimitations,
      remainingLimitations,
      improvedRecently,
      verifiedImprovements,
      activeRecommendations,
      outdatedRecommendations,
      nextImprovement,
      answers: {} as Record<SelfQuestion, string>,
    };
    snapshot.answers = this.buildAnswers(snapshot);
    return snapshot;
  }

  private pickNext(active: ImprovementProposal[]): NextImprovement | null {
    const actionable = active.filter(
      (proposal) => !["Rejected", "Rolled Back"].includes(proposal.status),
    );
    if (actionable.length === 0) return null;
    const top = ImprovementPrioritizer.getInstance().topPick(actionable);
    if (!top) return null;
    return {
      id: top.proposal.id,
      title: top.proposal.title,
      score: top.priority.score,
      level: top.priority.level,
      reason: top.priority.explanation,
    };
  }

  private buildAnswers(snapshot: SelfAwarenessSnapshot): Record<SelfQuestion, string> {
    const date = (at: number) => new Date(at).toISOString().slice(0, 10);
    const nameList = (list: CapabilityAssessment[]) => list.map((capability) => capability.name).join(", ") || "none";

    const capabilities = [
      `${snapshot.counts.operational} capabilities are operational (implementation + a named check): ${nameList(snapshot.operational)}.`,
      snapshot.counts.partial ? `${snapshot.counts.partial} are partial: ${nameList(snapshot.partial)}.` : "",
      snapshot.counts.unverified ? `${snapshot.counts.unverified} are reported but not verified: ${nameList(snapshot.unverified)}.` : "",
      snapshot.counts.blocked ? `${snapshot.counts.blocked} are blocked: ${nameList(snapshot.blocked)}.` : "",
      snapshot.counts.planned ? `${snapshot.counts.planned} are planned: ${nameList(snapshot.planned)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const recent = snapshot.improvedRecently.length
      ? snapshot.improvedRecently
          .map((entry) => `${date(entry.at)} — ${entry.title}${entry.commit ? ` (commit ${entry.commit})` : ""}${entry.missionId ? ` [${entry.missionId}]` : ""}`)
          .join("; ")
      : "No development journal entry is recorded yet.";

    const verified = snapshot.verifiedImprovements.length
      ? snapshot.verifiedImprovements.map((item) => `${item.title} — ${item.reason}`).join("; ")
      : "No improvement has been verified complete yet.";

    const resolved = snapshot.resolvedLimitations.length
      ? snapshot.resolvedLimitations
          .map((item) => `“${item.limitation}” → ${item.resolvedBy} (evidence: ${item.tests.join(", ") || item.sources.join(", ")})`)
          .join("; ")
      : "No resolved limitation is recorded yet.";

    const incomplete = snapshot.remainingLimitations.length
      ? snapshot.remainingLimitations.join("; ")
      : "Nothing is recorded as incomplete.";

    const outdated = snapshot.outdatedRecommendations.length
      ? snapshot.outdatedRecommendations
          .map((proposal) => `${proposal.title} — ${proposal.lifecycleReason ?? LIFECYCLE_LABELS[proposal.lifecycle ?? "Identified"]}`)
          .join("; ")
      : "No recommendation is outdated: every open one still describes the system.";

    const next = snapshot.nextImprovement
      ? `${snapshot.nextImprovement.title} (${snapshot.nextImprovement.score}/100 ${snapshot.nextImprovement.level}) — ${snapshot.nextImprovement.reason}`
      : "No improvement is actionable right now.";

    const evidence = [
      `Capability registry: ${snapshot.capabilities.length} entries.`,
      `Implementation and verification evidence is declared per capability (sources + repository tests + runtime checks); ${snapshot.counts.operational} meet it.`,
      `Journal: ${snapshot.improvedRecently.length} recent entries carry a mission or a real run, with checks where they ran.`,
      `Open recommendations: ${snapshot.activeRecommendations.length}; retired: ${snapshot.outdatedRecommendations.length}.`,
    ].join(" ");

    const answers = {} as Record<SelfQuestion, string>;
    answers.capabilities = capabilities;
    answers.recent = recent;
    answers.verified = verified;
    answers.resolved = resolved;
    answers.incomplete = incomplete;
    answers.outdated = outdated;
    answers.next = next;
    answers.evidence = evidence;
    return answers;
  }

  /** Route a free-text question to one of the eight answers. */
  public answer(question: string): string {
    const snapshot = this.assess();
    const text = question.toLowerCase();
    if (/outdated|obsolete|no longer|still recommend|stale/.test(text)) return snapshot.answers.outdated;
    if (/resolved|fixed|no longer a limitation|already solved/.test(text)) return snapshot.answers.resolved;
    if (/verified|tested|proof|evidence/.test(text) && /improve/.test(text)) return snapshot.answers.verified;
    if (/what next|next improvement|improve next|priority/.test(text)) return snapshot.answers.next;
    if (/incomplete|remaining|still (partial|missing)|partial|blocked/.test(text)) return snapshot.answers.incomplete;
    if (/recent|last|recently|what did i (improve|do)/.test(text)) return snapshot.answers.recent;
    if (/capabilit|what can (i|you) do|what do i have/.test(text)) return snapshot.answers.capabilities;
    if (/evidence|why do you (say|think)|support/.test(text)) return snapshot.answers.evidence;
    return `${snapshot.answers.capabilities} ${snapshot.answers.next}`;
  }

  /**
   * Reconcile every record with the evidence, and correct the persisted
   * self-model in place. Idempotent: a second call with nothing new
   * changes nothing and journals nothing.
   */
  public reconcile(now = Date.now()): ReconciliationSummary {
    const queue = ImprovementQueue.getInstance();
    const result = reconcileImprovements(queue.list(), now);

    for (const patch of result.patches) {
      queue.applyLifecycle(patch.id, patch.patch);
    }

    const snapshot = this.assess(now);
    const obsolete = new Set(obsoleteSelfModelEntries());

    /* The self-model is corrected, not overwritten: limitations that are
       still true stay, and so does evidence another system recorded. */
    const modelChanges = SelfModel.getInstance().reconcileFromAwareness({
      operational: snapshot.operational.map((capability) => capability.name),
      unavailable: [...snapshot.blocked, ...snapshot.planned].map((capability) => capability.name),
      limitations: snapshot.remainingLimitations,
      improvements: snapshot.activeRecommendations.map((proposal) => proposal.title),
      resolvedLimitations: snapshot.resolvedLimitations.map((entry) => entry.limitation),
      obsoleteLimitations: [...obsolete],
    });

    const changed = result.patches.length > 0 || modelChanges.length > 0;

    if (result.patches.length > 0 || modelChanges.length > 0) {
      const line = [
        result.superseded.length ? `retired ${result.superseded.length} recommendation(s)` : "",
        result.duplicates.length ? `collapsed ${result.duplicates.length} duplicate(s)` : "",
        result.verified.length ? `verified ${result.verified.length} improvement(s)` : "",
        result.reopened.length ? `reopened ${result.reopened.length} on new evidence` : "",
        modelChanges.length ? `corrected ${modelChanges.length} self-model entry(ies)` : "",
      ]
        .filter(Boolean)
        .join(", ");
      EngineeringMemory.getInstance().record({
        kind: "lesson",
        topic: "self-awareness-reconciliation",
        summary: `Reconciled capabilities and improvements: ${line || "no change"}.`,
        outcome: "neutral",
        detail: [
          ...result.superseded.map((decision) => `retired ${decision.proposalId}: ${decision.reason}`),
          ...result.reopened.map((decision) => `reopened ${decision.proposalId}: ${decision.reason}`),
        ].join(" · "),
      });
      DevelopmentJournal.getInstance().record({
        kind: "explicit",
        title: `Capability reconciliation${line ? ` — ${line}` : ""}`,
        detail: snapshot.answers.evidence,
        capabilities: snapshot.operational.map((capability) => capability.id),
        evidence: snapshot.resolvedLimitations.flatMap((entry) => entry.tests),
        verified: false,
      });
    }

    return {
      at: now,
      changed,
      retired: result.superseded.map((decision: LifecycleDecision) => decision.proposalId),
      reopened: result.reopened.map((decision: LifecycleDecision) => decision.proposalId),
      verified: result.verified.map((decision: LifecycleDecision) => decision.proposalId),
      duplicates: result.duplicates.map((decision: LifecycleDecision) => decision.proposalId),
      resolvedLimitations: snapshot.resolvedLimitations.map((entry) => entry.limitation),
      activeRecommendations: snapshot.activeRecommendations.length,
      next: snapshot.nextImprovement,
      modelChanges,
    };
  }

  /** Compact, evidence-carrying text for the cognitive context. */
  public describe(): string {
    const snapshot = this.assess();
    const lines = [
      `Operational (${snapshot.counts.operational}): ${snapshot.operational.map((capability) => capability.name).join(", ") || "none"}`,
      snapshot.partial.length ? `Partial (${snapshot.partial.length}): ${snapshot.partial.map((capability) => capability.name).join(", ")}` : "",
      snapshot.unverified.length ? `Reported, not verified (${snapshot.unverified.length}): ${snapshot.unverified.map((capability) => capability.name).join(", ")}` : "",
      snapshot.blocked.length ? `Blocked (${snapshot.blocked.length}): ${snapshot.blocked.map((capability) => capability.name).join(", ")}` : "",
      snapshot.planned.length ? `Planned (${snapshot.planned.length}): ${snapshot.planned.map((capability) => capability.name).join(", ")}` : "",
      snapshot.resolvedLimitations.length
        ? `Resolved limitations: ${snapshot.resolvedLimitations.map((entry) => entry.limitation).join("; ")}`
        : "",
      `Outdated recommendations: ${snapshot.outdatedRecommendations.map((proposal) => proposal.title).join("; ") || "none"}`,
      `Next improvement: ${snapshot.nextImprovement?.title ?? "none"}`,
      `Evidence rule: a capability is operational only with an implementation file AND a named check.`,
    ];
    return lines.filter(Boolean).join("\n");
  }

  /** Everything the eight questions would answer, as one block. */
  public selfReport(): string {
    const snapshot = this.assess();
    return TRUTH_ORDER.map((truth) => `${TRUTH_LABELS[truth]}: ${snapshot.counts[truth]}`).join(" · ");
  }

  /** The evidence line for one capability (used by panels). */
  public evidenceLine(capabilityId: string): string {
    return isVerified(capabilityId)
      ? describeEvidence(capabilityId)
      : `${describeEvidence(capabilityId)} No check verifies it yet.`;
  }
}
