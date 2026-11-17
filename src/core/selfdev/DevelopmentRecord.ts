/**
 * ==========================================================
 * LÉLU — DEVELOPMENT RECORD
 *
 * What LÉLU is learning and what has become of it, read from the
 * stores that already hold it. Nothing is stored here and nothing
 * is generated: every line comes from a persisted objective, its
 * conclusion, the improvement proposal it produced, that
 * proposal's real execution record, and the owner's decision.
 *
 *   STUDY → CONCLUSION → PROPOSAL (Gate 1) → IMPLEMENTATION
 *     → DEMONSTRATED RESULT → OWNER ACCEPTANCE (Gate 2)
 * ==========================================================
 */

import type { StudyObjective } from "../cognition/StudyObjectives";
import type { StudyConclusion } from "../cognition/StudyConclusion";
import type { ImprovementProposal, ImprovementStatus } from "./ImprovementQueue";

export type DevelopmentStage =
  | "concluded-no-change"
  | "held"
  | "awaiting-approval"
  | "in-development"
  | "needs-decision"
  | "awaiting-acceptance"
  | "accepted"
  | "returned"
  | "rejected";

export const DEVELOPMENT_STAGE_LABELS: Record<DevelopmentStage, string> = {
  "concluded-no-change": "Concluded — nothing to change",
  held: "Change warranted — held until the current proposal is finished",
  "awaiting-approval": "Proposed — awaiting your approval (Gate 1)",
  "in-development": "Approved — being implemented",
  "needs-decision": "Implementation stopped — needs your decision",
  "awaiting-acceptance": "Implemented — awaiting your acceptance (Gate 2)",
  accepted: "Accepted by you",
  returned: "Returned with your feedback",
  rejected: "Rejected by you",
};

export interface DevelopmentEntry {
  objectiveId: string;
  /** The question studied, and why. */
  question: string;
  why: string;
  /** Research actually performed: the evidence lines the conclusion rests on. */
  evidence: string[];
  conclusion: {
    subject: string;
    category: string;
    verdict: string;
    learned: string;
    change?: string;
    expectedBenefit?: string;
    risks?: string;
    verification?: string;
    synthesizedBy: string;
    cycle: number;
    concludedAt: number;
  };
  stage: DevelopmentStage;
  stageLabel: string;
  proposal?: {
    id: string;
    title: string;
    status: ImprovementStatus;
    /** What the implementation run actually did, from its execution record. */
    implementation?: {
      agent?: string;
      filesChanged: string[];
      checks: Array<{ name: string; ok: boolean | null; detail: string }>;
      outcome?: string;
      error?: string;
      diff?: string;
    };
    ownerDecision?: { decision: "accepted" | "returned"; at: number; note?: string };
    /** Earlier Gate 2 returns this implementation was developed again to address. */
    feedbackHistory?: Array<{ decision: "accepted" | "returned"; at: number; note?: string }>;
  };
}

const IN_DEVELOPMENT: ImprovementStatus[] = ["Approved", "In Development", "Testing", "Evaluation", "Applying"];
const AWAITING: ImprovementStatus[] = ["Ready", "Integrated", "Recorded"];

export function stageOf(conclusion: StudyConclusion, proposal: ImprovementProposal | undefined): DevelopmentStage {
  if (!proposal) return conclusion.verdict === "change" ? "held" : "concluded-no-change";
  if (proposal.status === "Rejected" || proposal.status === "Rolled Back") return "rejected";
  if (proposal.ownerDecision?.decision === "accepted") return "accepted";
  if (proposal.ownerDecision?.decision === "returned") return "returned";
  if (AWAITING.includes(proposal.status)) return "awaiting-acceptance";
  if (IN_DEVELOPMENT.includes(proposal.status)) return "in-development";
  if (proposal.status === "Failed" || proposal.status === "Blocked") return "needs-decision";
  return "awaiting-approval";
}

function proposalView(proposal: ImprovementProposal): NonNullable<DevelopmentEntry["proposal"]> {
  const execution = proposal.lastExecution;
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    ...(execution
      ? {
          implementation: {
            agent: execution.agent,
            filesChanged: execution.filesChanged,
            checks: execution.checks,
            outcome: execution.outcome,
            error: execution.error,
            diff: execution.diff,
          },
        }
      : {}),
    ...(proposal.ownerDecision ? { ownerDecision: proposal.ownerDecision } : {}),
    ...(proposal.ownerFeedbackHistory?.length ? { feedbackHistory: proposal.ownerFeedbackHistory } : {}),
  };
}

/**
 * The record, newest first. Entries with a proposal come first (they are
 * what the owner acts on), then the latest conclusions that changed nothing.
 */
