/**
 * ==========================================================
 * LÉLU
 * RESEARCH AGENDA — questions she chose, ranked
 *
 * WP06 asks her to propose her own research. A proposal list is
 * only useful if it is ordered, and an order is only honest if the
 * numbers behind it are visible. So each proposal carries four
 * independent axes — impact, feasibility, cost, relevance — and
 * the priority is a stated formula over them, never a hunch:
 *
 *   priority = (0.40·impact + 0.35·relevance + 0.25·feasibility)
 *              ÷ (0.5 + cost/5)
 *
 * Cost divides because a cheap experiment that answers half the
 * question beats an expensive one that answers all of it only when
 * time is free — and it is not. Every proposal keeps its reasons,
 * so a ranking can be argued with.
 * ==========================================================
 */

import type { ResearchProposal, WorkPackage } from "./types";
import type { KnowledgeGap } from "./journal";
import type { Observation, ObservationType } from "./observations";

export interface ProposalInput {
  question: string;
  origin: string;
  impact: number;
  feasibility: number;
  cost: number;
  relevance: number;
  reasons?: string[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function priorityOf(proposal: Pick<ResearchProposal, "impact" | "feasibility" | "cost" | "relevance">): number {
  const numerator = 0.4 * clamp01(proposal.impact) + 0.35 * clamp01(proposal.relevance) + 0.25 * clamp01(proposal.feasibility);
  const denominator = 0.5 + Math.max(1, Math.min(5, proposal.cost)) / 5;
  return Number((numerator / denominator).toFixed(4));
}

/** How much a work package matters to the active mission right now. */
const WP_RELEVANCE: Record<WorkPackage, number> = {
  WP01: 0.85,
  WP02: 0.8,
  WP03: 0.95,
  WP04: 0.9,
  WP05: 0.7,
  WP06: 0.8,
  WP07: 0.85,
  WP08: 0.9,
  WP09: 0.75,
  WP10: 0.9,
  MISSION: 0.6,
};

export default class ResearchAgenda {
  public propose(input: ProposalInput): ResearchProposal {
    const proposal: ResearchProposal = {
      question: input.question,
      origin: input.origin,
      impact: clamp01(input.impact),
      feasibility: clamp01(input.feasibility),
      cost: Math.max(1, Math.min(5, Math.round(input.cost))),
      relevance: clamp01(input.relevance),
      priority: 0,
      reasons: [...(input.reasons ?? [])],
    };
    proposal.priority = priorityOf(proposal);
    proposal.reasons.push(
      `priority ${proposal.priority} = (0.40·${proposal.impact} + 0.35·${proposal.relevance} + 0.25·${proposal.feasibility}) ÷ (0.5 + ${proposal.cost}/5)`,
    );
    return proposal;
  }

  public rank(proposals: ResearchProposal[]): ResearchProposal[] {
    return [...proposals]
      .map((proposal) => ({ ...proposal, priority: priorityOf(proposal) }))
      .sort((a, b) => b.priority - a.priority || b.impact - a.impact || a.question.localeCompare(b.question));
  }

  /**
   * Turn unsettled questions into ranked work.
   *
   * Impact grows with how often the question recurred, because a
   * question raised by three separate experiments is load-bearing for
   * the understanding, not incidental. Feasibility is judged from the
   * work package: a question about a measurement that already has a
   * harness is cheaper to answer than one requiring new instrumentation.
   */
  public fromGaps(gaps: KnowledgeGap[]): ResearchProposal[] {
    return this.rank(
      gaps.map((gap) =>
        this.propose({
          question: gap.question,
          origin: `journal gap from ${gap.from}`,
          impact: clamp01(0.45 + gap.asked * 0.15),
          feasibility: WORK_PACKAGE_FEASIBILITY[gap.workPackage] ?? 0.6,
          cost: WORK_PACKAGE_COST[gap.workPackage] ?? 3,
          relevance: WP_RELEVANCE[gap.workPackage] ?? 0.6,
          reasons: [
            `raised by ${gap.asked} entr${gap.asked === 1 ? "y" : "ies"}`,
            `unsettled for ${gap.ageDays} day(s)`,
          ],
        }),
      ),
    );
  }

  /**
   * Failures are the cheapest source of next questions: the setup is
   * already built, so feasibility is high even when impact is moderate.
   */
  public fromFailures(recurrences: Array<{ type: ObservationType; workPackage: WorkPackage; count: number; examples: string[] }>, events: Observation[]): ResearchProposal[] {
    return this.rank(
      recurrences.map((group) => {
        const inPackage = events.filter((event) => event.workPackage === group.workPackage).length;
        return this.propose({
          question: `What causes the recurring ${group.type} in ${group.workPackage} (${group.count} occurrences), and can it be eliminated?`,
          origin: `observation log: ${group.examples[0] ?? group.type}`,
          impact: clamp01(0.5 + group.count * 0.08),
          feasibility: 0.85,
          cost: 2,
          relevance: WP_RELEVANCE[group.workPackage] ?? 0.6,
          reasons: [
            `${group.count} observation(s) of the same kind`,
            `${inPackage} observed event(s) in ${group.workPackage} give the follow-up its context`,
            "the failing configuration already exists, so a controlled follow-up is cheap",
          ],
        });
      }),
    ).slice(0, 20);
  }

  public top(proposals: ResearchProposal[], limit = 5): ResearchProposal[] {
    return this.rank(proposals).slice(0, limit);
  }
}

/** How ready the existing tooling is to answer a question in that package. */
const WORK_PACKAGE_FEASIBILITY: Partial<Record<WorkPackage, number>> = {
  WP01: 0.9, // the audit harness already re-reads artefacts
  WP02: 0.95, // the matrix harness runs in minutes
  WP03: 0.75, // geometry can be rebuilt and measured; visual judgement is slower
  WP04: 0.6, // no orthographic reference plate exists
  WP05: 0.4, // needs a real device
  WP06: 0.9,
  WP07: 0.8,
  WP08: 0.85,
  WP09: 0.9,
  WP10: 0.9,
  MISSION: 0.7,
};

const WORK_PACKAGE_COST: Partial<Record<WorkPackage, number>> = {
  WP01: 1,
  WP02: 2,
  WP03: 3,
  WP04: 4,
  WP05: 5,
  WP06: 1,
  WP07: 2,
  WP08: 3,
  WP09: 1,
  WP10: 2,
  MISSION: 3,
};