export function buildDevelopmentRecord(
  objectives: StudyObjective[],
  proposals: ImprovementProposal[],
  options: { maxNoChange?: number } = {},
): DevelopmentEntry[] {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const concluded = objectives
    .filter((objective) => objective.conclusion && objective.conclusion.verdict !== "insufficient")
    .sort((a, b) => (b.conclusion?.concludedAt ?? 0) - (a.conclusion?.concludedAt ?? 0));

  const entries: DevelopmentEntry[] = [];
  const seenProposals = new Set<string>();
  let noChange = 0;
  for (const objective of concluded) {
    const conclusion = objective.conclusion as StudyConclusion;
    const proposal = conclusion.proposalId ? byId.get(conclusion.proposalId) : undefined;
    if (proposal) {
      // One entry per proposal: the conclusion that produced it.
      if (seenProposals.has(proposal.id)) continue;
      seenProposals.add(proposal.id);
    } else if (conclusion.verdict !== "change") {
      if (noChange >= (options.maxNoChange ?? 5)) continue;
      noChange += 1;
    }
    const stage = stageOf(conclusion, proposal);
    entries.push({
      objectiveId: objective.id,
      question: objective.question,
      why: objective.purpose ? `${objective.purpose.gap} ${objective.purpose.whyItMatters}` : objective.detail,
      evidence: conclusion.evidence.slice(0, 6),
      conclusion: {
        subject: conclusion.subject,
        category: conclusion.category,
        verdict: conclusion.verdict,
        learned: conclusion.learned,
        ...(conclusion.change ? { change: conclusion.change } : {}),
        ...(conclusion.expectedBenefit ? { expectedBenefit: conclusion.expectedBenefit } : {}),
        ...(conclusion.risks ? { risks: conclusion.risks } : {}),
        ...(conclusion.verification ? { verification: conclusion.verification } : {}),
        synthesizedBy: conclusion.synthesizedBy,
        cycle: conclusion.cycle,
        concludedAt: conclusion.concludedAt,
      },
      stage,
      stageLabel: DEVELOPMENT_STAGE_LABELS[stage],
      ...(proposal ? { proposal: proposalView(proposal) } : {}),
    });
  }
  // A self-study proposal whose study is no longer on this device — the
  // study history is capped and device-local, while proposals sync — is
  // still the owner's to decide. It is shown from the proposal itself, so a
  // proposal awaiting either gate can never drop out of the record.
  for (const proposal of proposals) {
    if (proposal.origin?.kind !== "self-study" || seenProposals.has(proposal.id)) continue;
    seenProposals.add(proposal.id);
    const stage = stageOf({ verdict: "change" } as StudyConclusion, proposal);
    entries.push({
      objectiveId: proposal.origin.objectiveId,
      question: proposal.problem,
      why: `${proposal.observation} (the study itself is not on this device; shown from its proposal)`,
      evidence: proposal.evidence.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
      conclusion: {
        subject: proposal.origin.subject,
        category: proposal.kind,
        verdict: "change",
        learned: proposal.observation,
        change: proposal.proposedSolution,
        expectedBenefit: proposal.expectedBenefit,
        risks: proposal.risk,
        verification: proposal.testPlan,
        synthesizedBy: "recorded in proposal",
        cycle: proposal.origin.cycle,
        concludedAt: proposal.created,
      },
      stage,
      stageLabel: DEVELOPMENT_STAGE_LABELS[stage],
      proposal: proposalView(proposal),
    });
  }

  const weight = (entry: DevelopmentEntry): number => (entry.proposal ? 1 : 0);
  return entries.sort((a, b) => weight(b) - weight(a) || b.conclusion.concludedAt - a.conclusion.concludedAt);
}

/** The record as LÉLU reads it in conversation — short, factual, newest first. */
export function formatDevelopmentRecord(entries: DevelopmentEntry[]): string {
  const withProposals = entries.filter((entry) => entry.proposal || entry.stage === "held").slice(0, 4);
  if (withProposals.length === 0) {
    return "## MY DEVELOPMENT RECORD\nNo self-study conclusion has called for a change yet.";
  }
  return [
    "## MY DEVELOPMENT RECORD (study → conclusion → proposal → your decision)",
    ...withProposals.map((entry) => {
      const checks = entry.proposal?.implementation?.checks ?? [];
      const passed = checks.filter((check) => check.ok === true).length;
      return [
        `- ${entry.stageLabel}: ${entry.proposal?.title ?? entry.conclusion.change ?? entry.conclusion.subject}`,
        `  studied: ${entry.question} (cycle ${entry.conclusion.cycle}); learned: ${entry.conclusion.learned.slice(0, 200)}`,
        entry.proposal?.implementation
          ? `  implementation: ${entry.proposal.implementation.filesChanged.length} file(s) changed, ${passed}/${checks.length} check(s) passed${entry.proposal.implementation.error ? `, error: ${entry.proposal.implementation.error.slice(0, 120)}` : ""}`
          : "",
        entry.proposal?.ownerDecision?.note ? `  your feedback: ${entry.proposal.ownerDecision.note.slice(0, 200)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  ].join("\n");
}
